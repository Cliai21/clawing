import { describe, it, expect, beforeAll } from 'vitest';
import { state } from '../src/state.js';
import { ACCOUNTS, mineBlocks } from '../src/anvil.js';
import { mineOnce } from '../src/test-miner.js';
import { getSignedPoaiwMint } from '../src/contracts.js';

describe('Multi-Miner', () => {
  const minerKeys = [ACCOUNTS.miner1.key, ACCOUNTS.miner2.key, ACCOUNTS.miner3.key];
  const minerAddresses = [ACCOUNTS.miner1.address, ACCOUNTS.miner2.address, ACCOUNTS.miner3.address];

  beforeAll(async () => {
    const { contracts, addresses, provider } = state;

    // Ensure past cooldowns from previous tests are cleared
    await mineBlocks(3501);

    // Ensure seed is updated for current epoch
    const epoch = await contracts!.poaiwMint.currentGlobalEpoch();
    const seedEpoch = await contracts!.poaiwMint.seedEpoch();
    if (epoch !== seedEpoch) {
      const deployerMint = getSignedPoaiwMint(provider!, addresses!, ACCOUNTS.deployer.key);
      await deployerMint.updateSeed();
      await mineBlocks(1);
    }
  });

  it('Test 1: Three miners mine independently', async () => {
    const { contracts, addresses, provider, oracleUrl } = state;

    // Record initial balances
    const balancesBefore = await Promise.all(
      minerAddresses.map(addr => contracts!.token.balanceOf(addr) as Promise<bigint>),
    );

    // Each miner mines with different token counts
    const tokenConfigs = [
      { promptTokens: 200, completionTokens: 2300 },  // total=2500
      { promptTokens: 250, completionTokens: 2750 },  // total=3000
      { promptTokens: 300, completionTokens: 3700 },  // total=4000
    ];

    for (let i = 0; i < 3; i++) {
      // Ensure seed is still valid before each mine
      const epoch = await contracts!.poaiwMint.currentGlobalEpoch();
      const seedEpoch = await contracts!.poaiwMint.seedEpoch();
      if (epoch !== seedEpoch) {
        const deployerMint = getSignedPoaiwMint(provider!, addresses!, ACCOUNTS.deployer.key);
        await deployerMint.updateSeed();
        await mineBlocks(1);
      }

      await mineOnce(provider!, addresses!, minerKeys[i], oracleUrl, tokenConfigs[i]);
    }

    // Verify all 3 have increased CLAW balance
    const balancesAfter = await Promise.all(
      minerAddresses.map(addr => contracts!.token.balanceOf(addr) as Promise<bigint>),
    );

    for (let i = 0; i < 3; i++) {
      expect(balancesAfter[i]).toBeGreaterThan(balancesBefore[i]);
    }

    // Miner with 4000 tokens should get more than miner with 2500 tokens
    const increases = balancesAfter.map((after, i) => after - balancesBefore[i]);
    expect(increases[2]).toBeGreaterThan(increases[0]);
  });

  it("Test 2: Miners don't interfere with each other's cooldowns", async () => {
    const { contracts, addresses, provider, oracleUrl } = state;

    // Mine past cooldown for all
    await mineBlocks(3501);

    // Ensure seed is current
    const epoch = await contracts!.poaiwMint.currentGlobalEpoch();
    const seedEpoch = await contracts!.poaiwMint.seedEpoch();
    if (epoch !== seedEpoch) {
      const deployerMint = getSignedPoaiwMint(provider!, addresses!, ACCOUNTS.deployer.key);
      await deployerMint.updateSeed();
      await mineBlocks(1);
    }

    // Miner A mines
    await mineOnce(provider!, addresses!, ACCOUNTS.miner1.key, oracleUrl);

    // Mine only 1 block
    await mineBlocks(1);

    // Miner B's cooldown should be 0 (independent of A)
    const cooldownB = await contracts!.poaiwMint.cooldownRemaining(ACCOUNTS.miner2.address) as bigint;
    expect(cooldownB).toBe(0n);

    // Miner B mines successfully
    const balanceBBefore = await contracts!.token.balanceOf(ACCOUNTS.miner2.address) as bigint;
    await mineOnce(provider!, addresses!, ACCOUNTS.miner2.key, oracleUrl);
    const balanceBAfter = await contracts!.token.balanceOf(ACCOUNTS.miner2.address) as bigint;
    expect(balanceBAfter).toBeGreaterThan(balanceBBefore);

    // Miner A should now have cooldown
    const cooldownA = await contracts!.poaiwMint.cooldownRemaining(ACCOUNTS.miner1.address) as bigint;
    expect(cooldownA).toBeGreaterThan(0n);
  });
});
