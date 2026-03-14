import { ethers } from 'ethers';
import type { AiApiResponse, ChainState, MinerChainState } from '../src/types.js';
import type { MinerConfig } from '../src/config.js';

export const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const TEST_WALLET = new ethers.Wallet(TEST_PRIVATE_KEY);
export const TEST_MINER_ADDRESS = TEST_WALLET.address;
export const TEST_MODEL = 'grok-4.1-fast';
export const TEST_MODEL_HASH = ethers.keccak256(ethers.toUtf8Bytes(TEST_MODEL));

export function makeChainState(overrides?: Partial<ChainState>): ChainState {
  return {
    currentEra: 1n,
    currentGlobalEpoch: 42n,
    currentSeed: BigInt('0xabc123'),
    seedEpoch: 42n,
    eraModelHash: TEST_MODEL_HASH,
    currentBlock: 19500000,
    ...overrides,
  };
}

export function makeMinerState(overrides?: Partial<MinerChainState>): MinerChainState {
  return {
    cooldownRemaining: 0n,
    epochClaimCount: 0n,
    maxClaimsPerEpoch: 14n,
    ethBalance: ethers.parseEther('1.0'),
    ...overrides,
  };
}

export function makeAiResponse(overrides?: Partial<AiApiResponse>): AiApiResponse {
  return {
    id: 'chatcmpl-test123',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: TEST_MODEL,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Quantum computing is...' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 200, completion_tokens: 2300, total_tokens: 2500 },
    ...overrides,
  };
}

export function makeTestConfig(): MinerConfig {
  return {
    wallet: TEST_WALLET,
    minerAddress: TEST_MINER_ADDRESS,
    aiApiKey: 'sk-test',
    aiApiUrl: 'https://api.x.ai/v1/chat/completions',
    aiModel: TEST_MODEL,
    oracleUrl: 'http://localhost:3000',
    rpcUrl: 'http://localhost:8545',
    poaiwMintAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    maxGasPriceGwei: 2,
    taskPrompt: 'Explain quantum computing in detail.',
  };
}
