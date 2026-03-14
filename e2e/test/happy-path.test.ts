import { describe, it, expect } from 'vitest';
import { state } from '../src/state.js';
import { ACCOUNTS, mineBlocks } from '../src/anvil.js';
import { mineOnce } from '../src/test-miner.js';
import { getSignedPoaiwMint } from '../src/contracts.js';

describe('Happy Path', () => {
  it('Test 1: Complete mining cycle', async () => {
    const { contracts, addresses, provider, oracleUrl } = state;
    const minerKey = ACCOUNTS.miner1.key;
    const minerAddress = ACCOUNTS.miner1.address;

    // Check initial balance is 0
    const balanceBefore = await contracts!.token.balanceOf(minerAddress) as bigint;
    expect(balanceBefore).toBe(0n);

    // Execute full mining cycle
    await mineOnce(provider!, addresses!, minerKey, oracleUrl);

    // Verify: miner's CLAW balance > 0
    const balanceAfter = await contracts!.token.balanceOf(minerAddress) as bigint;
    expect(balanceAfter).toBeGreaterThan(0n);

    // Verify: epochClaimCount incremented
    const epoch = await contracts!.poaiwMint.currentGlobalEpoch() as bigint;
    const claimCount = await contracts!.poaiwMint.epochClaimCount(minerAddress, epoch) as bigint;
    expect(claimCount).toBe(1n);

    // Verify: totalClaims incremented
    const totalClaims = await contracts!.poaiwMint.totalClaims() as bigint;
    expect(totalClaims).toBeGreaterThanOrEqual(1n);
  });

  it('Test 2: Second mine after cooldown', async () => {
    const { contracts, addresses, provider, oracleUrl } = state;
    const minerKey = ACCOUNTS.miner1.key;
    const minerAddress = ACCOUNTS.miner1.address;

    const balanceBefore = await contracts!.token.balanceOf(minerAddress) as bigint;
    expect(balanceBefore).toBeGreaterThan(0n);

    // Mine past cooldown (3500 blocks)
    await mineBlocks(3501);

    // Need to updateSeed for the potentially new epoch
    const epoch = await contracts!.poaiwMint.currentGlobalEpoch() as bigint;
    const seedEpoch = await contracts!.poaiwMint.seedEpoch() as bigint;
    if (epoch !== seedEpoch) {
      const deployerMint = getSignedPoaiwMint(provider!, addresses!, ACCOUNTS.deployer.key);
      await deployerMint.updateSeed();
      await mineBlocks(1);
    }

    // Mine again
    await mineOnce(provider!, addresses!, minerKey, oracleUrl);

    // Verify: balance increased
    const balanceAfter = await contracts!.token.balanceOf(minerAddress) as bigint;
    expect(balanceAfter).toBeGreaterThan(balanceBefore);

    // Verify: epochClaimCount for current epoch
    const currentEpoch = await contracts!.poaiwMint.currentGlobalEpoch() as bigint;
    const claimCount = await contracts!.poaiwMint.epochClaimCount(minerAddress, currentEpoch) as bigint;
    expect(claimCount).toBeGreaterThanOrEqual(1n);
  });

  it('Test 3: Balance reflects logarithmic reward formula', async () => {
    const { contracts } = state;
    const minerAddress = ACCOUNTS.miner1.address;
    const balance = await contracts!.token.balanceOf(minerAddress) as bigint;

    // The reward formula is: R = perBlock × (1 + ln(T))
    // For era 1: perBlock = 100_000 * 1e18
    const era = await contracts!.poaiwMint.currentEra() as bigint;
    const perBlock = await contracts!.poaiwMint.perBlockForEra(era) as bigint;

    // Reward should be at least perBlock (the minimum when ln(T) contributes)
    expect(balance).toBeGreaterThan(perBlock);

    // Verify estimateReward works
    const estimated = await contracts!.poaiwMint.estimateReward(2500n) as bigint;
    expect(estimated).toBeGreaterThan(0n);
  });
});
