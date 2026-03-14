import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import http from 'node:http';
import {
  TEST_WALLET, TEST_MINER_ADDRESS, TEST_MODEL, TEST_MODEL_HASH,
  TEST_VERIFIER_ADDRESS, makeTestConfig, makeValidApiResponse,
} from './helpers.js';

import { NonceManager } from '../src/nonce.js';
import { RateLimiter, RateLimitError } from '../src/rate-limit.js';
import { RequestLogger } from '../src/logger.js';
import { MetricsCollector } from '../src/metrics.js';
import { signAttestation } from '../src/signer.js';
import { verifyAttestation } from '../src/verifier.js';
import { OracleError } from '../src/errors.js';
import { getUptimeSeconds } from '../src/health.js';
import type { ChainReader } from '../src/chain.js';
import type { ChainState, MinerState, AttestRequest, ErrorResponse } from '../src/types.js';

function mockChain(): ChainReader {
  const state: ChainState = {
    currentEra: 1n,
    currentGlobalEpoch: 42n,
    currentSeed: BigInt('0xabc123'),
    seedEpoch: 42n,
    eraModelHash: TEST_MODEL_HASH,
    currentBlock: 19500000,
  };

  const minerState: MinerState = {
    cooldownRemaining: 0n,
    epochClaimCount: 0n,
    lastClaimBlock: 0n,
  };

  return {
    provider: {} as never,
    poaiwMint: {} as never,
    verifier: {} as never,
    getChainState: vi.fn().mockResolvedValue(state),
    getMinerState: vi.fn().mockResolvedValue(minerState),
    getBlockNumber: vi.fn().mockResolvedValue(19500000),
    isOracleSigner: vi.fn().mockResolvedValue(true),
    estimateReward: vi.fn().mockResolvedValue(1693100000000000000000000n),
    getMaxClaimsPerEpoch: vi.fn().mockResolvedValue(14n),
    getMinTokens: vi.fn().mockResolvedValue(100n),
    getMaxTokens: vi.fn().mockResolvedValue(100000n),
    getCachedBlockNumber: vi.fn().mockReturnValue(19500000),
    getCachedState: vi.fn().mockReturnValue(state),
    startSyncLoop: vi.fn(),
    stopSyncLoop: vi.fn(),
  } as unknown as ChainReader;
}

function createTestApp() {
  const config = makeTestConfig();
  const chain = mockChain();
  const nonceManager = new NonceManager(config);
  const rateLimiter = new RateLimiter(config);
  const logger = new RequestLogger();
  const metrics = new MetricsCollector();
  const wallet = new ethers.Wallet(config.oraclePrivateKey);

  const app = express();
  app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
  app.use(express.json());

  // Request ID middleware
  app.use((_req, res, next) => {
    const requestId = crypto.randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.locals.requestId = requestId;
    next();
  });

  app.get('/health', async (_req, res) => {
    try {
      const blockNumber = await chain.getBlockNumber();
      const cachedBlock = chain.getCachedBlockNumber();
      const cachedState = chain.getCachedState();
      res.json({
        status: 'ok',
        version: '1.0.0',
        oracle_address: wallet.address,
        chain_id: config.chainId,
        current_block: blockNumber,
        cached_block_lag: blockNumber - cachedBlock,
        contracts: { poaiw_mint: config.poaiwMintAddress, oracle_verifier: config.oracleVerifierAddress },
        chain_state: cachedState ? {
          era: Number(cachedState.currentEra),
          epoch: Number(cachedState.currentGlobalEpoch),
          seed_epoch: Number(cachedState.seedEpoch),
          era_model_hash: cachedState.eraModelHash,
        } : undefined,
        uptime_seconds: getUptimeSeconds(),
        metrics: {
          total_attestations: logger.totalAttestations,
          total_rejected: logger.totalRejected,
          total_nonces: logger.totalNonces,
          avg_attest_ms: metrics.getAvgAttestMs(),
        },
      });
    } catch {
      res.status(500).json({ status: 'error' });
    }
  });

  app.get('/metrics', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(metrics.toPrometheus());
  });

  app.get('/api/v1/nonce', (req, res) => {
    const requestId = res.locals.requestId as string;
    const minerParam = req.query.miner as string | undefined;
    try {
      if (!minerParam || !ethers.isAddress(minerParam)) {
        res.status(400).json({ success: false, error: 'INVALID_ADDRESS', message: 'Invalid miner address', request_id: requestId });
        return;
      }
      const minerAddress = ethers.getAddress(minerParam);
      rateLimiter.checkNonce(minerAddress);
      rateLimiter.recordNonce(minerAddress);
      const { nonce, expires_at } = nonceManager.generate(minerAddress);
      metrics.recordNonce();
      res.json({ success: true, nonce, expires_at, message: `Embed this nonce in your prompt` });
    } catch (err) {
      if (err instanceof RateLimitError) {
        res.status(429).json({ success: false, error: 'RATE_LIMITED', message: err.message, request_id: requestId });
        return;
      }
      res.status(400).json({ success: false, error: 'ERROR', message: (err as Error).message, request_id: requestId });
    }
  });

  app.post('/api/v1/attest', async (req, res) => {
    const startMs = Date.now();
    const requestId = res.locals.requestId as string;
    const body = req.body as AttestRequest;
    try {
      if (body?.miner_address && ethers.isAddress(body.miner_address)) {
        rateLimiter.checkAttest(ethers.getAddress(body.miner_address));
      }
      const result = await verifyAttestation(body, chain, nonceManager, config);
      const deadline = BigInt(result.chainState.currentBlock + config.deadlineBlocksAhead);
      const signature = await signAttestation(
        wallet, BigInt(config.chainId), config.oracleVerifierAddress,
        ethers.getAddress(body.miner_address), result.modelHash,
        result.totalTokens, BigInt(body.seed_epoch), BigInt(body.seed),
        BigInt(body.claim_index), deadline,
      );
      rateLimiter.recordAttest(ethers.getAddress(body.miner_address));
      const durationMs = Date.now() - startMs;
      metrics.recordAttest(true, durationMs);
      res.json({
        success: true,
        attestation: {
          miner_address: ethers.getAddress(body.miner_address),
          model_hash: result.modelHash,
          total_tokens: body.api_response.usage.total_tokens,
          seed_epoch: body.seed_epoch,
          seed: body.seed,
          claim_index: body.claim_index,
          deadline: Number(deadline),
          signature,
        },
        estimated_reward: '1693100000000000000000000',
      });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      metrics.recordAttest(false, durationMs);
      if (err instanceof OracleError) {
        res.status(err.statusCode).json({ success: false, error: err.code, message: err.message, request_id: requestId });
        return;
      }
      if (err instanceof RateLimitError) {
        res.status(429).json({ success: false, error: 'RATE_LIMITED', message: err.message, request_id: requestId });
        return;
      }
      res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal server error', request_id: requestId });
    }
  });

  return { app, nonceManager, rateLimiter, logger, metrics, chain };
}

// HTTP helper — returns status, body, and headers
interface HttpResponse {
  status: number;
  body: Record<string, unknown>;
  headers: http.IncomingHttpHeaders;
  rawBody?: string;
}

async function request(server: http.Server, method: string, path: string, body?: unknown): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(data); } catch { /* raw text responses */ }
        resolve({ status: res.statusCode!, body: parsed, headers: res.headers, rawBody: data });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('Integration Tests', () => {
  let server: http.Server;
  let appContext: ReturnType<typeof createTestApp>;

  beforeAll(async () => {
    appContext = createTestApp();
    await new Promise<void>((resolve) => {
      server = appContext.app.listen(0, () => resolve());
    });
  });

  afterAll(async () => {
    appContext.nonceManager.close();
    appContext.rateLimiter.close();
    appContext.logger.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const res = await request(server, 'GET', '/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.oracle_address).toBe(TEST_WALLET.address);
      expect(res.body.chain_id).toBe(1);
    });

    it('should include version and enhanced fields', async () => {
      const res = await request(server, 'GET', '/health');
      expect(res.body.version).toBe('1.0.0');
      expect(res.body.cached_block_lag).toBeDefined();
      expect(res.body.chain_state).toBeDefined();
      const chainState = res.body.chain_state as Record<string, unknown>;
      expect(chainState.era).toBe(1);
      expect(chainState.epoch).toBe(42);
      expect(res.body.metrics).toBeDefined();
      const m = res.body.metrics as Record<string, unknown>;
      expect(m.total_attestations).toBeDefined();
      expect(m.total_rejected).toBeDefined();
      expect(m.total_nonces).toBeDefined();
      expect(m.avg_attest_ms).toBeDefined();
    });
  });

  describe('GET /metrics', () => {
    it('should return Prometheus-format text', async () => {
      const res = await request(server, 'GET', '/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.rawBody).toContain('clawing_oracle_attestations_total');
      expect(res.rawBody).toContain('clawing_oracle_nonces_total');
      expect(res.rawBody).toContain('clawing_oracle_uptime_seconds');
      expect(res.rawBody).toContain('clawing_oracle_chain_block_number');
    });
  });

  describe('Request ID', () => {
    it('should include X-Request-Id header on all responses', async () => {
      const res = await request(server, 'GET', '/health');
      const reqId = res.headers['x-request-id'] as string;
      expect(reqId).toBeDefined();
      // UUID v4 format
      expect(reqId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('should include request_id in error responses', async () => {
      const res = await request(server, 'GET', '/api/v1/nonce?miner=0xinvalid');
      expect(res.status).toBe(400);
      expect(res.body.request_id).toBeDefined();
      expect(typeof res.body.request_id).toBe('string');
    });
  });

  describe('CORS', () => {
    it('should include CORS headers', async () => {
      const res = await request(server, 'GET', '/health');
      expect(res.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('GET /api/v1/nonce', () => {
    it('should return a nonce for valid miner', async () => {
      const res = await request(server, 'GET', `/api/v1/nonce?miner=${TEST_MINER_ADDRESS}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.nonce).toMatch(/^CLI-/);
    });

    it('should reject invalid address', async () => {
      const res = await request(server, 'GET', '/api/v1/nonce?miner=0xinvalid');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject missing miner param', async () => {
      const res = await request(server, 'GET', '/api/v1/nonce');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/attest', () => {
    it('should sign valid attestation', async () => {
      // First get a nonce
      const nonceRes = await request(server, 'GET', `/api/v1/nonce?miner=${TEST_MINER_ADDRESS}`);
      const nonce = nonceRes.body.nonce as string;

      const seed = '0xabc123';
      const epoch = 42;
      const claimIndex = 0;

      const attestReq = {
        miner_address: TEST_MINER_ADDRESS,
        nonce,
        api_response: makeValidApiResponse(),
        api_request: {
          model: TEST_MODEL,
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            {
              role: 'user',
              content: `Clawing Mining | Seed: ${seed} | Epoch: ${epoch} | Nonce: ${nonce} | Miner: ${TEST_MINER_ADDRESS} | ClaimIndex: ${claimIndex} | Task: Explain quantum computing.`,
            },
          ],
        },
        seed_epoch: epoch,
        seed,
        claim_index: claimIndex,
      };

      const res = await request(server, 'POST', '/api/v1/attest', attestReq);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const attestation = res.body.attestation as Record<string, unknown>;
      expect(attestation.signature).toMatch(/^0x[0-9a-f]{130}$/);
      expect(attestation.model_hash).toBe(TEST_MODEL_HASH);
      expect(attestation.total_tokens).toBe(2500);
      expect(attestation.deadline).toBe(19500200);
    });

    it('should reject malformed request', async () => {
      const res = await request(server, 'POST', '/api/v1/attest', { miner_address: '0xinvalid' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject rate-limited request', async () => {
      // The first attest from the full flow above already consumed the rate limit
      // for TEST_MINER_ADDRESS (41000s window). Get a new nonce and try again.
      const nonceRes = await request(server, 'GET', `/api/v1/nonce?miner=${TEST_MINER_ADDRESS}`);
      const nonce = nonceRes.body.nonce as string;

      const attestReq = {
        miner_address: TEST_MINER_ADDRESS,
        nonce,
        api_response: makeValidApiResponse(),
        api_request: {
          model: TEST_MODEL,
          messages: [
            { role: 'system', content: 'test' },
            {
              role: 'user',
              content: `Clawing Mining | Seed: 0xabc123 | Epoch: 42 | Nonce: ${nonce} | Miner: ${TEST_MINER_ADDRESS} | ClaimIndex: 0 | Task: test`,
            },
          ],
        },
        seed_epoch: 42,
        seed: '0xabc123',
        claim_index: 0,
      };

      const res = await request(server, 'POST', '/api/v1/attest', attestReq);
      expect(res.status).toBe(429);
      expect(res.body.error).toBe('RATE_LIMITED');
    });
  });
});
