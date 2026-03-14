import { ethers } from 'ethers';

/**
 * Trusted router alias entry.
 * Maps a router-prefixed model name (e.g. "x-ai/grok-4.1-fast") to the
 * canonical model name registered on-chain (e.g. "grok-4.1-fast").
 */
export interface ModelAlias {
  /** The model name as returned by the router (e.g. "x-ai/grok-4.1-fast") */
  routerModel: string;
  /** The canonical model name on-chain (e.g. "grok-4.1-fast") */
  canonicalModel: string;
}

export interface Config {
  oraclePrivateKey: string;
  oracleAddress: string;
  rpcUrl: string;
  poaiwMintAddress: string;
  oracleVerifierAddress: string;
  port: number;
  chainId: number;
  nonceTtlSeconds: number;
  nonceMaxPerAddress: number;
  rateLimitWindowSeconds: number;
  rateLimitMaxPerWindow: number;
  deadlineBlocksAhead: number;
  signatureValidityBlocks: number;
  /** Trusted router model aliases (router model → canonical model) */
  trustedRouterAliases: Map<string, string>;
}

export function loadConfig(): Config {
  const oraclePrivateKey = requireEnv('ORACLE_PRIVATE_KEY');
  const wallet = new ethers.Wallet(oraclePrivateKey);

  return {
    oraclePrivateKey,
    oracleAddress: wallet.address,
    rpcUrl: requireEnv('RPC_URL'),
    poaiwMintAddress: ethers.getAddress(requireEnv('POAIW_MINT_ADDRESS')),
    oracleVerifierAddress: ethers.getAddress(requireEnv('ORACLE_VERIFIER_ADDRESS')),
    port: intEnv('PORT', 3000),
    chainId: intEnv('CHAIN_ID', 1),
    nonceTtlSeconds: intEnv('NONCE_TTL_SECONDS', 300),
    nonceMaxPerAddress: intEnv('NONCE_MAX_PER_ADDRESS', 3),
    rateLimitWindowSeconds: intEnv('RATE_LIMIT_WINDOW_SECONDS', 41000),
    rateLimitMaxPerWindow: intEnv('RATE_LIMIT_MAX_PER_WINDOW', 1),
    deadlineBlocksAhead: intEnv('DEADLINE_BLOCKS_AHEAD', 200),
    signatureValidityBlocks: intEnv('SIGNATURE_VALIDITY_BLOCKS', 300),
    trustedRouterAliases: parseTrustedRouterAliases(
      envOrDefault('TRUSTED_ROUTER_ALIASES', DEFAULT_TRUSTED_ROUTER_ALIASES),
    ),
  };
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function intEnv(key: string, defaultVal: number): number {
  const val = process.env[key];
  if (!val) return defaultVal;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed)) throw new Error(`Invalid integer for ${key}: ${val}`);
  return parsed;
}

function envOrDefault(key: string, defaultVal: string): string {
  return process.env[key] || defaultVal;
}

/**
 * Default trusted router aliases.
 * Format: "routerModel:canonicalModel" pairs separated by commas.
 *
 * Currently supported routers:
 *   - OpenRouter (x-ai/grok-4.1-fast → grok-4.1-fast)
 *
 * OpenRouter is the only officially supported router for Clawing Phase 1.
 * Future routers may be added via governance or official announcement.
 */
const DEFAULT_TRUSTED_ROUTER_ALIASES =
  'x-ai/grok-4.1-fast:grok-4.1-fast';

/**
 * Parse "routerModel:canonicalModel,routerModel2:canonicalModel2" into a Map.
 * Keys are case-sensitive (model names are case-sensitive in API responses).
 */
export function parseTrustedRouterAliases(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw.trim()) return map;

  for (const pair of raw.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0 || idx === trimmed.length - 1) {
      throw new Error(`Invalid TRUSTED_ROUTER_ALIASES entry: "${trimmed}". Expected "routerModel:canonicalModel".`);
    }
    const routerModel = trimmed.slice(0, idx).trim();
    const canonicalModel = trimmed.slice(idx + 1).trim();
    map.set(routerModel, canonicalModel);
  }
  return map;
}
