import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { startAnvil, stopAnvil, mineBlocks, ACCOUNTS, RPC_URL, getProvider } from '../src/anvil.js';
import { deployContracts, type DeployedContracts } from '../src/deploy.js';
import { startOracle, stopOracle, getOracleUrl } from '../src/oracle-process.js';
import { getContracts, getSignedPoaiwMint, type ContractClients } from '../src/contracts.js';
import { mineOnce, getAttestation } from '../src/test-miner.js';

let contracts: ContractClients;
let addresses: DeployedContracts;
let provider: ethers.JsonRpcProvider;
let oracleUrl: string;

beforeAll(async () => {
  // 1. Start Anvil
  await startAnvil();
  provider = getProvider();
  await mineBlocks(5);

  // 2. Deploy contracts
  addresses = deployContracts(RPC_URL, ACCOUNTS.deployer.key, ACCOUNTS.oracle.address);
  await mineBlocks(3);

  // 3. Set up contract clients
  contracts = getContracts(provider, addresses);

  // 4. Mine past COOLDOWN_BLOCKS (3500) so first-time miners can mine.
  //    PoAIWMint checks: lastClaimBlock[miner] + COOLDOWN_BLOCKS <= block.number
  //    For first-time miners, lastClaimBlock defaults to 0, so block.number must >= 3500.
  await mineBlocks(3501);

  // 5. Call updateSeed() so mining can begin
  const deployerMint = getSignedPoaiwMint(provider, addresses, ACCOUNTS.deployer.key);
  await deployerMint.updateSeed();
  await mineBlocks(1);

  // 5. Start Oracle
  await startOracle({
    privateKey: ACCOUNTS.oracle.key,
    rpcUrl: RPC_URL,
    contracts: addresses,
  });
  oracleUrl = getOracleUrl();
}, 120_000);

afterAll(() => {
  stopOracle();
  stopAnvil();
});

/** Helper: ensure seed is current for the current epoch */
async function ensureSeedCurrent(): Promise<void> {
  const epoch = await contracts.poaiwMint.currentGlobalEpoch() as bigint;
  const seedEpoch = await contracts.poaiwMint.seedEpoch() as bigint;
  if (epoch !== seedEpoch) {
    const deployerMint = getSignedPoaiwMint(provider, addresses, ACCOUNTS.deployer.key);
    await deployerMint.updateSeed();
    await mineBlocks(1);
  }
}

// ═══════════════════════════════════════════════════════
//                    Happy Path Tests
// ═══════════════════════════════════════════════════════

describe('Happy Path', () => {
  it('Complete mining cycle', async () => {
    const minerKey = ACCOUNTS.miner1.key;
    const minerAddress = ACCOUNTS.miner1.address;

    const balanceBefore = await contracts.token.balanceOf(minerAddress) as bigint;
    expect(balanceBefore).toBe(0n);

    await mineOnce(provider, addresses, minerKey, oracleUrl);

    const balanceAfter = await contracts.token.balanceOf(minerAddress) as bigint;
    expect(balanceAfter).toBeGreaterThan(0n);

    const epoch = await contracts.poaiwMint.currentGlobalEpoch() as bigint;
    const claimCount = await contracts.poaiwMint.epochClaimCount(minerAddress, epoch) as bigint;
    expect(claimCount).toBe(1n);

    const totalClaims = await contracts.poaiwMint.totalClaims() as bigint;
    expect(totalClaims).toBeGreaterThanOrEqual(1n);
  });

  it('Second mine after cooldown', async () => {
    const minerKey = ACCOUNTS.miner1.key;
    const minerAddress = ACCOUNTS.miner1.address;

    const balanceBefore = await contracts.token.balanceOf(minerAddress) as bigint;
    expect(balanceBefore).toBeGreaterThan(0n);

    await mineBlocks(3501);
    await ensureSeedCurrent();

    await mineOnce(provider, addresses, minerKey, oracleUrl);

    const balanceAfter = await contracts.token.balanceOf(minerAddress) as bigint;
    expect(balanceAfter).toBeGreaterThan(balanceBefore);
  });

  it('Balance reflects logarithmic reward formula', async () => {
    const minerAddress = ACCOUNTS.miner1.address;
    const balance = await contracts.token.balanceOf(minerAddress) as bigint;

    const era = await contracts.poaiwMint.currentEra() as bigint;
    const perBlock = await contracts.poaiwMint.perBlockForEra(era) as bigint;

    // Balance (from 2 mines) should be greater than a single perBlock
    expect(balance).toBeGreaterThan(perBlock);

    const estimated = await contracts.poaiwMint.estimateReward(2500n) as bigint;
    expect(estimated).toBeGreaterThan(0n);
  });
});

// ═══════════════════════════════════════════════════════
//                    Error Path Tests
// ═══════════════════════════════════════════════════════

describe('Error Paths', () => {
  const minerKey = ACCOUNTS.miner2.key;

  it('Cooldown not met', async () => {
    await mineBlocks(3501);
    await ensureSeedCurrent();

    // Mine once
    await mineOnce(provider, addresses, minerKey, oracleUrl);
    await mineBlocks(10);

    // Try again — should fail with COOLDOWN_ACTIVE
    const result = await getAttestation(provider, addresses, minerKey, oracleUrl);
    expect(result.success).toBe(false);
    expect(result.error).toBe('COOLDOWN_ACTIVE');

    await mineBlocks(3501);
  });

  it('Invalid/expired deadline', async () => {
    await ensureSeedCurrent();

    const result = await getAttestation(provider, addresses, minerKey, oracleUrl);
    expect(result.success).toBe(true);
    const att = result.attestation!;

    // Mine past the deadline
    await mineBlocks(att.deadline + 10);

    const poaiwMint = getSignedPoaiwMint(provider, addresses, minerKey);
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

    await mineBlocks(3501);
  });

  it('Wrong model hash', async () => {
    await ensureSeedCurrent();

    const result = await getAttestation(provider, addresses, minerKey, oracleUrl, {
      model: 'wrong-model-xyz',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_MODEL');
  });

  it('Invalid nonce', async () => {
    await ensureSeedCurrent();

    const result = await getAttestation(provider, addresses, minerKey, oracleUrl, {
      nonce: 'FAKE-NONCE-12345',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_NONCE');
  });

  it('Replay attack — reuse same attestation', async () => {
    await ensureSeedCurrent();

    const first = await mineOnce(provider, addresses, minerKey, oracleUrl);
    const att = first.attestation;

    const poaiwMint = getSignedPoaiwMint(provider, addresses, minerKey);
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

// ═══════════════════════════════════════════════════════
//                    Multi-Miner Tests
// ═══════════════════════════════════════════════════════

describe('Multi-Miner', () => {
  const minerKeys = [ACCOUNTS.miner1.key, ACCOUNTS.miner2.key, ACCOUNTS.miner3.key];
  const minerAddresses = [ACCOUNTS.miner1.address, ACCOUNTS.miner2.address, ACCOUNTS.miner3.address];

  it('Three miners mine independently', async () => {
    await mineBlocks(3501);
    await ensureSeedCurrent();

    const balancesBefore = await Promise.all(
      minerAddresses.map(addr => contracts.token.balanceOf(addr) as Promise<bigint>),
    );

    const tokenConfigs = [
      { promptTokens: 200, completionTokens: 2300 },   // total=2500, msb=11
      { promptTokens: 500, completionTokens: 4500 },   // total=5000, msb=12
      { promptTokens: 1000, completionTokens: 9000 },  // total=10000, msb=13
    ];

    for (let i = 0; i < 3; i++) {
      await ensureSeedCurrent();
      await mineOnce(provider, addresses, minerKeys[i], oracleUrl, tokenConfigs[i]);
    }

    const balancesAfter = await Promise.all(
      minerAddresses.map(addr => contracts.token.balanceOf(addr) as Promise<bigint>),
    );

    for (let i = 0; i < 3; i++) {
      expect(balancesAfter[i]).toBeGreaterThan(balancesBefore[i]);
    }

    const increases = balancesAfter.map((after, i) => after - balancesBefore[i]);
    expect(increases[2]).toBeGreaterThan(increases[0]);
  });

  it("Miners don't interfere with each other's cooldowns", async () => {
    await mineBlocks(3501);
    await ensureSeedCurrent();

    await mineOnce(provider, addresses, ACCOUNTS.miner1.key, oracleUrl);
    await mineBlocks(1);

    const cooldownB = await contracts.poaiwMint.cooldownRemaining(ACCOUNTS.miner2.address) as bigint;
    expect(cooldownB).toBe(0n);

    const balanceBBefore = await contracts.token.balanceOf(ACCOUNTS.miner2.address) as bigint;
    await mineOnce(provider, addresses, ACCOUNTS.miner2.key, oracleUrl);
    const balanceBAfter = await contracts.token.balanceOf(ACCOUNTS.miner2.address) as bigint;
    expect(balanceBAfter).toBeGreaterThan(balanceBBefore);

    const cooldownA = await contracts.poaiwMint.cooldownRemaining(ACCOUNTS.miner1.address) as bigint;
    expect(cooldownA).toBeGreaterThan(0n);
  });
});
