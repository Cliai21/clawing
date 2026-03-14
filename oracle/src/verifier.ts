import { ethers } from 'ethers';
import type { AttestRequest, ChainState, MinerState } from './types.js';
import type { Config } from './config.js';
import type { ChainReader } from './chain.js';
import type { NonceManager } from './nonce.js';
import { NonceError } from './nonce.js';
import {
  INVALID_FORMAT, INVALID_ADDRESS, INVALID_MODEL,
  INVALID_SEED, SEED_NOT_UPDATED, INVALID_PROMPT,
  COOLDOWN_ACTIVE, EPOCH_LIMIT_REACHED, INVALID_CLAIM_INDEX,
  INVALID_RESPONSE_ID, TOKENS_OUT_OF_RANGE, TOKEN_MISMATCH,
  RESPONSE_TOO_OLD, INVALID_FINISH_REASON,
  INVALID_NONCE, NONCE_EXPIRED, NONCE_ALREADY_USED,
  OracleError,
} from './errors.js';

const MIN_TOKENS = 2100n;
const MAX_TOKENS = 100_000n;
const RESPONSE_MAX_AGE_SECONDS = 300; // 5 minutes

export interface VerificationResult {
  chainState: ChainState;
  minerState: MinerState;
  modelHash: string;
  totalTokens: bigint;
}

/**
 * 7-step verification pipeline.
 * Each step throws an OracleError on failure.
 */
export async function verifyAttestation(
  req: AttestRequest,
  chain: ChainReader,
  nonceManager: NonceManager,
  _config: Config,
): Promise<VerificationResult> {
  // Step 1: FORMAT_VALIDATION
  validateFormat(req);

  // Step 2-3 require chain state
  const chainState = await chain.getChainState();

  // Step 2: MODEL_VALIDATION (with trusted router alias resolution)
  const modelHash = validateModel(req, chainState, _config.trustedRouterAliases);

  // Step 3: SEED_VALIDATION
  validateSeed(req, chainState);

  // Step 4: PROMPT_FORMAT_VALIDATION
  validatePromptFormat(req);

  // Step 5: COOLDOWN_CHECK
  const minerState = await chain.getMinerState(
    ethers.getAddress(req.miner_address),
    chainState.currentGlobalEpoch,
  );
  validateCooldown(req, minerState);

  // Step 6: ANTI_CHEAT
  validateAntiCheat(req, nonceManager);

  return {
    chainState,
    minerState,
    modelHash,
    totalTokens: BigInt(req.api_response.usage.total_tokens),
  };
}

/** Step 1: Validate request format */
function validateFormat(req: AttestRequest): void {
  // miner_address
  if (!req.miner_address || typeof req.miner_address !== 'string') {
    throw INVALID_ADDRESS('Missing or invalid miner_address');
  }
  if (!ethers.isAddress(req.miner_address)) {
    throw INVALID_ADDRESS(`Invalid Ethereum address: ${req.miner_address}`);
  }

  // nonce
  if (!req.nonce || typeof req.nonce !== 'string') {
    throw INVALID_FORMAT('Missing nonce');
  }

  // api_response
  const r = req.api_response;
  if (!r || typeof r !== 'object') throw INVALID_FORMAT('Missing api_response');
  if (typeof r.id !== 'string') throw INVALID_FORMAT('api_response.id must be a string');
  if (typeof r.object !== 'string') throw INVALID_FORMAT('api_response.object must be a string');
  if (typeof r.created !== 'number') throw INVALID_FORMAT('api_response.created must be a number');
  if (typeof r.model !== 'string') throw INVALID_FORMAT('api_response.model must be a string');
  if (!Array.isArray(r.choices) || r.choices.length < 1) {
    throw INVALID_FORMAT('api_response.choices must be a non-empty array');
  }
  if (!r.usage || typeof r.usage !== 'object') throw INVALID_FORMAT('Missing api_response.usage');
  if (typeof r.usage.prompt_tokens !== 'number') throw INVALID_FORMAT('usage.prompt_tokens must be a number');
  if (typeof r.usage.completion_tokens !== 'number') throw INVALID_FORMAT('usage.completion_tokens must be a number');
  if (typeof r.usage.total_tokens !== 'number') throw INVALID_FORMAT('usage.total_tokens must be a number');
  if (r.usage.total_tokens <= 0) throw INVALID_FORMAT('usage.total_tokens must be > 0');

  // api_request
  const rq = req.api_request;
  if (!rq || typeof rq !== 'object') throw INVALID_FORMAT('Missing api_request');
  if (typeof rq.model !== 'string') throw INVALID_FORMAT('api_request.model must be a string');
  if (!Array.isArray(rq.messages)) throw INVALID_FORMAT('api_request.messages must be an array');

  // seed_epoch, seed, claim_index
  if (typeof req.seed_epoch !== 'number') throw INVALID_FORMAT('seed_epoch must be a number');
  if (typeof req.seed !== 'string') throw INVALID_FORMAT('seed must be a string');
  if (typeof req.claim_index !== 'number') throw INVALID_FORMAT('claim_index must be a number');
}

/**
 * Resolve a model name through trusted router aliases.
 * If the model name matches a trusted alias, return the canonical name.
 * Otherwise return the original name unchanged.
 *
 * Example: "x-ai/grok-4.1-fast" → "grok-4.1-fast" (via OpenRouter alias)
 *          "grok-4.1-fast" → "grok-4.1-fast" (direct, no alias needed)
 */
export function resolveModelAlias(
  model: string,
  aliases: Map<string, string>,
): string {
  return aliases.get(model) ?? model;
}

/** Step 2: Validate model matches on-chain era model */
function validateModel(
  req: AttestRequest,
  chainState: ChainState,
  aliases: Map<string, string>,
): string {
  // Resolve router aliases: e.g. "x-ai/grok-4.1-fast" → "grok-4.1-fast"
  const responseModel = resolveModelAlias(req.api_response.model, aliases);
  const requestModel = resolveModelAlias(req.api_request.model, aliases);

  const modelHash = ethers.keccak256(ethers.toUtf8Bytes(responseModel));

  if (modelHash !== chainState.eraModelHash) {
    throw INVALID_MODEL(
      `Model '${req.api_response.model}' (canonical: '${responseModel}') does not match current Era model (expected hash: ${chainState.eraModelHash})`,
    );
  }

  // Both request and response must resolve to the same canonical model
  if (requestModel !== responseModel) {
    throw INVALID_MODEL(
      `api_request.model '${req.api_request.model}' (canonical: '${requestModel}') does not match api_response.model '${req.api_response.model}' (canonical: '${responseModel}')`,
    );
  }

  return modelHash;
}

/** Step 3: Validate seed matches on-chain state */
function validateSeed(req: AttestRequest, chainState: ChainState): void {
  if (BigInt(req.seed_epoch) !== chainState.seedEpoch) {
    throw INVALID_SEED(
      `seed_epoch ${req.seed_epoch} does not match on-chain seedEpoch ${chainState.seedEpoch}`,
    );
  }

  const reqSeed = BigInt(req.seed);
  if (reqSeed !== chainState.currentSeed) {
    throw INVALID_SEED(
      `seed does not match on-chain currentSeed`,
    );
  }

  if (chainState.seedEpoch !== chainState.currentGlobalEpoch) {
    throw SEED_NOT_UPDATED(
      `Seed not updated for current epoch. seedEpoch=${chainState.seedEpoch}, currentGlobalEpoch=${chainState.currentGlobalEpoch}`,
    );
  }
}

/** Step 4: Validate prompt contains required mining format */
function validatePromptFormat(req: AttestRequest): void {
  const userMsg = req.api_request.messages.find(m => m.role === 'user');
  if (!userMsg) {
    throw INVALID_PROMPT('No user message found in api_request.messages');
  }

  const content = userMsg.content;

  // Check for mining prompt format
  if (!content.includes('Clawing Mining')) {
    throw INVALID_PROMPT('User message must contain "Clawing Mining" prefix');
  }

  // Verify seed is in the prompt
  const seedHex = BigInt(req.seed).toString(16);
  // Check seed appears (could be 0x-prefixed or not)
  if (!content.includes(req.seed) && !content.includes('0x' + seedHex) && !content.includes(seedHex)) {
    throw INVALID_PROMPT('Seed not found in user message');
  }

  // Verify epoch
  if (!content.includes(`Epoch: ${req.seed_epoch}`)) {
    throw INVALID_PROMPT(`Epoch ${req.seed_epoch} not found in user message`);
  }

  // Verify nonce
  if (!content.includes(`Nonce: ${req.nonce}`)) {
    throw INVALID_PROMPT(`Nonce ${req.nonce} not found in user message`);
  }

  // Verify miner address (case-insensitive check)
  const minerLower = req.miner_address.toLowerCase();
  if (!content.toLowerCase().includes(minerLower)) {
    throw INVALID_PROMPT(`Miner address not found in user message`);
  }

  // Verify claim index
  if (!content.includes(`ClaimIndex: ${req.claim_index}`)) {
    throw INVALID_PROMPT(`ClaimIndex ${req.claim_index} not found in user message`);
  }

  // Verify "Task:" exists
  if (!content.includes('Task:')) {
    throw INVALID_PROMPT('User message must contain "Task:" section');
  }
}

/** Step 5: Check cooldown and epoch limits */
function validateCooldown(req: AttestRequest, minerState: MinerState): void {
  if (minerState.cooldownRemaining > 0n) {
    throw COOLDOWN_ACTIVE(
      `Cooldown active. ${minerState.cooldownRemaining} blocks remaining.`,
    );
  }

  if (minerState.epochClaimCount >= 14n) {
    throw EPOCH_LIMIT_REACHED(
      `Epoch claim limit reached (${minerState.epochClaimCount}/14)`,
    );
  }

  if (BigInt(req.claim_index) !== minerState.epochClaimCount) {
    throw INVALID_CLAIM_INDEX(
      `claim_index ${req.claim_index} does not match on-chain epochClaimCount ${minerState.epochClaimCount}`,
    );
  }
}

/** Step 6: Anti-cheat checks */
function validateAntiCheat(req: AttestRequest, nonceManager: NonceManager): void {
  const r = req.api_response;

  // Response ID format check (relaxed — just check it's non-empty)
  if (!r.id || r.id.length === 0) {
    throw INVALID_RESPONSE_ID('api_response.id is empty');
  }

  // Token range check
  const totalTokens = BigInt(r.usage.total_tokens);
  if (totalTokens < MIN_TOKENS || totalTokens > MAX_TOKENS) {
    throw TOKENS_OUT_OF_RANGE(
      `total_tokens ${r.usage.total_tokens} out of range [${MIN_TOKENS}, ${MAX_TOKENS}]`,
    );
  }

  // Token sum check — allow reasoning tokens.
  // Reasoning models (e.g. grok-4-1-fast) include hidden reasoning tokens
  // in total_tokens that are NOT reported in prompt_tokens + completion_tokens.
  // So we require: total_tokens >= prompt_tokens + completion_tokens.
  const declaredSum = r.usage.prompt_tokens + r.usage.completion_tokens;
  if (r.usage.total_tokens < declaredSum) {
    throw TOKEN_MISMATCH(
      `total_tokens (${r.usage.total_tokens}) < prompt_tokens (${r.usage.prompt_tokens}) + completion_tokens (${r.usage.completion_tokens})`,
    );
  }

  // Response freshness
  const now = Math.floor(Date.now() / 1000);
  if (now - r.created > RESPONSE_MAX_AGE_SECONDS) {
    throw RESPONSE_TOO_OLD(
      `api_response.created is ${now - r.created} seconds old (max ${RESPONSE_MAX_AGE_SECONDS})`,
    );
  }

  // Finish reason
  const finishReason = r.choices[0]?.finish_reason;
  if (finishReason !== 'stop' && finishReason !== 'length') {
    throw INVALID_FINISH_REASON(
      `finish_reason '${finishReason}' is not 'stop' or 'length'`,
    );
  }

  // Nonce validation
  try {
    nonceManager.validate(req.nonce, ethers.getAddress(req.miner_address));
  } catch (err) {
    if (err instanceof NonceError) {
      switch (err.code) {
        case 'NONCE_EXPIRED':
          throw NONCE_EXPIRED(err.message);
        case 'NONCE_ALREADY_USED':
          throw NONCE_ALREADY_USED(err.message);
        default:
          throw INVALID_NONCE(err.message);
      }
    }
    throw err;
  }
}
