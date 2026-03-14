import { ethers } from 'ethers';
import type { AttestRequest, ApiResponse, ApiRequest } from '../src/types.js';
import { parseTrustedRouterAliases } from '../src/config.js';

/** Known test private key (Hardhat account #0) */
export const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const TEST_WALLET = new ethers.Wallet(TEST_PRIVATE_KEY);
export const TEST_ORACLE_ADDRESS = TEST_WALLET.address;

export const TEST_CHAIN_ID = 1n;
export const TEST_VERIFIER_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
export const TEST_MINER_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
export const TEST_MODEL = 'grok-4.1-fast';
export const TEST_MODEL_HASH = ethers.keccak256(ethers.toUtf8Bytes(TEST_MODEL));

export function makeValidApiResponse(overrides?: Partial<ApiResponse>): ApiResponse {
  return {
    id: 'chatcmpl-test123',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: TEST_MODEL,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Test response about quantum computing.' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 200,
      completion_tokens: 2300,
      total_tokens: 2500,
    },
    ...overrides,
  };
}

export function makeValidApiRequest(
  nonce: string,
  seed: string = '0xabc123',
  epoch: number = 42,
  claimIndex: number = 0,
  minerAddress: string = TEST_MINER_ADDRESS,
  overrides?: Partial<ApiRequest>,
): ApiRequest {
  return {
    model: TEST_MODEL,
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      {
        role: 'user',
        content: `Clawing Mining | Seed: ${seed} | Epoch: ${epoch} | Nonce: ${nonce} | Miner: ${minerAddress} | ClaimIndex: ${claimIndex} | Task: Explain quantum computing.`,
      },
    ],
    ...overrides,
  };
}

export function makeValidAttestRequest(
  nonce: string,
  overrides?: Partial<AttestRequest>,
): AttestRequest {
  const seed = '0xabc123';
  const epoch = 42;
  const claimIndex = 0;
  return {
    miner_address: TEST_MINER_ADDRESS,
    nonce,
    api_response: makeValidApiResponse(),
    api_request: makeValidApiRequest(nonce, seed, epoch, claimIndex),
    seed_epoch: epoch,
    seed,
    claim_index: claimIndex,
    ...overrides,
  };
}

export function makeTestConfig() {
  return {
    oraclePrivateKey: TEST_PRIVATE_KEY,
    oracleAddress: TEST_ORACLE_ADDRESS,
    rpcUrl: 'http://localhost:8545',
    poaiwMintAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    oracleVerifierAddress: TEST_VERIFIER_ADDRESS,
    port: 3000,
    chainId: 1,
    nonceTtlSeconds: 300,
    nonceMaxPerAddress: 3,
    rateLimitWindowSeconds: 41000,
    rateLimitMaxPerWindow: 1,
    deadlineBlocksAhead: 200,
    signatureValidityBlocks: 300,
    trustedRouterAliases: parseTrustedRouterAliases('x-ai/grok-4.1-fast:grok-4.1-fast'),
  };
}

/** OpenRouter-prefixed model name for grok-4.1-fast */
export const TEST_OPENROUTER_MODEL = 'x-ai/grok-4.1-fast';
