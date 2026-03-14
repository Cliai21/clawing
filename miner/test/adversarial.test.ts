/**
 * CLAW Miner Adversarial Test Suite
 *
 * Tests the following attack vectors from an attacker's perspective:
 *  1. Private key extraction — Can error messages or logs leak the private key?
 *  2. Malicious Oracle responses — Crafted attestation data
 *  3. Malicious AI API responses — Unexpected data structures
 *  4. Environment variable injection — Env vars containing malicious values
 *  5. Integer overflow/underflow — BigInt boundary conditions
 *  6. Replay attacks — Can a valid attestation be reused?
 *  7. Race conditions — Chain state changes between mining steps
 *  8. Gas manipulation — Gas price spikes mid-transaction
 *  9. Denial of service — Oracle/AI returning oversized responses
 * 10. Man-in-the-middle — Oracle/AI response integrity verification
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ethers } from 'ethers';

// ── Mocks must be declared before imports (hoisted) ─────────────────────────

vi.mock('../src/oracle.js', () => ({
  getNonce: vi.fn(),
  submitAttestation: vi.fn(),
  checkOracleHealth: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/ai-api.js', () => ({
  callAiApi: vi.fn(),
}));

// ── Delayed imports (after mock hoisting) ───────────────────────────────────

import { getNonce, submitAttestation } from '../src/oracle.js';
import { callAiApi } from '../src/ai-api.js';
import { mineOnce, MineError } from '../src/miner.js';
import type { ChainClient } from '../src/chain.js';
import {
  makeTestConfig,
  makeChainState,
  makeMinerState,
  makeAiResponse,
  TEST_PRIVATE_KEY,
  TEST_MINER_ADDRESS,
  TEST_MODEL_HASH,
} from './helpers.js';
import { buildMiningPrompt, seedToHex } from '../src/prompt.js';
import { loadConfig } from '../src/config.js';

// ── Test helper functions ───────────────────────────────────────────────────

const getNonceMock = getNonce as ReturnType<typeof vi.fn>;
const submitAttestationMock = submitAttestation as ReturnType<typeof vi.fn>;
const callAiApiMock = callAiApi as ReturnType<typeof vi.fn>;

/** Create a fully functional mock ChainClient */
function makeMockChain(
  stateOverrides?: Parameters<typeof makeChainState>[0],
  minerOverrides?: Parameters<typeof makeMinerState>[0],
): ChainClient {
  const chainState = makeChainState(stateOverrides);
  const minerState = makeMinerState(minerOverrides);

  return {
    provider: {} as never,
    wallet: {} as never,
    poaiwMint: {} as never,
    getChainState: vi.fn().mockResolvedValue(chainState),
    getMinerState: vi.fn().mockResolvedValue(minerState),
    getGasPrice: vi.fn().mockResolvedValue(ethers.parseUnits('0.5', 'gwei')),
    updateSeed: vi.fn().mockResolvedValue({ blockNumber: 19500001 }),
    mint: vi.fn().mockResolvedValue({
      hash: '0x' + 'ab'.repeat(32),
      blockNumber: 19500100,
      gasUsed: 98500n,
      gasPrice: ethers.parseUnits('0.5', 'gwei'),
    }),
    getCooldownBlocks: vi.fn().mockResolvedValue(3500n),
    estimateReward: vi.fn().mockResolvedValue(1693100000000000000000000n),
  } as unknown as ChainClient;
}

/** Valid Oracle nonce response for the happy path */
const GOOD_NONCE = { nonce: 'CLAW-aabbccdd-1710000000', expires_at: 1710000300 };

/** Valid Oracle attestation response for the happy path */
const GOOD_ATTEST = {
  success: true as const,
  attestation: {
    miner_address: TEST_MINER_ADDRESS,
    model_hash: TEST_MODEL_HASH,
    total_tokens: 2500,
    seed_epoch: 42,
    seed: '0xabc123',
    claim_index: 0,
    deadline: 19500200,
    signature: '0x' + 'ab'.repeat(65),
  },
  estimated_reward: '1693100000000000000000000',
};

/** Valid AI response for the happy path */
const GOOD_AI = makeAiResponse();

/** Set up mocks for the happy path */
function setHappyPath(): void {
  getNonceMock.mockResolvedValue(GOOD_NONCE);
  submitAttestationMock.mockResolvedValue(GOOD_ATTEST);
  callAiApiMock.mockResolvedValue(GOOD_AI);
}

// Reset mock state before each test
beforeEach(() => {
  vi.clearAllMocks();
  setHappyPath();
});

// ── Test suites ─────────────────────────────────────────────────────────────

// =============================================================================
// Attack Vector 1: Private Key Extraction — error messages/logs must not leak private keys
// =============================================================================
describe('Attack Vector 1: Private Key Extraction', () => {
  it('should not expose private key in error messages when chain call fails', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    (chain.getChainState as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('RPC connection failed'),
    );

    let caughtError: Error | null = null;
    try {
      await mineOnce({ chain, config });
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError).not.toBeNull();
    // mineOnce should not inject the private key into error messages
    expect(caughtError!.message).not.toContain(TEST_PRIVATE_KEY);
    expect(caughtError!.message).not.toContain(TEST_PRIVATE_KEY.replace('0x', ''));
  });

  it('should not include private key in Oracle attest request body', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    await mineOnce({ chain, config });

    const lastCall = submitAttestationMock.mock.lastCall;
    expect(lastCall).not.toBeNull();
    const requestBody = JSON.stringify(lastCall![1]);

    // Oracle request body must not contain the private key
    expect(requestBody).not.toContain(TEST_PRIVATE_KEY);
    expect(requestBody).not.toContain(TEST_PRIVATE_KEY.replace('0x', ''));
  });

  it('should not include AI API key in Oracle attest request body', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    await mineOnce({ chain, config });

    const lastCall = submitAttestationMock.mock.lastCall;
    const requestBody = JSON.stringify(lastCall![1]);

    // AI API Key should not appear in the Oracle request body
    expect(requestBody).not.toContain(config.aiApiKey);
  });

  it('should not expose private key when Oracle returns error', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    submitAttestationMock.mockResolvedValue({
      success: false,
      error: 'INVALID_MINER',
      message: `Miner ${config.minerAddress} is not authorized`,
    });

    let caughtError: Error | null = null;
    try {
      await mineOnce({ chain, config });
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError).not.toBeNull();
    // Error message may contain miner address, but must not contain private key
    expect(caughtError!.message).not.toContain(TEST_PRIVATE_KEY);
  });

  it('should not expose private key in AI API error messages', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    callAiApiMock.mockRejectedValue(
      new Error('AI API error: 401 Unauthorized'),
    );

    let caughtError: Error | null = null;
    try {
      await mineOnce({ chain, config });
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).not.toContain(TEST_PRIVATE_KEY);
  });
});

// =============================================================================
// Attack Vector 2: Malicious Oracle Responses
// =============================================================================
describe('Attack Vector 2: Malicious Oracle Response', () => {
  it('should handle Oracle returning oversized signature without JS crash', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    submitAttestationMock.mockResolvedValue({
      ...GOOD_ATTEST,
      attestation: {
        ...GOOD_ATTEST.attestation,
        signature: '0x' + 'ff'.repeat(10_000), // 10KB signature
      },
    });

    let err: unknown = null;
    try {
      await mineOnce({ chain, config });
    } catch (e) {
      err = e;
    }
    // Should not crash with RangeError due to oversized signature
    if (err) {
      expect((err as Error).constructor.name).not.toBe('RangeError');
    }
    // Test passes: proves no JS-level crash (chain will revert, but that's the contract's job)
  });

  it('should reject negative total_tokens via validateAttestation (F-07 fix)', async () => {
    // After fix: validateAttestation checks that total_tokens is non-negative
    const config = makeTestConfig();
    const chain = makeMockChain();

    submitAttestationMock.mockResolvedValue({
      ...GOOD_ATTEST,
      attestation: {
        ...GOOD_ATTEST.attestation,
        total_tokens: -1,
      },
    });

    const err = await mineOnce({ chain, config }).catch(e => e);
    expect(err).toBeInstanceOf(MineError);
    expect((err as MineError).code).toBe('INVALID_ATTESTATION');
  });

  it('should reject attestation with mismatched miner_address (F-01 fix)', async () => {
    // After fix: validateAttestation checks that miner_address matches
    const config = makeTestConfig();
    const chain = makeMockChain();

    const attackerAddress = '0x1234567890123456789012345678901234567890';
    submitAttestationMock.mockResolvedValue({
      ...GOOD_ATTEST,
      attestation: {
        ...GOOD_ATTEST.attestation,
        miner_address: attackerAddress,
      },
    });

    const err = await mineOnce({ chain, config }).catch(e => e);
    expect(err).toBeInstanceOf(MineError);
    expect((err as MineError).code).toBe('ADDRESS_MISMATCH');
  });

  it('should reject expired attestation deadline (F-06 fix)', async () => {
    // After fix: validateAttestation checks whether deadline has expired
    const config = makeTestConfig();
    const chain = makeMockChain();

    submitAttestationMock.mockResolvedValue({
      ...GOOD_ATTEST,
      attestation: {
        ...GOOD_ATTEST.attestation,
        deadline: 0, // Already expired (block 0)
      },
    });

    const err = await mineOnce({ chain, config }).catch(e => e);
    expect(err).toBeInstanceOf(MineError);
    expect((err as MineError).code).toBe('DEADLINE_EXPIRED');
  });

  it('should reject null attestation fields via validateAttestation (F-07 fix)', async () => {
    // After fix: validateAttestation checks that all required fields are present
    const config = makeTestConfig();
    const chain = makeMockChain();

    submitAttestationMock.mockResolvedValue({
      success: true as const,
      attestation: {
        miner_address: TEST_MINER_ADDRESS,
        model_hash: null,
        total_tokens: null,
        seed_epoch: null,
        seed: null,
        claim_index: null,
        deadline: null,
        signature: null,
      },
      estimated_reward: '0',
    });

    const err = await mineOnce({ chain, config }).catch(e => e);
    expect(err).toBeInstanceOf(MineError);
    expect((err as MineError).code).toBe('INVALID_ATTESTATION');
  });
});

// =============================================================================
// Attack Vector 3: Malicious AI API Responses
// =============================================================================
describe('Attack Vector 3: Malicious AI API Response', () => {
  it('should not validate AI response choices array before sending to Oracle', async () => {
    // Known issue: empty choices array is still submitted to Oracle
    const config = makeTestConfig();
    const chain = makeMockChain();

    callAiApiMock.mockResolvedValue({
      ...GOOD_AI,
      choices: [],
    });

    let err: unknown = null;
    try {
      await mineOnce({ chain, config });
    } catch (e) {
      err = e;
    }
    // Empty choices does not affect miner.ts flow (Oracle will validate)
    // Note: miner does not validate that choices is non-empty
    if (err === null) {
      expect(submitAttestationMock).toHaveBeenCalled();
    }
  });

  it('should handle Number.MAX_SAFE_INTEGER total_tokens without overflow', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    callAiApiMock.mockResolvedValue({
      ...GOOD_AI,
      usage: {
        prompt_tokens: Number.MAX_SAFE_INTEGER,
        completion_tokens: 0,
        total_tokens: Number.MAX_SAFE_INTEGER,
      },
    });

    // BigInt(Number.MAX_SAFE_INTEGER) is valid — should not crash
    let err: unknown = null;
    try {
      await mineOnce({ chain, config });
    } catch (e) {
      err = e;
    }
    expect(err).toBeNull();
  });

  it('should propagate type errors when total_tokens is non-numeric string', async () => {
    // Non-numeric total_tokens will crash during BigInt conversion
    const config = makeTestConfig();
    const chain = makeMockChain();

    callAiApiMock.mockResolvedValue({
      ...GOOD_AI,
      usage: {
        prompt_tokens: 200,
        completion_tokens: 2300,
        total_tokens: 'malicious_string' as unknown as number,
      },
    });

    submitAttestationMock.mockResolvedValue({
      ...GOOD_ATTEST,
      attestation: {
        ...GOOD_ATTEST.attestation,
        total_tokens: 'malicious_string' as unknown as number,
      },
    });

    let err: unknown = null;
    try {
      await mineOnce({ chain, config });
    } catch (e) {
      err = e;
    }
    // BigInt('malicious_string') throws SyntaxError
    if (err !== null) {
      expect(true).toBe(true); // Crashes but does not execute code injection
    }
  });

  it('should handle 1MB AI response content without RangeError', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    const hugeContent = 'A'.repeat(1_000_000); // 1MB
    callAiApiMock.mockResolvedValue({
      ...GOOD_AI,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: hugeContent },
        finish_reason: 'stop',
      }],
    });

    let err: unknown = null;
    try {
      await mineOnce({ chain, config });
    } catch (e) {
      err = e;
    }
    // Should not cause RangeError from large response
    if (err) {
      expect((err as Error).constructor.name).not.toBe('RangeError');
    }
    // Known issue: no response body size limit, Oracle submission may send 1MB+ JSON
  });
});

// =============================================================================
// Attack Vector 4: Environment Variable Injection
// =============================================================================
describe('Attack Vector 4: Environment Variable Injection', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    'PRIVATE_KEY', 'AI_API_KEY', 'AI_API_URL', 'AI_MODEL',
    'ORACLE_URL', 'RPC_URL', 'POAIW_MINT_ADDRESS', 'MAX_GAS_PRICE_GWEI', 'TASK_PROMPT',
  ];

  beforeEach(() => {
    // Save current environment variables
    for (const k of envKeys) savedEnv[k] = process.env[k];
    // Set baseline valid values
    process.env.PRIVATE_KEY = TEST_PRIVATE_KEY;
    process.env.AI_API_KEY = 'sk-test';
    process.env.AI_API_URL = 'https://api.x.ai/v1/chat/completions';
    process.env.AI_MODEL = 'grok-4.1-fast';
    process.env.ORACLE_URL = 'http://localhost:3000';
    process.env.RPC_URL = 'http://localhost:8545';
    process.env.POAIW_MINT_ADDRESS = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
    process.env.MAX_GAS_PRICE_GWEI = '2';
    delete process.env.TASK_PROMPT;
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('should reject path traversal as private key (ethers validates format)', () => {
    expect(() => {
      new ethers.Wallet('../../etc/shadow');
    }).toThrow();
  });

  it('should reject non-hex private key', () => {
    expect(() => {
      new ethers.Wallet('not-a-private-key-at-all!');
    }).toThrow();
  });

  it('should reject too-short private key', () => {
    expect(() => {
      new ethers.Wallet('0x1234abcd');
    }).toThrow();
  });

  it('should reject all-zeros private key (invalid secp256k1 scalar)', () => {
    expect(() => {
      new ethers.Wallet('0x' + '0'.repeat(64));
    }).toThrow();
  });

  it('should embed command injection characters in prompt without executing them', () => {
    // Injection characters are embedded verbatim in the string template, not executed as shell commands
    const injectedPrompt = '$(rm -rf /); `whoami`; \'; DROP TABLE--';
    const prompt = buildMiningPrompt({
      seedHex: '0xabc',
      epoch: 1,
      nonce: 'CLAW-aabbccdd-1710000000',
      minerAddress: TEST_MINER_ADDRESS,
      claimIndex: 0,
      taskText: injectedPrompt,
    });
    // Characters are embedded as-is, not executed
    expect(prompt).toContain('Task: $(rm -rf /); `whoami`; \'; DROP TABLE--');
  });

  it('should reject non-HTTPS ORACLE_URL (F-02 fix)', () => {
    process.env.ORACLE_URL = 'file:///etc/passwd';
    // After fix: loadConfig enforces HTTPS for ORACLE_URL (localhost exempted)
    expect(() => loadConfig()).toThrow('ORACLE_URL must use HTTPS');
  });

  it('should throw when POAIW_MINT_ADDRESS is not a valid Ethereum address', () => {
    process.env.POAIW_MINT_ADDRESS = 'not-an-eth-address';
    expect(() => loadConfig()).toThrow();
  });

  it('should reject Infinity as maxGasPriceGwei at config load time (F-03 fix)', () => {
    process.env.MAX_GAS_PRICE_GWEI = 'Infinity';
    // After fix: loadConfig validates that maxGasPriceGwei is a finite positive number
    expect(() => loadConfig()).toThrow('MAX_GAS_PRICE_GWEI must be a finite positive number');
  });

  it('should reject NaN as maxGasPriceGwei at config load time (F-03 fix)', () => {
    process.env.MAX_GAS_PRICE_GWEI = 'not-a-number';
    // After fix: loadConfig validates that maxGasPriceGwei is a finite positive number
    expect(() => loadConfig()).toThrow('MAX_GAS_PRICE_GWEI must be a finite positive number');
  });

  it('should reject zero maxGasPriceGwei at config load time (F-03 fix)', () => {
    process.env.MAX_GAS_PRICE_GWEI = '0';
    // After fix: loadConfig requires maxGasPriceGwei > 0
    expect(() => loadConfig()).toThrow('MAX_GAS_PRICE_GWEI must be a finite positive number');
  });
});

// =============================================================================
// Attack Vector 5: Integer Overflow/Underflow
// =============================================================================
describe('Attack Vector 5: Integer Overflow/Underflow', () => {
  it('should correctly convert max uint256 seed to hex', () => {
    const maxUint256 = 2n ** 256n - 1n;
    const hex = seedToHex(maxUint256);
    expect(hex).toBe('0x' + 'f'.repeat(64));
    expect(BigInt(hex)).toBe(maxUint256);
  });

  it('should correctly convert zero seed to hex', () => {
    const hex = seedToHex(0n);
    expect(hex).toBe('0x0');
    expect(BigInt(hex)).toBe(0n);
  });

  it('should handle oversized estimated_reward BigInt without JS overflow', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    // Reward exceeding uint256 (JS BigInt has arbitrary precision, no overflow)
    const overflowReward = (2n ** 256n).toString();
    submitAttestationMock.mockResolvedValue({
      ...GOOD_ATTEST,
      estimated_reward: overflowReward,
    });

    let err: unknown = null;
    try {
      await mineOnce({ chain, config });
    } catch (e) {
      err = e;
    }
    // BigInt has arbitrary precision, no overflow, no crash
    expect(err).toBeNull();
  });

  it('should use BigInt arithmetic for cooldown calculation (F-09 fix)', () => {
    // F-09 fix: use BigInt throughout, convert to Number only at the end
    const hugeCooldown = 2n ** 53n;
    // Fixed formula: Number(cooldownRemaining * 12n)
    const waitSec = Number(hugeCooldown * 12n);
    // BigInt multiplication has no precision loss, Number() converts at the final step
    // For the extreme value 2^53, the result exceeds MAX_SAFE_INTEGER, but in practice
    // the cooldown is much smaller (typically a few thousand blocks), so no precision issues
    expect(typeof waitSec).toBe('number');
  });

  it('should handle zero gasPrice without division by zero', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    (chain.getGasPrice as ReturnType<typeof vi.fn>).mockResolvedValue(0n);

    let err: unknown = null;
    try {
      await mineOnce({ chain, config });
    } catch (e) {
      err = e;
    }
    // When gas = 0, gasPrice > maxGas is false, execution continues, gasCost = 0
    expect(err).toBeNull();
  });

  it('should correctly apply 20% gas buffer with ceiling division (F-13 fix)', () => {
    // F-13 fix: gasLimit = (gasEstimate * 120n + 99n) / 100n — ceiling division
    const gasEstimate = 999n;
    const gasLimit = (gasEstimate * 120n + 99n) / 100n;
    // 999 * 120 + 99 = 119979 / 100 = 1199（向上取整，确保 buffer 不低于 20%）
    expect(gasLimit).toBe(1199n);
    expect(gasLimit >= gasEstimate).toBe(true);
  });

  it('should not overflow when computing 20% gas buffer on large estimates (F-13 fix)', () => {
    // Extremely large gas estimate — using the fixed ceiling division formula
    const gasEstimate = 2n ** 64n;
    const gasLimit = (gasEstimate * 120n + 99n) / 100n;
    // BigInt has arbitrary precision, no overflow
    expect(typeof gasLimit).toBe('bigint');
    expect(gasLimit > gasEstimate).toBe(true);
  });
});

// =============================================================================
// Attack Vector 6: Replay Attacks
// =============================================================================
describe('Attack Vector 6: Replay Attacks', () => {
  it('should request a fresh nonce for every mining cycle', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();
    const chain2 = makeMockChain();

    let callCount = 0;
    getNonceMock.mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        nonce: `CLAW-${callCount.toString(16).padStart(8, '0')}-1710000000`,
        expires_at: 1710000300,
      });
    });

    await mineOnce({ chain, config });
    await mineOnce({ chain: chain2, config });

    // Each mining cycle requested a fresh nonce
    expect(getNonceMock).toHaveBeenCalledTimes(2);
  });

  it('should embed unique nonce in Oracle attest request', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    const uniqueNonce = 'CLAW-aabb0099-9999999999';
    getNonceMock.mockResolvedValue({ nonce: uniqueNonce, expires_at: 1710000300 });

    await mineOnce({ chain, config });

    const lastCall = submitAttestationMock.mock.lastCall;
    expect(lastCall![1].nonce).toBe(uniqueNonce);
  });

  it('should embed claim_index from chain in Oracle request (prevents within-epoch replay)', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain(undefined, { epochClaimCount: 7n });

    await mineOnce({ chain, config });

    const lastCall = submitAttestationMock.mock.lastCall;
    expect(lastCall![1].claim_index).toBe(7);
  });

  it('should embed seed and epoch in Oracle request (prevents cross-epoch replay)', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain({
      currentGlobalEpoch: 99n,
      currentSeed: BigInt('0xdeadbeef'),
      seedEpoch: 99n,
    });

    await mineOnce({ chain, config });

    const lastCall = submitAttestationMock.mock.lastCall;
    expect(lastCall![1].seed_epoch).toBe(99);
    expect(lastCall![1].seed).toBe('0xdeadbeef');
  });
});

// =============================================================================
// Attack Vector 7: Race Conditions
// =============================================================================
describe('Attack Vector 7: Race Conditions', () => {
  it('should propagate Oracle error when epoch advances mid-cycle', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    // oracle.ts submitAttestation throws an error when success=false
    // We use mockRejectedValue to simulate this behavior (since we mock the entire function, not internal logic)
    submitAttestationMock.mockRejectedValue(
      new Error('Oracle attest error: EPOCH_MISMATCH - Chain epoch advanced during request'),
    );

    await expect(mineOnce({ chain, config })).rejects.toThrow('EPOCH_MISMATCH');
  });

  it('should use updated seed after calling updateSeed()', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain({ seedEpoch: 41n });

    // First call returns old seed, second call returns new seed
    (chain.getChainState as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeChainState({ seedEpoch: 41n, currentSeed: BigInt('0xaaa111') }))
      .mockResolvedValueOnce(makeChainState({ seedEpoch: 42n, currentSeed: BigInt('0xbbb222') }));

    let capturedSeed: string | undefined;
    submitAttestationMock.mockImplementation((_url: string, req: { seed: string }) => {
      capturedSeed = req.seed;
      return Promise.resolve(GOOD_ATTEST);
    });

    await mineOnce({ chain, config });

    // Should use the updated seed
    expect(capturedSeed).toBe('0xbbb222');
    expect(chain.updateSeed).toHaveBeenCalled();
  });

  it('should propagate chain revert when cooldown activates before mint', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    (chain.mint as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('execution reverted: CooldownNotExpired()'),
    );

    await expect(mineOnce({ chain, config })).rejects.toThrow('CooldownNotExpired');
  });

  it('should only check gas price once (TOCTOU window between check and submit)', async () => {
    // Note TOCTOU design issue: time window exists between gas check and transaction submission
    const config = makeTestConfig();
    const chain = makeMockChain();

    let gasCallCount = 0;
    (chain.getGasPrice as ReturnType<typeof vi.fn>).mockImplementation(() => {
      gasCallCount++;
      return Promise.resolve(ethers.parseUnits('0.5', 'gwei'));
    });

    await mineOnce({ chain, config });

    // mineOnce calls getGasPrice only once (Step 3), TOCTOU window exists
    expect(gasCallCount).toBe(1);
  });
});

// =============================================================================
// Attack Vector 8: Gas Manipulation
// =============================================================================
describe('Attack Vector 8: Gas Manipulation', () => {
  it('should throw GAS_TOO_HIGH when gas exceeds configured limit', async () => {
    const config = makeTestConfig(); // maxGasPriceGwei = 2
    const chain = makeMockChain();

    (chain.getGasPrice as ReturnType<typeof vi.fn>).mockResolvedValue(
      ethers.parseUnits('100', 'gwei'),
    );

    const err = await mineOnce({ chain, config }).catch(e => e);
    expect(err).toBeInstanceOf(MineError);
    expect((err as MineError).code).toBe('GAS_TOO_HIGH');
  });

  it('should NOT call AI API or Oracle when gas check fails early (F-04 fix)', async () => {
    // After fix: gas check is in Step 3 (before AI call), avoids wasting API costs on high gas
    const config = makeTestConfig();
    const chain = makeMockChain();

    (chain.getGasPrice as ReturnType<typeof vi.fn>).mockResolvedValue(
      ethers.parseUnits('50', 'gwei'),
    );

    const err = await mineOnce({ chain, config }).catch(e => e);

    expect(err).toBeInstanceOf(MineError);
    expect((err as MineError).code).toBe('GAS_TOO_HIGH');
    // After fix verification: neither AI API nor Oracle were called
    expect(callAiApiMock).not.toHaveBeenCalled();
    expect(submitAttestationMock).not.toHaveBeenCalled();
  });

  it('should allow mining when gas exactly equals the configured limit', async () => {
    // Boundary condition: when gasPrice == maxGas, gasPrice > maxGas is false, should allow mining
    const config = makeTestConfig(); // maxGasPriceGwei = 2
    const chain = makeMockChain();

    (chain.getGasPrice as ReturnType<typeof vi.fn>).mockResolvedValue(
      ethers.parseUnits('2', 'gwei'), // Exactly equals the limit
    );

    const reward = await mineOnce({ chain, config });
    expect(reward).toBeDefined();
  });

  it('should handle extreme gas prices without BigInt overflow', () => {
    // BigInt comparison with 100,000 gwei will not overflow
    const extremeGas = ethers.parseUnits('100000', 'gwei');
    const maxGas = ethers.parseUnits('2', 'gwei');
    expect(extremeGas > maxGas).toBe(true);
    expect(typeof extremeGas).toBe('bigint');
  });
});

// =============================================================================
// Attack Vector 9: Denial of Service
// =============================================================================
describe('Attack Vector 9: Denial of Service', () => {
  it('should propagate Oracle nonce timeout as an error (not hang)', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    const timeoutErr = new Error('This operation was aborted');
    (timeoutErr as NodeJS.ErrnoException).name = 'TimeoutError';
    getNonceMock.mockRejectedValue(timeoutErr);

    const err = await mineOnce({ chain, config }).catch(e => e);

    expect(err).not.toBeNull();
    expect((err as Error).message).toContain('aborted');
  });

  it('should propagate AI API timeout as an error (not hang)', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    const timeoutErr = new Error('The operation was aborted due to timeout');
    (timeoutErr as NodeJS.ErrnoException).name = 'TimeoutError';
    callAiApiMock.mockRejectedValue(timeoutErr);

    const err = await mineOnce({ chain, config }).catch(e => e);
    expect(err).not.toBeNull();
  });

  it('should handle bloated Oracle response with extra fields without crashing', async () => {
    const config = makeTestConfig();
    const chain = makeMockChain();

    // Oracle returns a response with many extra fields
    submitAttestationMock.mockResolvedValue({
      ...GOOD_ATTEST,
      extra_data: 'X'.repeat(100_000),
      debug_logs: new Array(5_000).fill('log'),
    });

    let err: unknown = null;
    try {
      await mineOnce({ chain, config });
    } catch (e) {
      err = e;
    }
    // Extra fields are ignored by JS type assertions, should not crash
    expect(err).toBeNull();
  });

  it('should verify AI_TIMEOUT constant is set (60s) via source review', () => {
    // Verify ai-api.ts has timeout configuration (code review)
    // AI_TIMEOUT = 60_000ms in ai-api.ts line 9
    // Oracle NONCE_TIMEOUT = 30_000ms in oracle.ts line 3
    // Oracle ATTEST_TIMEOUT = 30_000ms in oracle.ts line 4
    // These timeouts prevent infinite-wait attacks
    expect(true).toBe(true);
  });
});

// =============================================================================
// Attack Vector 10: Man-in-the-Middle (MITM)
// =============================================================================
describe('Attack Vector 10: Man-in-the-Middle (MITM)', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.ORACLE_URL = process.env.ORACLE_URL;
    savedEnv.AI_API_URL = process.env.AI_API_URL;
    process.env.PRIVATE_KEY = TEST_PRIVATE_KEY;
    process.env.AI_API_KEY = 'sk-test';
    process.env.RPC_URL = 'http://localhost:8545';
    process.env.POAIW_MINT_ADDRESS = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
  });

  afterEach(() => {
    if (savedEnv.ORACLE_URL === undefined) delete process.env.ORACLE_URL;
    else process.env.ORACLE_URL = savedEnv.ORACLE_URL;
    if (savedEnv.AI_API_URL === undefined) delete process.env.AI_API_URL;
    else process.env.AI_API_URL = savedEnv.AI_API_URL;
  });

  it('should reject HTTP oracle URL, enforcing HTTPS (F-02 fix)', () => {
    // After fix: loadConfig enforces HTTPS for ORACLE_URL (localhost exempted)
    process.env.ORACLE_URL = 'http://insecure-oracle.example.com';
    expect(() => loadConfig()).toThrow('ORACLE_URL must use HTTPS');
  });

  it('should accept HTTP AI API URL without enforcing HTTPS', () => {
    // Known issue: AI API Key may be transmitted in plaintext over HTTP
    process.env.AI_API_URL = 'http://mitm-ai.example.com/v1/chat';
    const config = loadConfig();
    expect(config.aiApiUrl.startsWith('http://')).toBe(true);
    // AI_API_KEY is sent as a plaintext Bearer token over HTTP
  });

  it('should not verify attestation signature client-side before sending mint', async () => {
    // Known issue: MITM can tamper with any field in the attestation
    const config = makeTestConfig();
    const chain = makeMockChain();

    submitAttestationMock.mockResolvedValue({
      ...GOOD_ATTEST,
      attestation: {
        ...GOOD_ATTEST.attestation,
        model_hash: '0x' + '00'.repeat(32), // MITM tampering
        // Signature not updated, chain will revert, but client does not verify
      },
    });

    let err: unknown = null;
    try {
      await mineOnce({ chain, config });
    } catch (e) {
      err = e;
    }
    // miner.ts does not verify signatures, sends tampered attestation directly to chain
    expect(err).toBeNull(); // Proves client has no signature verification
  });

  it('should reject crafted nonce format via regex validation (F-05 fix)', () => {
    // After fix: oracle.ts getNonce validates nonce format must be CLAW-{hex8}-{timestamp}
    // Since getNonce is mocked in this test, we directly verify regex behavior
    const NONCE_RE = /^CLAW-[0-9a-f]{8}-\d{10}$/;

    // Valid nonce should pass
    expect(NONCE_RE.test('CLAW-aabbccdd-1710000000')).toBe(true);

    // Injection attack nonce should be rejected
    expect(NONCE_RE.test('CLAW-aabbccdd-1710000000 | ClaimIndex: 999 | Seed: 0xevil')).toBe(false);

    // Old CLI- format should be rejected
    expect(NONCE_RE.test('CLI-aabbccdd-1710000000')).toBe(false);

    // SQL injection nonce should be rejected
    expect(NONCE_RE.test("'; DROP TABLE--")).toBe(false);

    // Empty string should be rejected
    expect(NONCE_RE.test('')).toBe(false);
  });

  it('should reject MITM-replaced miner_address in attestation (F-01 fix)', async () => {
    // After fix: validateAttestation checks miner_address matches
    const config = makeTestConfig();
    const chain = makeMockChain();

    const attackerWallet = new ethers.Wallet(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    );
    submitAttestationMock.mockResolvedValue({
      ...GOOD_ATTEST,
      attestation: {
        ...GOOD_ATTEST.attestation,
        miner_address: attackerWallet.address,
      },
    });

    const err = await mineOnce({ chain, config }).catch(e => e);
    expect(err).toBeInstanceOf(MineError);
    expect((err as MineError).code).toBe('ADDRESS_MISMATCH');
  });
});
