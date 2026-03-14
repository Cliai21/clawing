import { ethers } from 'ethers';

export const MODEL_ID = 'grok-4.1-fast';
export const MODEL_HASH = ethers.keccak256(ethers.toUtf8Bytes(MODEL_ID));

/**
 * Build a mock OpenAI-compatible API response that passes Oracle validation.
 */
export function buildMockApiResponse(params: {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  content?: string;
}) {
  const model = params.model ?? MODEL_ID;
  const promptTokens = params.promptTokens ?? 200;
  const completionTokens = params.completionTokens ?? 2300;
  const totalTokens = promptTokens + completionTokens;
  const content = params.content ?? 'This is a test response about quantum computing and its applications in modern cryptography.';

  return {
    id: `chatcmpl-test-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop' as const,
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    },
  };
}

/**
 * Build the mining prompt in Oracle-expected format.
 */
export function buildMiningPrompt(params: {
  seedHex: string;
  epoch: number;
  nonce: string;
  minerAddress: string;
  claimIndex: number;
  taskText?: string;
}): string {
  const task = params.taskText ?? 'Explain the implications of quantum computing on modern cryptography.';
  return `Clawing Mining | Seed: ${params.seedHex} | Epoch: ${params.epoch} | Nonce: ${params.nonce} | Miner: ${params.minerAddress} | ClaimIndex: ${params.claimIndex} | Task: ${task}`;
}

export function seedToHex(seed: bigint): string {
  return '0x' + seed.toString(16);
}

/**
 * Wait for a specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
