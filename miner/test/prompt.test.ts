import { describe, it, expect } from 'vitest';
import { buildMiningPrompt, buildMessages, seedToHex } from '../src/prompt.js';
import { TEST_MINER_ADDRESS } from './helpers.js';

describe('prompt', () => {
  describe('seedToHex', () => {
    it('should convert BigInt seed to hex string with 0x prefix', () => {
      expect(seedToHex(BigInt('0xabc123'))).toBe('0xabc123');
    });

    it('should handle zero seed', () => {
      expect(seedToHex(0n)).toBe('0x0');
    });

    it('should handle large seed', () => {
      const large = 2n ** 255n;
      const hex = seedToHex(large);
      expect(hex).toMatch(/^0x[0-9a-f]+$/);
      expect(BigInt(hex)).toBe(large);
    });
  });

  describe('buildMiningPrompt', () => {
    it('should produce correct format', () => {
      const prompt = buildMiningPrompt({
        seedHex: '0xabc123',
        epoch: 42,
        nonce: 'CLAW-12345678-1710000000',
        minerAddress: TEST_MINER_ADDRESS,
        claimIndex: 3,
        taskText: 'Explain quantum computing.',
      });

      expect(prompt).toBe(
        `Clawing Mining | Seed: 0xabc123 | Epoch: 42 | Nonce: CLAW-12345678-1710000000 | Miner: ${TEST_MINER_ADDRESS} | ClaimIndex: 3 | Task: Explain quantum computing.`,
      );
    });

    it('should contain all fields the Oracle verifier checks', () => {
      const nonce = 'CLAW-aabbccdd-9999999999';
      const seed = '0xdeadbeef';
      const prompt = buildMiningPrompt({
        seedHex: seed,
        epoch: 100,
        nonce,
        minerAddress: TEST_MINER_ADDRESS,
        claimIndex: 0,
        taskText: 'Test task.',
      });

      // Oracle Step 4 checks:
      expect(prompt).toContain('Clawing Mining');
      expect(prompt).toContain(seed); // seed hex
      expect(prompt).toContain('Epoch: 100');
      expect(prompt).toContain(`Nonce: ${nonce}`);
      expect(prompt.toLowerCase()).toContain(TEST_MINER_ADDRESS.toLowerCase());
      expect(prompt).toContain('ClaimIndex: 0');
      expect(prompt).toContain('Task:');
    });

    it('should work with zero claim index', () => {
      const prompt = buildMiningPrompt({
        seedHex: '0x0',
        epoch: 0,
        nonce: 'CLAW-00000000-0',
        minerAddress: TEST_MINER_ADDRESS,
        claimIndex: 0,
        taskText: 'Test.',
      });

      expect(prompt).toContain('ClaimIndex: 0');
      expect(prompt).toContain('Epoch: 0');
    });

    it('should work with special characters in task', () => {
      const prompt = buildMiningPrompt({
        seedHex: '0xabc',
        epoch: 1,
        nonce: 'CLAW-11111111-1111111111',
        minerAddress: TEST_MINER_ADDRESS,
        claimIndex: 5,
        taskText: 'What is 2+2? Explain "quantum" effects & more!',
      });

      expect(prompt).toContain('Task: What is 2+2? Explain "quantum" effects & more!');
    });

    it('should handle very large seed hex', () => {
      const largeSeed = '0x' + 'f'.repeat(64);
      const prompt = buildMiningPrompt({
        seedHex: largeSeed,
        epoch: 999,
        nonce: 'CLAW-ffffffff-9999999999',
        minerAddress: TEST_MINER_ADDRESS,
        claimIndex: 13,
        taskText: 'Task.',
      });

      expect(prompt).toContain(`Seed: ${largeSeed}`);
    });
  });

  describe('buildMessages', () => {
    it('should return system + user messages', () => {
      const messages = buildMessages({
        seedHex: '0xabc123',
        epoch: 42,
        nonce: 'CLAW-12345678-1710000000',
        minerAddress: TEST_MINER_ADDRESS,
        claimIndex: 0,
        taskText: 'Test.',
      });

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toBe('You are a helpful assistant.');
      expect(messages[1].role).toBe('user');
      expect(messages[1].content).toContain('Clawing Mining');
    });
  });
});
