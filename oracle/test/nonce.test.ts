import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NonceManager, NonceError } from '../src/nonce.js';
import { makeTestConfig, TEST_MINER_ADDRESS } from './helpers.js';

describe('NonceManager', () => {
  let nonceManager: NonceManager;

  beforeEach(() => {
    nonceManager = new NonceManager(makeTestConfig());
  });

  afterEach(() => {
    nonceManager.close();
  });

  describe('generate', () => {
    it('should generate a nonce with correct format', () => {
      const result = nonceManager.generate(TEST_MINER_ADDRESS);
      expect(result.nonce).toMatch(/^CLAW-[0-9a-f]{8}-\d+$/);
      expect(result.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('should generate unique nonces', () => {
      const n1 = nonceManager.generate(TEST_MINER_ADDRESS);
      const n2 = nonceManager.generate(TEST_MINER_ADDRESS);
      expect(n1.nonce).not.toBe(n2.nonce);
    });

    it('should respect max outstanding nonce limit', () => {
      // Generate max nonces
      for (let i = 0; i < 3; i++) {
        nonceManager.generate(TEST_MINER_ADDRESS);
      }
      // 4th should fail
      expect(() => nonceManager.generate(TEST_MINER_ADDRESS)).toThrow('Max outstanding nonces');
    });

    it('should allow more nonces after using existing ones', () => {
      const n1 = nonceManager.generate(TEST_MINER_ADDRESS);
      nonceManager.generate(TEST_MINER_ADDRESS);
      nonceManager.generate(TEST_MINER_ADDRESS);

      // Use one
      nonceManager.validate(n1.nonce, TEST_MINER_ADDRESS);

      // Should now be able to generate one more
      const n4 = nonceManager.generate(TEST_MINER_ADDRESS);
      expect(n4.nonce).toMatch(/^CLAW-/);
    });
  });

  describe('validate', () => {
    it('should succeed for valid unused nonce', () => {
      const { nonce } = nonceManager.generate(TEST_MINER_ADDRESS);
      expect(() => nonceManager.validate(nonce, TEST_MINER_ADDRESS)).not.toThrow();
    });

    it('should reject nonexistent nonce', () => {
      expect(() => nonceManager.validate('CLAW-00000000-9999999999', TEST_MINER_ADDRESS)).toThrow(NonceError);
      try {
        nonceManager.validate('CLAW-00000000-9999999999', TEST_MINER_ADDRESS);
      } catch (e) {
        expect((e as NonceError).code).toBe('INVALID_NONCE');
      }
    });

    it('should reject already-used nonce', () => {
      const { nonce } = nonceManager.generate(TEST_MINER_ADDRESS);
      nonceManager.validate(nonce, TEST_MINER_ADDRESS);

      try {
        nonceManager.validate(nonce, TEST_MINER_ADDRESS);
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as NonceError).code).toBe('NONCE_ALREADY_USED');
      }
    });

    it('should reject nonce for wrong miner', () => {
      const { nonce } = nonceManager.generate(TEST_MINER_ADDRESS);
      const otherMiner = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

      try {
        nonceManager.validate(nonce, otherMiner);
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as NonceError).code).toBe('INVALID_NONCE');
      }
    });
  });

  describe('cleanup', () => {
    it('should remove expired nonces', async () => {
      // Create a nonce manager with very short TTL (1 second)
      const shortConfig = { ...makeTestConfig(), nonceTtlSeconds: 1 };
      const shortManager = new NonceManager(shortConfig);

      const { nonce } = shortManager.generate(TEST_MINER_ADDRESS);

      // Wait for nonce to expire (TTL=1s, wait 2s for safety)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Clean up expired nonces
      const cleaned = shortManager.cleanup();
      expect(cleaned).toBeGreaterThanOrEqual(1);

      // Should no longer be valid (deleted by cleanup)
      try {
        shortManager.validate(nonce, TEST_MINER_ADDRESS);
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as NonceError).code).toBe('INVALID_NONCE');
      }

      shortManager.close();
    });
  });
});
