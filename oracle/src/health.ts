import { ethers } from 'ethers';
import type { Config } from './config.js';
import type { ChainReader } from './chain.js';
import { signAttestation, recoverSigner } from './signer.js';

const startTime = Date.now();

/** Startup self-test: verify signing, RPC, and contracts */
export async function runStartupSelfTest(
  config: Config,
  chain: ChainReader,
): Promise<void> {
  console.log('=== Clawing Oracle — Startup Self-Test ===');

  // 1. Derive oracle address from private key
  const wallet = new ethers.Wallet(config.oraclePrivateKey);
  console.log(`  Oracle Address: ${wallet.address}`);
  console.log(`  Chain ID: ${config.chainId}`);

  // 2. Sign a test message and verify recovery
  const testChainId = BigInt(config.chainId);
  const testVerifier = config.oracleVerifierAddress;
  const testMiner = '0x0000000000000000000000000000000000000001';
  const testModelHash = ethers.keccak256(ethers.toUtf8Bytes('test-model'));
  const testSig = await signAttestation(
    wallet, testChainId, testVerifier, testMiner,
    testModelHash, 100n, 1n, 0n, 0n, 1000n,
  );
  const recovered = recoverSigner(
    testChainId, testVerifier, testMiner,
    testModelHash, 100n, 1n, 0n, 0n, 1000n, testSig,
  );

  if (recovered.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`Self-test FAILED: recovered ${recovered}, expected ${wallet.address}`);
  }
  console.log('  Signature self-test: PASSED');

  // 3. Connect to RPC
  try {
    const blockNumber = await chain.getBlockNumber();
    console.log(`  RPC connection: OK (block ${blockNumber})`);
  } catch (err) {
    console.warn(`  RPC connection: FAILED (${(err as Error).message})`);
    console.warn('  Server will start but chain reads will fail until RPC is available.');
    return; // Don't check contracts if RPC is down
  }

  // 4. Read contract state
  try {
    const state = await chain.getChainState();
    console.log(`  PoAIWMint contract: OK`);
    console.log(`    Era: ${state.currentEra}, Epoch: ${state.currentGlobalEpoch}`);
    console.log(`    Seed Epoch: ${state.seedEpoch}`);
  } catch (err) {
    console.warn(`  PoAIWMint contract: FAILED (${(err as Error).message})`);
    console.warn('  Contracts may not be deployed. Server will start anyway.');
    return;
  }

  // 5. Verify oracle is a valid signer
  try {
    const isSigner = await chain.isOracleSigner(wallet.address);
    if (isSigner) {
      console.log(`  Oracle signer check: REGISTERED`);
    } else {
      console.warn(`  Oracle signer check: NOT REGISTERED (address may not be added to OracleVerifier)`);
    }
  } catch (err) {
    console.warn(`  Oracle signer check: FAILED (${(err as Error).message})`);
  }

  // 6. Banner
  console.log('');
  console.log('========================================');
  console.log('  Clawing Oracle Server (Phase 1)');
  console.log('========================================');
  console.log(`  Oracle:    ${wallet.address}`);
  console.log(`  Chain:     ${config.chainId}`);
  console.log(`  PoAIWMint: ${config.poaiwMintAddress}`);
  console.log(`  Verifier:  ${config.oracleVerifierAddress}`);
  console.log(`  Port:      ${config.port}`);
  console.log('========================================');
  console.log('');
}

export function getUptimeSeconds(): number {
  return Math.floor((Date.now() - startTime) / 1000);
}
