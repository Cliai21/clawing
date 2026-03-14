export class OracleError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number = 400) {
    super(message);
    this.name = 'OracleError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// Step 1: Format validation
export const INVALID_FORMAT = (msg: string) =>
  new OracleError('INVALID_FORMAT', msg);
export const INVALID_ADDRESS = (msg: string) =>
  new OracleError('INVALID_ADDRESS', msg);

// Step 2: Model validation
export const INVALID_MODEL = (msg: string) =>
  new OracleError('INVALID_MODEL', msg);

// Step 3: Seed validation
export const INVALID_SEED = (msg: string) =>
  new OracleError('INVALID_SEED', msg);
export const SEED_NOT_UPDATED = (msg: string) =>
  new OracleError('SEED_NOT_UPDATED', msg);

// Step 4: Prompt format validation
export const INVALID_PROMPT = (msg: string) =>
  new OracleError('INVALID_PROMPT', msg);

// Step 5: Cooldown check
export const COOLDOWN_ACTIVE = (msg: string) =>
  new OracleError('COOLDOWN_ACTIVE', msg);
export const EPOCH_LIMIT_REACHED = (msg: string) =>
  new OracleError('EPOCH_LIMIT_REACHED', msg);
export const INVALID_CLAIM_INDEX = (msg: string) =>
  new OracleError('INVALID_CLAIM_INDEX', msg);

// Step 6: Anti-cheat
export const INVALID_RESPONSE_ID = (msg: string) =>
  new OracleError('INVALID_RESPONSE_ID', msg);
export const TOKENS_OUT_OF_RANGE = (msg: string) =>
  new OracleError('TOKENS_OUT_OF_RANGE', msg);
export const TOKEN_MISMATCH = (msg: string) =>
  new OracleError('TOKEN_MISMATCH', msg);
export const RESPONSE_TOO_OLD = (msg: string) =>
  new OracleError('RESPONSE_TOO_OLD', msg);
export const INVALID_FINISH_REASON = (msg: string) =>
  new OracleError('INVALID_FINISH_REASON', msg);
export const INVALID_NONCE = (msg: string) =>
  new OracleError('INVALID_NONCE', msg);
export const NONCE_EXPIRED = (msg: string) =>
  new OracleError('NONCE_EXPIRED', msg);
export const NONCE_ALREADY_USED = (msg: string) =>
  new OracleError('NONCE_ALREADY_USED', msg);

// Rate limiting
export const RATE_LIMITED = (msg: string) =>
  new OracleError('RATE_LIMITED', msg, 429);

// Internal
export const INTERNAL_ERROR = (msg: string) =>
  new OracleError('INTERNAL_ERROR', msg, 500);
