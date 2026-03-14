import { spawn, type ChildProcess } from 'node:child_process';
import type { DeployedContracts } from './deploy.js';

const ORACLE_DIR = '/home/user/workspace/openclaw/oracle';
const ORACLE_PORT = 3333;
const ORACLE_URL = `http://127.0.0.1:${ORACLE_PORT}`;

let oracleProcess: ChildProcess | null = null;

export interface OracleConfig {
  privateKey: string;
  rpcUrl: string;
  contracts: DeployedContracts;
  chainId?: number;
  port?: number;
}

export async function startOracle(config: OracleConfig): Promise<void> {
  if (oracleProcess) return;

  const port = config.port ?? ORACLE_PORT;
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ORACLE_PRIVATE_KEY: config.privateKey,
    RPC_URL: config.rpcUrl,
    POAIW_MINT_ADDRESS: config.contracts.poaiwMint,
    ORACLE_VERIFIER_ADDRESS: config.contracts.oracleVerifier,
    PORT: String(port),
    CHAIN_ID: String(config.chainId ?? 31337),
    LOG_LEVEL: 'error',
    NONCE_TTL_SECONDS: '300',
    NONCE_MAX_PER_ADDRESS: '10',
    RATE_LIMIT_WINDOW_SECONDS: '0',     // disabled for testing
    RATE_LIMIT_MAX_PER_WINDOW: '100',  // high limit for testing
    DEADLINE_BLOCKS_AHEAD: '200',
    SIGNATURE_VALIDITY_BLOCKS: '300',
  };

  oracleProcess = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: ORACLE_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Capture stderr for debugging
  let stderr = '';
  oracleProcess.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  oracleProcess.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`Oracle exited with code ${code}. stderr: ${stderr}`);
    }
  });

  await waitForHealthy(`http://127.0.0.1:${port}`, 30_000);
}

export function stopOracle(): void {
  if (oracleProcess) {
    oracleProcess.kill('SIGTERM');
    oracleProcess = null;
  }
}

async function waitForHealthy(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) {
        const data = await resp.json() as { status: string };
        if (data.status === 'ok' || data.status === 'degraded') return;
      }
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, 300));
  }

  throw new Error(`Oracle did not become healthy within ${timeoutMs}ms`);
}

export function getOracleUrl(): string {
  return ORACLE_URL;
}
