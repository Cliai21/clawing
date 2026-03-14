import { beforeAll, afterAll } from 'vitest';
import { startAnvil, stopAnvil, mineBlocks, ACCOUNTS, RPC_URL, getProvider } from '../src/anvil.js';
import { deployContracts } from '../src/deploy.js';
import { startOracle, stopOracle, getOracleUrl } from '../src/oracle-process.js';
import { getContracts, getSignedPoaiwMint } from '../src/contracts.js';
import { state } from '../src/state.js';

beforeAll(async () => {
  if (state.initialized) return;

  // 1. Start Anvil
  await startAnvil();
  state.provider = getProvider();

  // Mine a few blocks so blockhash lookups in updateSeed() work
  await mineBlocks(5);

  // 2. Deploy contracts
  state.addresses = deployContracts(RPC_URL, ACCOUNTS.deployer.key, ACCOUNTS.oracle.address);

  // Mine blocks to commit deployment
  await mineBlocks(3);

  // 3. Set up contract clients
  state.contracts = getContracts(state.provider, state.addresses);

  // 4. Call updateSeed() so mining can begin
  const deployerMint = getSignedPoaiwMint(state.provider, state.addresses, ACCOUNTS.deployer.key);
  await deployerMint.updateSeed();
  await mineBlocks(1);

  // 5. Start Oracle
  await startOracle({
    privateKey: ACCOUNTS.oracle.key,
    rpcUrl: RPC_URL,
    contracts: state.addresses,
  });
  state.oracleUrl = getOracleUrl();
  state.initialized = true;
}, 120_000);

afterAll(() => {
  stopOracle();
  stopAnvil();
});
