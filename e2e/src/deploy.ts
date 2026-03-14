import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const FORGE_BIN = '/home/user/.foundry/bin/forge';
const CONTRACTS_DIR = '/home/user/workspace/openclaw/contracts';

export interface DeployedContracts {
  clawToken: string;
  oracleVerifier: string;
  minterProxy: string;
  poaiwMint: string;
}

/**
 * Deploy all 4 contracts using forge script.
 * Returns deployed contract addresses parsed from broadcast artifacts.
 */
export function deployContracts(
  rpcUrl: string,
  deployerKey: string,
  oracleSignerAddress: string,
): DeployedContracts {
  // Ensure 0x prefix
  const privKeyHex = deployerKey.startsWith('0x') ? deployerKey : `0x${deployerKey}`;

  const env = {
    ...process.env,
    DEPLOYER_PRIVATE_KEY: privKeyHex,
    ORACLE_SIGNER_1: oracleSignerAddress,
    ERA1_MODEL: 'grok-4.1-fast',
  };

  const cmd = [
    FORGE_BIN, 'script', 'script/Deploy.s.sol:DeployClawing',
    '--rpc-url', rpcUrl,
    '--broadcast',
    '--private-key', privKeyHex,
    '-vvvv',
  ].join(' ');

  const output = execSync(cmd, {
    cwd: CONTRACTS_DIR,
    env,
    timeout: 60_000,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Parse addresses from forge output
  return parseAddressesFromOutput(output);
}

function parseAddressesFromOutput(output: string): DeployedContracts {
  // First try to parse from forge's console.log output
  const oracleVerifier = extractAddress(output, /OracleVerifier deployed at:\s*(0x[0-9a-fA-F]{40})/);
  const clawToken = extractAddress(output, /CLAW_Token deployed at:\s*(0x[0-9a-fA-F]{40})/);
  const minterProxy = extractAddress(output, /MinterProxy deployed at:\s*(0x[0-9a-fA-F]{40})/);
  const poaiwMint = extractAddress(output, /PoAIWMint deployed at:\s*(0x[0-9a-fA-F]{40})/);

  if (oracleVerifier && clawToken && minterProxy && poaiwMint) {
    return { clawToken, oracleVerifier, minterProxy, poaiwMint };
  }

  // Fallback: parse from broadcast JSON artifacts
  return parseFromBroadcast();
}

function extractAddress(output: string, pattern: RegExp): string | null {
  const match = output.match(pattern);
  return match ? match[1] : null;
}

function parseFromBroadcast(): DeployedContracts {
  const broadcastDir = path.join(CONTRACTS_DIR, 'broadcast', 'Deploy.s.sol', '31337');
  const files = readdirSync(broadcastDir).filter(f => f.startsWith('run-') && f.endsWith('.json'));
  if (files.length === 0) throw new Error('No broadcast artifacts found');

  // Sort by name descending to get latest
  files.sort().reverse();
  const data = JSON.parse(readFileSync(path.join(broadcastDir, files[0]), 'utf-8'));

  const txs = data.transactions as Array<{
    contractName: string;
    contractAddress: string;
    transactionType: string;
  }>;

  const creates = txs.filter(t => t.transactionType === 'CREATE');

  const find = (name: string) => {
    const tx = creates.find(t => t.contractName === name);
    if (!tx) throw new Error(`Contract ${name} not found in broadcast artifacts`);
    return tx.contractAddress;
  };

  return {
    oracleVerifier: find('OracleVerifier'),
    clawToken: find('CLAW_Token'),
    minterProxy: find('MinterProxy'),
    poaiwMint: find('PoAIWMint'),
  };
}
