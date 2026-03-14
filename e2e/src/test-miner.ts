import { ethers } from 'ethers';
import type { DeployedContracts } from './deploy.js';
import { getContracts, getSignedPoaiwMint } from './contracts.js';
import { buildMockApiResponse, buildMiningPrompt, seedToHex, MODEL_ID } from './utils.js';


export interface MineResult {
  txHash: string;
  reward: bigint;
  totalTokens: number;
  claimIndex: number;
  attestation: {
    model_hash: string;
    total_tokens: number;
    seed_epoch: number;
    seed: string;
    claim_index: number;
    deadline: number;
    signature: string;
  };
}

/**
 * Execute a full mining cycle for one miner:
 * 1. Read chain state
 * 2. Get nonce from Oracle
 * 3. Build prompt + mock AI response
 * 4. Submit to Oracle /api/v1/attest
 * 5. Submit mint() tx on-chain
 */
export async function mineOnce(
  provider: ethers.JsonRpcProvider,
  addresses: DeployedContracts,
  minerKey: string,
  oracleUrl: string,
  options?: {
    promptTokens?: number;
    completionTokens?: number;
    model?: string;
  },
): Promise<MineResult> {
  const minerWallet = new ethers.Wallet(minerKey, provider);
  const minerAddress = minerWallet.address;
  const contracts = getContracts(provider, addresses);

  // 1. Read chain state
  const [seed, seedEpoch, epoch] = await Promise.all([
    contracts.poaiwMint.currentSeed() as Promise<bigint>,
    contracts.poaiwMint.seedEpoch() as Promise<bigint>,
    contracts.poaiwMint.currentGlobalEpoch() as Promise<bigint>,
  ]);

  const claimCount = await contracts.poaiwMint.epochClaimCount(minerAddress, epoch) as bigint;
  const claimIndex = Number(claimCount);

  // 2. Get nonce from Oracle
  const nonceResp = await fetch(`${oracleUrl}/api/v1/nonce?miner=${minerAddress}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!nonceResp.ok) {
    const errBody = await nonceResp.text();
    throw new Error(`Nonce request failed: ${nonceResp.status} ${errBody}`);
  }
  const nonceData = await nonceResp.json() as { success: boolean; nonce: string };
  if (!nonceData.success) throw new Error('Nonce request returned success=false');
  const nonce = nonceData.nonce;

  // 3. Construct prompt + mock AI response
  const seedHex = seedToHex(seed);
  const prompt = buildMiningPrompt({
    seedHex,
    epoch: Number(epoch),
    nonce,
    minerAddress,
    claimIndex,
  });

  const model = options?.model ?? MODEL_ID;
  const apiResponse = buildMockApiResponse({
    model,
    promptTokens: options?.promptTokens,
    completionTokens: options?.completionTokens,
  });

  const apiRequest = {
    model,
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: prompt },
    ],
  };

  // 4. Submit to Oracle /api/v1/attest
  const attestResp = await fetch(`${oracleUrl}/api/v1/attest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      miner_address: minerAddress,
      nonce,
      api_response: apiResponse,
      api_request: apiRequest,
      seed_epoch: Number(seedEpoch),
      seed: seed.toString(),
      claim_index: claimIndex,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  const attestBody = await attestResp.json() as {
    success: boolean;
    error?: string;
    message?: string;
    attestation?: MineResult['attestation'];
  };

  if (!attestBody.success || !attestBody.attestation) {
    throw new Error(`Attestation failed: ${attestBody.error} — ${attestBody.message}`);
  }

  const att = attestBody.attestation;

  // 5. Submit mint() tx on-chain (Anvil auto-mines each tx)
  const poaiwMint = getSignedPoaiwMint(provider, addresses, minerKey);

  const tx = await poaiwMint.mint(
    att.model_hash,
    BigInt(att.total_tokens),
    BigInt(att.seed_epoch),
    BigInt(att.seed),
    BigInt(att.claim_index),
    BigInt(att.deadline),
    att.signature,
  );

  const receipt = await tx.wait();

  return {
    txHash: receipt.hash,
    reward: 0n, // Will be read from balance
    totalTokens: att.total_tokens,
    claimIndex: att.claim_index,
    attestation: att,
  };
}

/**
 * Fetch an attestation from Oracle without submitting on-chain.
 * Used for error path tests.
 */
export async function getAttestation(
  provider: ethers.JsonRpcProvider,
  addresses: DeployedContracts,
  minerKey: string,
  oracleUrl: string,
  overrides?: {
    nonce?: string;
    model?: string;
    seedEpoch?: number;
    seed?: string;
    claimIndex?: number;
    promptTokens?: number;
    completionTokens?: number;
  },
): Promise<{
  success: boolean;
  error?: string;
  message?: string;
  attestation?: MineResult['attestation'];
}> {
  const minerWallet = new ethers.Wallet(minerKey, provider);
  const minerAddress = minerWallet.address;
  const contracts = getContracts(provider, addresses);

  const [seed, seedEpoch, epoch] = await Promise.all([
    contracts.poaiwMint.currentSeed() as Promise<bigint>,
    contracts.poaiwMint.seedEpoch() as Promise<bigint>,
    contracts.poaiwMint.currentGlobalEpoch() as Promise<bigint>,
  ]);

  const claimCount = await contracts.poaiwMint.epochClaimCount(minerAddress, epoch) as bigint;
  const claimIndex = overrides?.claimIndex ?? Number(claimCount);

  // Get nonce or use override
  let nonce = overrides?.nonce;
  if (!nonce) {
    const nonceResp = await fetch(`${oracleUrl}/api/v1/nonce?miner=${minerAddress}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const nonceData = await nonceResp.json() as { nonce: string };
    nonce = nonceData.nonce;
  }

  const useSeed = overrides?.seed ?? seed.toString();
  const useSeedEpoch = overrides?.seedEpoch ?? Number(seedEpoch);
  const model = overrides?.model ?? MODEL_ID;

  const seedHex = seedToHex(BigInt(useSeed));
  const prompt = buildMiningPrompt({
    seedHex,
    epoch: Number(epoch),
    nonce,
    minerAddress,
    claimIndex,
  });

  const apiResponse = buildMockApiResponse({
    model,
    promptTokens: overrides?.promptTokens,
    completionTokens: overrides?.completionTokens,
  });

  const apiRequest = {
    model,
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: prompt },
    ],
  };

  const resp = await fetch(`${oracleUrl}/api/v1/attest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      miner_address: minerAddress,
      nonce,
      api_response: apiResponse,
      api_request: apiRequest,
      seed_epoch: useSeedEpoch,
      seed: useSeed,
      claim_index: claimIndex,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  return resp.json() as Promise<{
    success: boolean;
    error?: string;
    message?: string;
    attestation?: MineResult['attestation'];
  }>;
}
