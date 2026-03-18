import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ethers } from 'ethers';
import { verifyAttestation } from '../src/verifier.js';
import { NonceManager } from '../src/nonce.js';
import { OracleError } from '../src/errors.js';
import type { ChainReader } from '../src/chain.js';
import type { ChainState, MinerState } from '../src/types.js';
import {
  makeTestConfig, makeValidAttestRequest, makeValidApiResponse, makeValidApiRequest,
  TEST_MINER_ADDRESS, TEST_MODEL_HASH, TEST_OPENROUTER_MODEL, TEST_MODEL,
} from './helpers.js';
import { resolveModelAlias } from '../src/verifier.js';
import { parseTrustedRouterAliases } from '../src/config.js';

/** Assert that the promise rejects with OracleError having the given code */
async function expectOracleError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.fail(`Expected OracleError with code ${code} but promise resolved`);
  } catch (err) {
    expect(err).toBeInstanceOf(OracleError);
    expect((err as OracleError).code).toBe(code);
  }
}

/** Create a mock ChainReader */
function mockChainReader(stateOverrides?: Partial<ChainState>, minerOverrides?: Partial<MinerState>): ChainReader {
  const defaultState: ChainState = {
    currentEra: 1n,
    currentGlobalEpoch: 42n,
    currentSeed: BigInt('0xabc123'),
    seedEpoch: 42n,
    eraModelHash: TEST_MODEL_HASH,
    currentBlock: 19500000,
  };

  const defaultMiner: MinerState = {
    cooldownRemaining: 0n,
    epochClaimCount: 0n,
    lastClaimBlock: 0n,
  };

  const chainState = { ...defaultState, ...stateOverrides };
  const minerState = { ...defaultMiner, ...minerOverrides };

  return {
    getChainState: vi.fn().mockResolvedValue(chainState),
    getMinerState: vi.fn().mockResolvedValue(minerState),
    getBlockNumber: vi.fn().mockResolvedValue(chainState.currentBlock),
    isOracleSigner: vi.fn().mockResolvedValue(true),
    estimateReward: vi.fn().mockResolvedValue(1000000000000000000000000n),
    getMaxClaimsPerEpoch: vi.fn().mockResolvedValue(14n),
    getMinTokens: vi.fn().mockResolvedValue(100n),
    getMaxTokens: vi.fn().mockResolvedValue(100000n),
  } as unknown as ChainReader;
}

describe('verifier', () => {
  let nonceManager: NonceManager;
  const config = makeTestConfig();

  beforeEach(() => {
    nonceManager = new NonceManager(config);
  });

  afterEach(() => {
    nonceManager.close();
  });

  function getNonce(): string {
    return nonceManager.generate(TEST_MINER_ADDRESS).nonce;
  }

  describe('Step 1: FORMAT_VALIDATION', () => {
    it('should reject missing miner_address', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, { miner_address: '' });
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_ADDRESS');
    });

    it('should reject invalid Ethereum address', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, { miner_address: '0xinvalid' });
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_ADDRESS');
    });

    it('should reject missing api_response.usage', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, {
        api_response: { ...makeValidApiResponse(), usage: undefined as never },
      });
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_FORMAT');
    });

    it('should reject zero total_tokens', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, {
        api_response: makeValidApiResponse({
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
      });
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_FORMAT');
    });
  });

  describe('Step 2: MODEL_VALIDATION', () => {
    it('should reject wrong model', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, {
        api_response: makeValidApiResponse({ model: 'gpt-4' }),
      });
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_MODEL');
    });

    it('should reject mismatched request/response model', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, {
        api_request: {
          model: 'gpt-4',
          messages: [
            { role: 'system', content: 'test' },
            { role: 'user', content: `Clawing Mining | Seed: 0xabc123 | Epoch: 42 | Nonce: ${nonce} | Miner: ${TEST_MINER_ADDRESS} | ClaimIndex: 0 | Task: test` },
          ],
        },
      });
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_MODEL');
    });
  });

  describe('Step 3: SEED_VALIDATION', () => {
    it('should reject wrong seed_epoch', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, { seed_epoch: 99 });
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_SEED');
    });

    it('should reject wrong seed value', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, { seed: '0xdeadbeef' });
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_SEED');
    });

    it('should reject if seed not updated for current epoch', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, { seed_epoch: 41 });
      const chain = mockChainReader({ seedEpoch: 41n });
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'SEED_NOT_UPDATED');
    });
  });

  describe('Step 4: PROMPT_FORMAT_VALIDATION', () => {
    it('should reject if user message missing Clawing Mining', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, {
        api_request: {
          model: 'grok-4.1-fast',
          messages: [{ role: 'user', content: 'Just a normal prompt' }],
        },
      });
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_PROMPT');
    });

    it('should reject if nonce not in prompt', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, {
        api_request: {
          model: 'grok-4.1-fast',
          messages: [{
            role: 'user',
            content: `Clawing Mining | Seed: 0xabc123 | Epoch: 42 | Nonce: WRONG | Miner: ${TEST_MINER_ADDRESS} | ClaimIndex: 0 | Task: test`,
          }],
        },
      });
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_PROMPT');
    });

    it('should reject if no user message exists', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, {
        api_request: {
          model: 'grok-4.1-fast',
          messages: [{ role: 'system', content: 'Just system' }],
        },
      });
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_PROMPT');
    });
  });

  describe('Step 5: COOLDOWN_CHECK', () => {
    it('should reject if cooldown is active', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce);
      const chain = mockChainReader({}, { cooldownRemaining: 1000n });
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'COOLDOWN_ACTIVE');
    });

    it('should reject if epoch limit reached', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce);
      const chain = mockChainReader({}, { epochClaimCount: 14n });
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'EPOCH_LIMIT_REACHED');
    });

    it('should reject mismatched claim_index', async () => {
      const nonce = getNonce();
      // claim_index=5 in the prompt, but on-chain epochClaimCount=3
      const req = makeValidAttestRequest(nonce, {
        claim_index: 5,
        api_request: {
          model: 'grok-4.1-fast',
          messages: [
            { role: 'system', content: 'test' },
            { role: 'user', content: `Clawing Mining | Seed: 0xabc123 | Epoch: 42 | Nonce: ${nonce} | Miner: ${TEST_MINER_ADDRESS} | ClaimIndex: 5 | Task: test` },
          ],
        },
      });
      const chain = mockChainReader({}, { epochClaimCount: 3n });
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_CLAIM_INDEX');
    });
  });

  describe('Step 6: ANTI_CHEAT', () => {
    it('should reject tokens out of range (too low)', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, {
        api_response: makeValidApiResponse({
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
      });
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'TOKENS_OUT_OF_RANGE');
    });

    it('should reject token sum mismatch (total < prompt + completion)', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, {
        api_response: makeValidApiResponse({
          // total_tokens LESS than prompt + completion is invalid
          usage: { prompt_tokens: 1500, completion_tokens: 1500, total_tokens: 2500 },
        }),
      });
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'TOKEN_MISMATCH');
    });

    it('should accept reasoning tokens (total > prompt + completion)', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, {
        api_response: makeValidApiResponse({
          // Reasoning models: total_tokens includes hidden reasoning tokens
          usage: { prompt_tokens: 300, completion_tokens: 2000, total_tokens: 3400 },
        }),
      });
      const chain = mockChainReader();
      // Should NOT throw — reasoning tokens cause total > prompt + completion
      const result = await verifyAttestation(req, chain, nonceManager, config);
      expect(result.totalTokens).toBe(3400n);
    });

    it('should reject old response', async () => {
      const nonce = getNonce();
      const oldCreated = Math.floor(Date.now() / 1000) - 600;
      const req = makeValidAttestRequest(nonce, {
        api_response: makeValidApiResponse({ created: oldCreated }),
      });
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'RESPONSE_TOO_OLD');
    });

    it('should reject invalid finish_reason', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce, {
        api_response: makeValidApiResponse({
          choices: [{ index: 0, message: { role: 'assistant', content: 'test' }, finish_reason: 'error' }],
        }),
      });
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_FINISH_REASON');
    });

    it('should reject invalid nonce', async () => {
      const req = makeValidAttestRequest('CLAW-invalid-000');
      const chain = mockChainReader();
      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_NONCE');
    });

    it('should reject already-used nonce', async () => {
      const nonce = getNonce();
      const req1 = makeValidAttestRequest(nonce);
      const chain = mockChainReader();
      await verifyAttestation(req1, chain, nonceManager, config);

      const req2 = makeValidAttestRequest(nonce);
      await expectOracleError(verifyAttestation(req2, chain, nonceManager, config), 'NONCE_ALREADY_USED');
    });
  });

  describe('Full valid request', () => {
    it('should pass all 7 verification steps', async () => {
      const nonce = getNonce();
      const req = makeValidAttestRequest(nonce);
      const chain = mockChainReader();

      const result = await verifyAttestation(req, chain, nonceManager, config);

      expect(result.modelHash).toBe(TEST_MODEL_HASH);
      expect(result.totalTokens).toBe(2500n);
      expect(result.chainState.currentEra).toBe(1n);
      expect(result.chainState.currentGlobalEpoch).toBe(42n);
    });
  });

  describe('Trusted Router Aliases (OpenRouter)', () => {
    it('should accept OpenRouter model name "x-ai/grok-4.1-fast"', async () => {
      const nonce = getNonce();
      const seed = '0xabc123';
      const epoch = 42;
      const claimIndex = 0;
      const req = makeValidAttestRequest(nonce, {
        api_response: makeValidApiResponse({ model: TEST_OPENROUTER_MODEL }),
        api_request: makeValidApiRequest(nonce, seed, epoch, claimIndex, TEST_MINER_ADDRESS, {
          model: TEST_OPENROUTER_MODEL,
        }),
      });
      const chain = mockChainReader();

      const result = await verifyAttestation(req, chain, nonceManager, config);

      // modelHash should be keccak256("grok-4.1-fast"), NOT keccak256("x-ai/grok-4.1-fast")
      expect(result.modelHash).toBe(TEST_MODEL_HASH);
      expect(result.totalTokens).toBe(2500n);
    });

    it('should accept mixed: request uses OpenRouter name, response uses OpenRouter name', async () => {
      const nonce = getNonce();
      const seed = '0xabc123';
      const epoch = 42;
      const claimIndex = 0;
      const req = makeValidAttestRequest(nonce, {
        api_response: makeValidApiResponse({ model: TEST_OPENROUTER_MODEL }),
        api_request: makeValidApiRequest(nonce, seed, epoch, claimIndex, TEST_MINER_ADDRESS, {
          model: TEST_OPENROUTER_MODEL,
        }),
      });
      const chain = mockChainReader();

      const result = await verifyAttestation(req, chain, nonceManager, config);
      expect(result.modelHash).toBe(TEST_MODEL_HASH);
    });

    it('should reject untrusted router prefix', async () => {
      const nonce = getNonce();
      const seed = '0xabc123';
      const epoch = 42;
      const claimIndex = 0;
      const untrustedModel = 'azure/grok-4.1-fast';
      const req = makeValidAttestRequest(nonce, {
        api_response: makeValidApiResponse({ model: untrustedModel }),
        api_request: makeValidApiRequest(nonce, seed, epoch, claimIndex, TEST_MINER_ADDRESS, {
          model: untrustedModel,
        }),
      });
      const chain = mockChainReader();

      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_MODEL');
    });

    it('should reject if request model and response model resolve to different canonical names', async () => {
      const nonce = getNonce();
      const seed = '0xabc123';
      const epoch = 42;
      const claimIndex = 0;
      // request uses direct name, response uses OpenRouter name for a DIFFERENT model
      const req = makeValidAttestRequest(nonce, {
        api_response: makeValidApiResponse({ model: TEST_OPENROUTER_MODEL }),
        api_request: makeValidApiRequest(nonce, seed, epoch, claimIndex, TEST_MINER_ADDRESS, {
          model: 'gpt-4',
        }),
      });
      const chain = mockChainReader();

      await expectOracleError(verifyAttestation(req, chain, nonceManager, config), 'INVALID_MODEL');
    });
  });

  describe('resolveModelAlias', () => {
    const aliases = parseTrustedRouterAliases('x-ai/grok-4.1-fast:grok-4.1-fast');

    it('should resolve OpenRouter model to canonical', () => {
      expect(resolveModelAlias('x-ai/grok-4.1-fast', aliases)).toBe('grok-4.1-fast');
    });

    it('should pass through direct model name unchanged', () => {
      expect(resolveModelAlias('grok-4.1-fast', aliases)).toBe('grok-4.1-fast');
    });

    it('should not resolve untrusted prefix', () => {
      expect(resolveModelAlias('azure/grok-4.1-fast', aliases)).toBe('azure/grok-4.1-fast');
    });

    it('should handle empty alias map', () => {
      const empty = new Map<string, string>();
      expect(resolveModelAlias('x-ai/grok-4.1-fast', empty)).toBe('x-ai/grok-4.1-fast');
    });
  });

  describe('parseTrustedRouterAliases', () => {
    it('should parse single alias', () => {
      const map = parseTrustedRouterAliases('x-ai/grok-4.1-fast:grok-4.1-fast');
      expect(map.size).toBe(1);
      expect(map.get('x-ai/grok-4.1-fast')).toBe('grok-4.1-fast');
    });

    it('should parse multiple aliases', () => {
      const map = parseTrustedRouterAliases('x-ai/grok-4.1-fast:grok-4.1-fast,anthropic/claude-sonnet-4.6:claude-sonnet-4.6');
      expect(map.size).toBe(2);
      expect(map.get('x-ai/grok-4.1-fast')).toBe('grok-4.1-fast');
      expect(map.get('anthropic/claude-sonnet-4.6')).toBe('claude-sonnet-4.6');
    });

    it('should return empty map for empty string', () => {
      const map = parseTrustedRouterAliases('');
      expect(map.size).toBe(0);
    });

    it('should throw on malformed entry', () => {
      expect(() => parseTrustedRouterAliases('badformat')).toThrow();
    });
  });
});
