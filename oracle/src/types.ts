/** OpenAI-compatible chat completion usage */
export interface ApiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** OpenAI-compatible chat completion choice */
export interface ApiChoice {
  index: number;
  message: { role: string; content: string };
  finish_reason: string;
}

/** OpenAI-compatible chat completion response */
export interface ApiResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ApiChoice[];
  usage: ApiUsage;
}

/** Chat message in the API request */
export interface ChatMessage {
  role: string;
  content: string;
}

/** The original API request sent by the miner */
export interface ApiRequest {
  model: string;
  messages: ChatMessage[];
}

/** POST /api/v1/attest request body */
export interface AttestRequest {
  miner_address: string;
  nonce: string;
  api_response: ApiResponse;
  api_request: ApiRequest;
  seed_epoch: number;
  seed: string;
  claim_index: number;
}

/** Attestation data returned on success */
export interface Attestation {
  miner_address: string;
  model_hash: string;
  total_tokens: number;
  seed_epoch: number;
  seed: string;
  claim_index: number;
  deadline: number;
  signature: string;
}

/** Success response from /api/v1/attest */
export interface AttestSuccessResponse {
  success: true;
  attestation: Attestation;
  estimated_reward: string;
}

/** Error response */
export interface ErrorResponse {
  success: false;
  error: string;
  message: string;
  request_id?: string;
}

/** Nonce response from /api/v1/nonce */
export interface NonceResponse {
  success: true;
  nonce: string;
  expires_at: number;
  message: string;
}

/** Health check response */
export interface HealthResponse {
  status: string;
  version: string;
  oracle_address: string;
  chain_id: number;
  current_block: number;
  cached_block_lag: number;
  contracts: {
    poaiw_mint: string;
    oracle_verifier: string;
  };
  chain_state?: {
    era: number;
    epoch: number;
    seed_epoch: number;
    era_model_hash: string;
  };
  uptime_seconds: number;
  metrics: {
    total_attestations: number;
    total_rejected: number;
    total_nonces: number;
    avg_attest_ms: number;
  };
}

/** On-chain state snapshot */
export interface ChainState {
  currentEra: bigint;
  currentGlobalEpoch: bigint;
  currentSeed: bigint;
  seedEpoch: bigint;
  eraModelHash: string; // bytes32 hex
  currentBlock: number;
}

/** Miner-specific on-chain state */
export interface MinerState {
  cooldownRemaining: bigint;
  epochClaimCount: bigint;
  lastClaimBlock: bigint;
}
