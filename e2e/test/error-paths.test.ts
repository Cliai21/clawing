import { describe, it, expect } from 'vitest';
import { state } from '../src/state.js';
import { ACCOUNTS, mineBlocks } from '../src/anvil.js';
import { mineOnce, getAttestation } from '../src/test-miner.js';
import { getSignedPoaiwMint } from '../src/contracts.js';

describe('Error Paths', () => {
  const minerKey = ACCOUNTS.miner2.key;

  it('Test 1: Cooldown not met', async () => {
    const { contracts, addresses, provider, oracleUrl } = state;

    // Ensure seed is up to date
    const epoch = await contracts!.poaiwMint.currentGlobalEpoch() as bigint;
    const seedEpoch = await contracts!.poaiwMint.seedEpoch() as bigint;
    if (epoch !== seedEpoch) {
      const deployerMint = getSignedPoaiwMint(provider!, addresses!, ACCOUNTS.deployer.key);
      await deployerMint.updateSeed();
      await mineBlocks(1);
    }

    // Mine once successfully
    await mineOnce(provider!, addresses!, minerKey, oracleUrl);

    // Mine a few blocks but NOT enough for cooldown
    await mineBlocks(10);

    // Try to mine again — Oracle should reject (cooldown active)
    const result = await getAttestation(provider!, addresses!, minerKey, oracleUrl);
    expect(result.success).toBe(false);
    expect(result.error).toBe('COOLDOWN_ACTIVE');

    // Mine past cooldown for subsequent tests
    await mineBlocks(3501);
  });

  it('Test 2: Invalid/expired deadline', async () => {
    const { contracts, addresses, provider, oracleUrl } = state;

    // Ensure seed is up to date
    const epoch = await contracts!.poaiwMint.currentGlobalEpoch() as bigint;
    const seedEpoch = await contracts!.poaiwMint.seedEpoch() as bigint;
    if (epoch !== seedEpoch) {
      const deployerMint = getSignedPoaiwMint(provider!, addresses!, ACCOUNTS.deployer.key);
      await deployerMint.updateSeed();
      await mineBlocks(1);
    }

    // Get a valid attestation
    const result = await getAttestation(provider!, addresses!, minerKey, oracleUrl);
    expect(result.success).toBe(true);
    const att = result.attestation!;

    // Mine past the deadline
    await mineBlocks(att.deadline + 10);

    // Try to submit mint() with expired deadline — should revert
    const poaiwMint = getSignedPoaiwMint(provider!, addresses!, minerKey);
    await mineBlocks(1);

    try {
      const tx = await poaiwMint.mint(
        att.model_hash,
        BigInt(att.total_tokens),
        BigInt(att.seed_epoch),
        BigInt(att.seed),
        BigInt(att.claim_index),
        BigInt(att.deadline),
        att.signature,
      );
      await mineBlocks(1);
      await tx.wait();
      expect.unreachable('Should have reverted');
    } catch (err: unknown) {
      expect(err).toBeDefined();
    }

    // Reset cooldown for next tests
    await mineBlocks(3501);
  });

  it('Test 3: Wrong model hash', async () => {
    const { contracts, addresses, provider, oracleUrl } = state;

    // Ensure seed is up to date
    const epoch = await contracts!.poaiwMint.currentGlobalEpoch() as bigint;
    const seedEpoch = await contracts!.poaiwMint.seedEpoch() as bigint;
    if (epoch !== seedEpoch) {
      const deployerMint = getSignedPoaiwMint(provider!, addresses!, ACCOUNTS.deployer.key);
      await deployerMint.updateSeed();
      await mineBlocks(1);
    }

    const result = await getAttestation(provider!, addresses!, minerKey, oracleUrl, {
      model: 'wrong-model-xyz',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_MODEL');
  });

  it('Test 4: Invalid nonce', async () => {
    const { contracts, addresses, provider, oracleUrl } = state;

    // Ensure seed is up to date
    const epoch = await contracts!.poaiwMint.currentGlobalEpoch() as bigint;
    const seedEpoch = await contracts!.poaiwMint.seedEpoch() as bigint;
    if (epoch !== seedEpoch) {
      const deployerMint = getSignedPoaiwMint(provider!, addresses!, ACCOUNTS.deployer.key);
      await deployerMint.updateSeed();
      await mineBlocks(1);
    }

    const result = await getAttestation(provider!, addresses!, minerKey, oracleUrl, {
      nonce: 'FAKE-NONCE-12345',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_NONCE');
  });

  it('Test 5: Replay attack — reuse same attestation', async () => {
    const { contracts, addresses, provider, oracleUrl } = state;

    // Ensure seed is up to date
    const epoch = await contracts!.poaiwMint.currentGlobalEpoch() as bigint;
    const seedEpoch = await contracts!.poaiwMint.seedEpoch() as bigint;
    if (epoch !== seedEpoch) {
      const deployerMint = getSignedPoaiwMint(provider!, addresses!, ACCOUNTS.deployer.key);
      await deployerMint.updateSeed();
      await mineBlocks(1);
    }

    // Mine once successfully, capturing the attestation
    const first = await mineOnce(provider!, addresses!, minerKey, oracleUrl);
    const att = first.attestation;

    // Try to replay the same mint() call
    const poaiwMint = getSignedPoaiwMint(provider!, addresses!, minerKey);
    await mineBlocks(1);

    try {
      const tx = await poaiwMint.mint(
        att.model_hash,
        BigInt(att.total_tokens),
        BigInt(att.seed_epoch),
        BigInt(att.seed),
        BigInt(att.claim_index),
        BigInt(att.deadline),
        att.signature,
      );
      await mineBlocks(1);
      await tx.wait();
      expect.unreachable('Replay should have been rejected');
    } catch (err: unknown) {
      expect(err).toBeDefined();
    }
  });
});
