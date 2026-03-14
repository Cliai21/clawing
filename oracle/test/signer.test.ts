import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { signAttestation, recoverSigner, computeDataHash } from '../src/signer.js';
import {
  TEST_WALLET, TEST_CHAIN_ID, TEST_VERIFIER_ADDRESS,
  TEST_MINER_ADDRESS, TEST_MODEL_HASH,
} from './helpers.js';

describe('signer', () => {
  describe('computeDataHash', () => {
    it('should produce a 32-byte keccak hash', () => {
      const hash = computeDataHash(
        TEST_CHAIN_ID, TEST_VERIFIER_ADDRESS, TEST_MINER_ADDRESS,
        TEST_MODEL_HASH, 950n, 42n, 0xabc123n, 0n, 1000n,
      );
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('should match manual ABI encoding', () => {
      const params = [TEST_CHAIN_ID, TEST_VERIFIER_ADDRESS, TEST_MINER_ADDRESS, TEST_MODEL_HASH, 950n, 42n, 0xabc123n, 0n, 1000n] as const;
      const hash = computeDataHash(...params);

      const manual = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'address', 'address', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
          [...params],
        ),
      );
      expect(hash).toBe(manual);
    });

    it('should change when any parameter changes', () => {
      const base = computeDataHash(
        TEST_CHAIN_ID, TEST_VERIFIER_ADDRESS, TEST_MINER_ADDRESS,
        TEST_MODEL_HASH, 950n, 42n, 0xabc123n, 0n, 1000n,
      );

      // Change chainId
      const h1 = computeDataHash(
        2n, TEST_VERIFIER_ADDRESS, TEST_MINER_ADDRESS,
        TEST_MODEL_HASH, 950n, 42n, 0xabc123n, 0n, 1000n,
      );
      expect(h1).not.toBe(base);

      // Change totalTokens
      const h2 = computeDataHash(
        TEST_CHAIN_ID, TEST_VERIFIER_ADDRESS, TEST_MINER_ADDRESS,
        TEST_MODEL_HASH, 951n, 42n, 0xabc123n, 0n, 1000n,
      );
      expect(h2).not.toBe(base);

      // Change deadline
      const h3 = computeDataHash(
        TEST_CHAIN_ID, TEST_VERIFIER_ADDRESS, TEST_MINER_ADDRESS,
        TEST_MODEL_HASH, 950n, 42n, 0xabc123n, 0n, 1001n,
      );
      expect(h3).not.toBe(base);
    });
  });

  describe('signAttestation + recoverSigner', () => {
    it('should sign and recover to the correct oracle address', async () => {
      const sig = await signAttestation(
        TEST_WALLET, TEST_CHAIN_ID, TEST_VERIFIER_ADDRESS,
        TEST_MINER_ADDRESS, TEST_MODEL_HASH,
        950n, 42n, 0xabc123n, 0n, 1000n,
      );

      expect(sig).toMatch(/^0x[0-9a-f]{130}$/); // 65 bytes = 130 hex chars

      const recovered = recoverSigner(
        TEST_CHAIN_ID, TEST_VERIFIER_ADDRESS,
        TEST_MINER_ADDRESS, TEST_MODEL_HASH,
        950n, 42n, 0xabc123n, 0n, 1000n, sig,
      );

      expect(recovered.toLowerCase()).toBe(TEST_WALLET.address.toLowerCase());
    });

    it('should produce different signatures for different parameters', async () => {
      const sig1 = await signAttestation(
        TEST_WALLET, TEST_CHAIN_ID, TEST_VERIFIER_ADDRESS,
        TEST_MINER_ADDRESS, TEST_MODEL_HASH,
        950n, 42n, 0xabc123n, 0n, 1000n,
      );

      const sig2 = await signAttestation(
        TEST_WALLET, TEST_CHAIN_ID, TEST_VERIFIER_ADDRESS,
        TEST_MINER_ADDRESS, TEST_MODEL_HASH,
        951n, 42n, 0xabc123n, 0n, 1000n,
      );

      expect(sig1).not.toBe(sig2);
    });

    it('should match Solidity ecrecover via EIP-191', async () => {
      // Manually compute what the Solidity contract would compute
      const dataHash = computeDataHash(
        TEST_CHAIN_ID, TEST_VERIFIER_ADDRESS,
        TEST_MINER_ADDRESS, TEST_MODEL_HASH,
        500n, 10n, 999n, 2n, 5000n,
      );

      // The Solidity contract computes:
      // ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dataHash))
      const ethSignedHash = ethers.keccak256(
        ethers.solidityPacked(
          ['string', 'bytes32'],
          ['\x19Ethereum Signed Message:\n32', dataHash],
        ),
      );

      // Sign using wallet.signMessage (auto EIP-191 prefix)
      const sig = await TEST_WALLET.signMessage(ethers.getBytes(dataHash));

      // Recover from the ethSignedHash
      const recovered = ethers.recoverAddress(ethSignedHash, sig);
      expect(recovered.toLowerCase()).toBe(TEST_WALLET.address.toLowerCase());
    });

    it('should work with zero values', async () => {
      const sig = await signAttestation(
        TEST_WALLET, 0n, TEST_VERIFIER_ADDRESS,
        '0x0000000000000000000000000000000000000001',
        ethers.ZeroHash,
        0n, 0n, 0n, 0n, 0n,
      );

      const recovered = recoverSigner(
        0n, TEST_VERIFIER_ADDRESS,
        '0x0000000000000000000000000000000000000001',
        ethers.ZeroHash,
        0n, 0n, 0n, 0n, 0n, sig,
      );

      expect(recovered.toLowerCase()).toBe(TEST_WALLET.address.toLowerCase());
    });

    it('should work with max uint256 values', async () => {
      const maxUint = 2n ** 256n - 1n;
      const sig = await signAttestation(
        TEST_WALLET, maxUint, TEST_VERIFIER_ADDRESS,
        TEST_MINER_ADDRESS, TEST_MODEL_HASH,
        maxUint, maxUint, maxUint, maxUint, maxUint,
      );

      const recovered = recoverSigner(
        maxUint, TEST_VERIFIER_ADDRESS,
        TEST_MINER_ADDRESS, TEST_MODEL_HASH,
        maxUint, maxUint, maxUint, maxUint, maxUint, sig,
      );

      expect(recovered.toLowerCase()).toBe(TEST_WALLET.address.toLowerCase());
    });

    it('should fail recovery with wrong signature', async () => {
      // Sign with a different wallet to get a valid but wrong signature
      const otherWallet = ethers.Wallet.createRandom();
      const wrongSig = await signAttestation(
        otherWallet, TEST_CHAIN_ID, TEST_VERIFIER_ADDRESS,
        TEST_MINER_ADDRESS, TEST_MODEL_HASH,
        950n, 42n, 0xabc123n, 0n, 1000n,
      );

      const recovered = recoverSigner(
        TEST_CHAIN_ID, TEST_VERIFIER_ADDRESS,
        TEST_MINER_ADDRESS, TEST_MODEL_HASH,
        950n, 42n, 0xabc123n, 0n, 1000n, wrongSig,
      );

      // Should recover to the other wallet's address, not the oracle
      expect(recovered.toLowerCase()).toBe(otherWallet.address.toLowerCase());
      expect(recovered.toLowerCase()).not.toBe(TEST_WALLET.address.toLowerCase());
    });
  });
});
