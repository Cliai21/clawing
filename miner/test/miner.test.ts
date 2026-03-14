import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

// Mocks must not reference top-level variables
vi.mock('../src/oracle.js', () => ({
  getNonce: vi.fn().mockResolvedValue({ nonce: 'CLAW-aabbccdd-1710000000', expires_at: 1710000300 }),
  submitAttestation: vi.fn().mockResolvedValue({
    success: true,
    attestation: {
      miner_address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      model_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      total_tokens: 2500,
      seed_epoch: 42,
      seed: '0xabc123',
      claim_index: 0,
      deadline: 19500200,
      signature: '0x' + 'ab'.repeat(65),
    },
    estimated_reward: '1693100000000000000000000',
  }),
  checkOracleHealth: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/ai-api.js', () => ({
  callAiApi: vi.fn().mockResolvedValue({
    id: 'chatcmpl-test123',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'grok-4.1-fast',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: 'Quantum computing is...' },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 200, completion_tokens: 2300, total_tokens: 2500 },
  }),
}));

// Import after mocks
import { mineOnce, MineError } from '../src/miner.js';
import type { ChainClient } from '../src/chain.js';
import { makeTestConfig, makeChainState, makeMinerState, TEST_MINER_ADDRESS, TEST_MODEL_HASH } from './helpers.js';

function mockChainClient(
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

describe('miner', () => {
  const config = makeTestConfig();

  describe('mineOnce', () => {
    it('should complete a full mining cycle', async () => {
      const chain = mockChainClient();
      const reward = await mineOnce({ chain, config });

      expect(reward).toBe(1693100000000000000000000n);
      expect(chain.getChainState).toHaveBeenCalled();
      expect(chain.getMinerState).toHaveBeenCalled();
      expect(chain.mint).toHaveBeenCalled();
    });

    it('should throw COOLDOWN_ACTIVE when cooldown is active', async () => {
      const chain = mockChainClient(undefined, { cooldownRemaining: 1000n });

      try {
        await mineOnce({ chain, config });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MineError);
        expect((err as MineError).code).toBe('COOLDOWN_ACTIVE');
        expect((err as MineError).waitSeconds).toBe(12000);
      }
    });

    it('should throw EPOCH_LIMIT_REACHED when claim limit hit', async () => {
      const chain = mockChainClient(undefined, { epochClaimCount: 14n });

      try {
        await mineOnce({ chain, config });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MineError);
        expect((err as MineError).code).toBe('EPOCH_LIMIT_REACHED');
      }
    });

    it('should call updateSeed when seed is stale', async () => {
      const chain = mockChainClient({ seedEpoch: 41n });

      // After updateSeed, getChainState returns fresh state
      (chain.getChainState as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeChainState({ seedEpoch: 41n }))
        .mockResolvedValueOnce(makeChainState({ seedEpoch: 42n }));

      await mineOnce({ chain, config });
      expect(chain.updateSeed).toHaveBeenCalled();
    });

    it('should throw GAS_TOO_HIGH when gas exceeds limit', async () => {
      const chain = mockChainClient();
      (chain.getGasPrice as ReturnType<typeof vi.fn>).mockResolvedValue(ethers.parseUnits('50', 'gwei'));

      try {
        await mineOnce({ chain, config });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(MineError);
        expect((err as MineError).code).toBe('GAS_TOO_HIGH');
      }
    });

    it('should use correct claim index from epochClaimCount', async () => {
      const chain = mockChainClient(undefined, { epochClaimCount: 5n });
      await mineOnce({ chain, config });

      const { submitAttestation } = await import('../src/oracle.js');
      const lastCall = (submitAttestation as ReturnType<typeof vi.fn>).mock.lastCall;
      expect(lastCall?.[1].claim_index).toBe(5);
    });
  });
});
