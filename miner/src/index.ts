#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { ChainClient } from './chain.js';
import { checkOracleHealth } from './oracle.js';
import { mineOnce, autoMine } from './miner.js';
import * as display from './display.js';
import fs from 'node:fs';
import readline from 'node:readline';

const program = new Command();

program
  .name('openclaw-miner')
  .description('Clawing Miner CLI — mine CLAW tokens by calling AI APIs')
  .version('1.0.0');

// ═══════════════════ init ═══════════════════

program
  .command('init')
  .description('Interactive setup — creates a .env file')
  .action(async () => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, resolve));

    console.log('\n  Clawing Miner Setup\n');
    console.log('  Note: For security, this setup does NOT ask for your private key.');
    console.log('  After setup, edit .env and add your PRIVATE_KEY manually.\n');

    // ═══ API Provider Selection ═══
    console.log('\n  Select your AI API provider:');
    console.log('    [1] xAI Direct     (https://api.x.ai) — recommended');
    console.log('    [2] OpenRouter     (https://openrouter.ai) — officially supported');
    console.log('    [3] Custom endpoint');
    const providerChoice = (await ask('\n? Choose provider [1/2/3] (default: 1): ')) || '1';

    let aiApiUrl: string;
    let aiModel: string;
    let aiApiKey: string;

    if (providerChoice === '2') {
      // OpenRouter
      aiApiUrl = 'https://openrouter.ai/api/v1/chat/completions';
      aiModel = 'x-ai/grok-4.1-fast';
      aiApiKey = await ask('? Enter your OpenRouter API key: ');
      console.log(`\n  ✓ Using OpenRouter → model: ${aiModel}`);
    } else if (providerChoice === '3') {
      // Custom
      aiApiUrl = await ask('? Enter custom AI API URL: ');
      aiModel = (await ask('? Enter AI model name (default: grok-4.1-fast): ')) || 'grok-4.1-fast';
      aiApiKey = await ask('? Enter your API key: ');
    } else {
      // xAI Direct (default)
      aiApiUrl = 'https://api.x.ai/v1/chat/completions';
      aiModel = 'grok-4.1-fast';
      aiApiKey = await ask('? Enter your xAI API key: ');
    }

    const oracleUrl = (await ask('\n? Enter Oracle URL (default: http://localhost:3000): '))
      || 'http://localhost:3000';
    const rpcUrl = await ask('? Enter RPC URL: ');
    const poaiwMintAddress = await ask('? Enter PoAIWMint contract address: ');
    const maxGas = (await ask('? Max gas price in gwei (default: 2): ')) || '2';
    const taskPrompt = (await ask('? Mining task prompt (default: Explain quantum computing in detail.): '))
      || 'Explain quantum computing in detail.';

    rl.close();

    const providerComment = providerChoice === '2'
      ? '# Provider: OpenRouter (officially supported)'
      : providerChoice === '3'
        ? '# Provider: Custom endpoint'
        : '# Provider: xAI Direct (recommended)';

    const envContent = `# === Wallet ===
# SECURITY: Paste your private key below manually. Do NOT share it with any agent or chat.
# Use a dedicated hot wallet with minimal ETH — never your main wallet or hardware wallet.
PRIVATE_KEY=

# === AI API ===
${providerComment}
AI_API_KEY=${aiApiKey}
AI_API_URL=${aiApiUrl}
AI_MODEL=${aiModel}

# === Oracle ===
ORACLE_URL=${oracleUrl}

# === Chain ===
RPC_URL=${rpcUrl}
POAIW_MINT_ADDRESS=${poaiwMintAddress}

# === Mining Config ===
MAX_GAS_PRICE_GWEI=${maxGas}
TASK_PROMPT=${taskPrompt}
`;

    fs.writeFileSync('.env', envContent, { mode: 0o600 });
    console.log('\n  .env file created (permissions: 600).');
    console.log('  ⚠  Open .env and paste your PRIVATE_KEY before running mine or auto.\n');
  });

// ═══════════════════ status ═══════════════════

program
  .command('status')
  .description('Display current mining status')
  .action(async () => {
    try {
      const config = loadConfig();
      const chain = new ChainClient(config);

      const chainState = await chain.getChainState();
      const minerState = await chain.getMinerState(config.minerAddress, chainState.currentGlobalEpoch);
      const oracleHealthy = await checkOracleHealth(config.oracleUrl);

      display.printStatus({
        minerAddress: config.minerAddress,
        ethBalance: minerState.ethBalance,
        chainState,
        minerState,
        oracleUrl: config.oracleUrl,
        oracleHealthy,
      });
    } catch (err) {
      display.error((err as Error).message);
      process.exit(1);
    }
  });

// ═══════════════════ mine ═══════════════════

program
  .command('mine')
  .description('Execute a single mining cycle')
  .action(async () => {
    try {
      const config = loadConfig();
      const chain = new ChainClient(config);
      await mineOnce({ chain, config });
    } catch (err) {
      display.error((err as Error).message);
      process.exit(1);
    }
  });

// ═══════════════════ auto ═══════════════════

program
  .command('auto')
  .description('Start automatic mining loop (Ctrl+C to stop)')
  .action(async () => {
    try {
      const config = loadConfig();
      const chain = new ChainClient(config);
      await autoMine({ chain, config });
    } catch (err) {
      display.error((err as Error).message);
      process.exit(1);
    }
  });

program.parse();
