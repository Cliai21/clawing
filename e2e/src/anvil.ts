import { spawn, type ChildProcess } from 'node:child_process';
import { ethers } from 'ethers';

const ANVIL_BIN = '/home/user/.foundry/bin/anvil';
const RPC_URL = 'http://127.0.0.1:8545';
const MNEMONIC = 'test test test test test test test test test test test junk';

let anvilProcess: ChildProcess | null = null;
let provider: ethers.JsonRpcProvider | null = null;

/** Anvil default accounts derived from the test mnemonic */
export const ACCOUNTS = {
  deployer: {
    key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  },
  oracle: {
    key: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  },
  guardian: {
    key: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  },
  miner1: {
    key: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
    address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  },
  miner2: {
    key: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
    address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
  },
  miner3: {
    key: '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
    address: '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
  },
};

export function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(RPC_URL);
  }
  return provider;
}

export async function startAnvil(): Promise<void> {
  if (anvilProcess) return;

  anvilProcess = spawn(ANVIL_BIN, [
    '--port', '8545',
    '--chain-id', '31337',
    '--mnemonic', MNEMONIC,
    '--silent',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Capture errors for debugging
  let stderrBuf = '';
  anvilProcess.stderr?.on('data', (chunk: Buffer) => {
    stderrBuf += chunk.toString();
  });

  // Wait for Anvil to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Anvil startup timeout. stderr: ${stderrBuf}`)), 15_000);

    const check = async () => {
      try {
        const p = new ethers.JsonRpcProvider(RPC_URL);
        await p.getBlockNumber();
        clearTimeout(timeout);
        resolve();
      } catch {
        setTimeout(check, 300);
      }
    };

    anvilProcess!.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    anvilProcess!.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Anvil exited with code ${code}. stderr: ${stderrBuf}`));
      }
    });

    check();
  });

  provider = new ethers.JsonRpcProvider(RPC_URL);
}

export function stopAnvil(): void {
  if (anvilProcess) {
    anvilProcess.kill('SIGTERM');
    anvilProcess = null;
  }
  provider = null;
}

export async function mineBlocks(n: number): Promise<void> {
  const p = getProvider();
  // Advance time by n*12 seconds to simulate realistic block times.
  // Critical: OracleVerifier.MIN_VERIFY_INTERVAL = 41,000 seconds requires
  // block.timestamp to advance proportionally with block.number.
  await p.send('evm_increaseTime', [`0x${(n * 12).toString(16)}`]);
  await p.send('anvil_mine', [`0x${n.toString(16)}`]);
}

export async function setNextBlockTimestamp(ts: number): Promise<void> {
  const p = getProvider();
  await p.send('evm_setNextBlockTimestamp', [ts]);
}

export async function getBlockNumber(): Promise<number> {
  const p = getProvider();
  return p.getBlockNumber();
}

export async function getBlockTimestamp(): Promise<number> {
  const p = getProvider();
  const block = await p.getBlock('latest');
  return block!.timestamp;
}

export { RPC_URL, MNEMONIC };
