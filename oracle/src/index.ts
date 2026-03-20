import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import { loadConfig } from './config.js';
import { ChainReader } from './chain.js';
import { signAttestation } from './signer.js';
import { verifyAttestation } from './verifier.js';
import { NonceManager } from './nonce.js';
import { RateLimiter, RateLimitError } from './rate-limit.js';
import { RequestLogger } from './logger.js';
import { MetricsCollector } from './metrics.js';
import { runStartupSelfTest, getUptimeSeconds } from './health.js';
import { OracleError } from './errors.js';
import type { AttestRequest, HealthResponse, ErrorResponse } from './types.js';

const config = loadConfig();

// Resolve SQLite database paths (persistent or in-memory)
function resolveDbPath(filename: string): string {
  if (!config.dbDir) return ':memory:';
  if (!fs.existsSync(config.dbDir)) {
    fs.mkdirSync(config.dbDir, { recursive: true });
  }
  return path.join(config.dbDir, filename);
}

const chain = new ChainReader(config);
const nonceManager = new NonceManager(config, resolveDbPath('nonce.db'));
const rateLimiter = new RateLimiter(config, resolveDbPath('rate-limit.db'));
const logger = new RequestLogger(resolveDbPath('request-log.db'));
const metrics = new MetricsCollector();
const wallet = new ethers.Wallet(config.oraclePrivateKey);

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '1mb' }));

// ═══════════════════ Request ID Middleware ═══════════════════

app.use((_req, res, next) => {
  const requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.locals.requestId = requestId;
  next();
});

// ═══════════════════ GET /health ═══════════════════

app.get('/health', async (_req, res) => {
  try {
    const blockNumber = await chain.getBlockNumber();
    const cachedBlock = chain.getCachedBlockNumber();
    const cachedState = chain.getCachedState();

    const health: HealthResponse = {
      status: 'ok',
      version: '1.0.0',
      oracle_address: wallet.address,
      chain_id: config.chainId,
      current_block: blockNumber,
      cached_block_lag: blockNumber - cachedBlock,
      contracts: {
        poaiw_mint: config.poaiwMintAddress,
        oracle_verifier: config.oracleVerifierAddress,
      },
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
    };
    res.json(health);
  } catch (err) {
    res.json({
      status: 'degraded',
      version: '1.0.0',
      oracle_address: wallet.address,
      chain_id: config.chainId,
      current_block: 0,
      cached_block_lag: 0,
      contracts: {
        poaiw_mint: config.poaiwMintAddress,
        oracle_verifier: config.oracleVerifierAddress,
      },
      uptime_seconds: getUptimeSeconds(),
      metrics: {
        total_attestations: logger.totalAttestations,
        total_rejected: logger.totalRejected,
        total_nonces: logger.totalNonces,
        avg_attest_ms: metrics.getAvgAttestMs(),
      },
      error: (err as Error).message,
    });
  }
});

// ═══════════════════ GET /metrics ═══════════════════

app.get('/metrics', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(metrics.toPrometheus());
});

// ═══════════════ Admin: DELETE /admin/rate-limit/:address ═══════════════

app.delete('/admin/rate-limit/:address', (req, res) => {
  // Require ADMIN_TOKEN for authentication
  if (!config.adminToken) {
    res.status(403).json({ success: false, error: 'ADMIN_DISABLED', message: 'Admin API is disabled. Set ADMIN_TOKEN in .env to enable.' });
    return;
  }
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token !== config.adminToken) {
    res.status(401).json({ success: false, error: 'UNAUTHORIZED', message: 'Invalid or missing admin token.' });
    return;
  }

  const addressParam = req.params.address;
  if (!addressParam || !ethers.isAddress(addressParam)) {
    res.status(400).json({ success: false, error: 'INVALID_ADDRESS', message: 'URL param must be a valid Ethereum address.' });
    return;
  }

  const address = ethers.getAddress(addressParam);
  rateLimiter.clearAttest(address);
  console.log(`[ADMIN] Rate limit cleared for ${address}`);
  res.json({ success: true, message: `Rate limit cleared for ${address}` });
});

// ═══════════════════ GET /api/v1/nonce ═══════════════════

app.get('/api/v1/nonce', (req, res) => {
  const startMs = Date.now();
  const requestId = res.locals.requestId as string;
  const minerParam = req.query.miner as string | undefined;

  try {
    if (!minerParam || !ethers.isAddress(minerParam)) {
      const errResp: ErrorResponse = {
        success: false,
        error: 'INVALID_ADDRESS',
        message: 'Query param "miner" must be a valid Ethereum address',
        request_id: requestId,
      };
      logger.log({ request_id: requestId, endpoint: '/api/v1/nonce', success: false, error_code: 'INVALID_ADDRESS', ip_address: req.ip, response_time_ms: Date.now() - startMs });
      res.status(400).json(errResp);
      return;
    }

    const minerAddress = ethers.getAddress(minerParam);

    // Rate limit check
    rateLimiter.checkNonce(minerAddress);
    rateLimiter.recordNonce(minerAddress);

    const { nonce, expires_at } = nonceManager.generate(minerAddress);

    metrics.recordNonce();
    logger.log({ request_id: requestId, miner_address: minerAddress, endpoint: '/api/v1/nonce', success: true, ip_address: req.ip, response_time_ms: Date.now() - startMs });

    res.json({
      success: true,
      nonce,
      expires_at,
      message: `Embed this nonce in your prompt: Clawing Mining | Seed: ... | Nonce: ${nonce} | ...`,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      const errResp: ErrorResponse = { success: false, error: 'RATE_LIMITED', message: err.message, request_id: requestId };
      logger.log({ request_id: requestId, miner_address: minerParam, endpoint: '/api/v1/nonce', success: false, error_code: 'RATE_LIMITED', ip_address: req.ip, response_time_ms: Date.now() - startMs });
      res.status(429).json(errResp);
      return;
    }
    const errResp: ErrorResponse = {
      success: false,
      error: 'NONCE_LIMIT',
      message: (err as Error).message,
      request_id: requestId,
    };
    logger.log({ request_id: requestId, miner_address: minerParam, endpoint: '/api/v1/nonce', success: false, error_code: 'NONCE_LIMIT', ip_address: req.ip, response_time_ms: Date.now() - startMs });
    res.status(400).json(errResp);
  }
});

// ═══════════════════ POST /api/v1/attest ═══════════════════

app.post('/api/v1/attest', async (req, res) => {
  const startMs = Date.now();
  const requestId = res.locals.requestId as string;
  const body = req.body as AttestRequest;
  const minerAddress = body?.miner_address;

  try {
    // Rate limit check (attest)
    if (minerAddress && ethers.isAddress(minerAddress)) {
      rateLimiter.checkAttest(ethers.getAddress(minerAddress));
    }

    // 7-step verification
    const result = await verifyAttestation(body, chain, nonceManager, config);

    // Step 7: Sign and respond
    const currentBlock = result.chainState.currentBlock;
    const deadline = BigInt(currentBlock + config.deadlineBlocksAhead);

    const signature = await signAttestation(
      wallet,
      BigInt(config.chainId),
      config.oracleVerifierAddress,
      ethers.getAddress(body.miner_address),
      result.modelHash,
      result.totalTokens,
      BigInt(body.seed_epoch),
      BigInt(body.seed),
      BigInt(body.claim_index),
      deadline,
    );

    // Record successful attestation
    rateLimiter.recordAttest(ethers.getAddress(body.miner_address));

    // Estimate reward
    let estimatedReward = '0';
    try {
      const reward = await chain.estimateReward(result.totalTokens);
      estimatedReward = reward.toString();
    } catch {
      // Non-critical — reward estimation can fail
    }

    const durationMs = Date.now() - startMs;
    metrics.recordAttest(true, durationMs);

    const sigHash = ethers.keccak256(signature);
    logger.log({
      request_id: requestId,
      miner_address: ethers.getAddress(body.miner_address),
      endpoint: '/api/v1/attest',
      success: true,
      total_tokens: body.api_response.usage.total_tokens,
      seed_epoch: body.seed_epoch,
      claim_index: body.claim_index,
      signature_hash: sigHash,
      ip_address: req.ip,
      response_time_ms: durationMs,
    });

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
      estimated_reward: estimatedReward,
    });
  } catch (err) {
    const durationMs = Date.now() - startMs;
    metrics.recordAttest(false, durationMs);

    if (err instanceof OracleError) {
      logger.log({
        request_id: requestId,
        miner_address: minerAddress,
        endpoint: '/api/v1/attest',
        success: false,
        error_code: err.code,
        total_tokens: body?.api_response?.usage?.total_tokens,
        seed_epoch: body?.seed_epoch,
        claim_index: body?.claim_index,
        ip_address: req.ip,
        response_time_ms: durationMs,
      });
      const errResp: ErrorResponse = { success: false, error: err.code, message: err.message, request_id: requestId };
      res.status(err.statusCode).json(errResp);
      return;
    }
    if (err instanceof RateLimitError) {
      logger.log({
        request_id: requestId,
        miner_address: minerAddress,
        endpoint: '/api/v1/attest',
        success: false,
        error_code: 'RATE_LIMITED',
        ip_address: req.ip,
        response_time_ms: durationMs,
      });
      const errResp: ErrorResponse = { success: false, error: 'RATE_LIMITED', message: err.message, request_id: requestId };
      res.status(429).json(errResp);
      return;
    }
    // Unexpected error
    console.error('Unexpected error:', err);
    logger.log({
      request_id: requestId,
      miner_address: minerAddress,
      endpoint: '/api/v1/attest',
      success: false,
      error_code: 'INTERNAL_ERROR',
      ip_address: req.ip,
      response_time_ms: durationMs,
    });
    const errResp: ErrorResponse = { success: false, error: 'INTERNAL_ERROR', message: 'Internal server error', request_id: requestId };
    res.status(500).json(errResp);
  }
});

// ═══════════════════ Server Startup ═══════════════════

let httpServer: ReturnType<typeof app.listen> | null = null;

async function start(): Promise<void> {
  await runStartupSelfTest(config, chain);
  nonceManager.startCleanup();
  chain.startSyncLoop();

  httpServer = app.listen(config.port, () => {
    console.log(`Oracle server listening on port ${config.port}`);
  });
}

// ═══════════════════ Graceful Shutdown ═══════════════════

function gracefulShutdown(): void {
  console.log('Shutting down gracefully...');
  chain.stopSyncLoop();
  nonceManager.close();
  rateLimiter.close();
  logger.close();
  if (httpServer) {
    httpServer.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
    // Force exit after 5s if connections don't close
    setTimeout(() => process.exit(0), 5000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

start().catch((err) => {
  console.error('Failed to start Oracle server:', err);
  process.exit(1);
});

export { app, metrics };
