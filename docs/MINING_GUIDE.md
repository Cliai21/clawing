# Clawing Mining Guide

A complete guide to mining $CLAW tokens using Proof of AI Work (PoAIW).

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Quick Start (OpenClaw)](#quick-start-openclaw)
- [Other Platforms](#other-platforms)
- [Mining Economics](#mining-economics)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

---

## Overview

$CLAW is a cryptocurrency mined through Proof of AI Work. Instead of solving mathematical puzzles, miners produce AI-generated content that is verified by an on-chain Oracle. Valid contributions earn CLAW tokens.

The entire process is automated through AI Agent Skills. You install the CLAW Mining Skill on a compatible AI Agent platform, provide your credentials, and the agent handles the rest — calling the AI API, requesting Oracle verification, submitting on-chain transactions, and managing cooldown timers.

Each mining cycle takes about 30-60 seconds. After a successful mine, a cooldown of 3,500 blocks (~11.67 hours) must pass before the same address can mine again.

**Your keys stay local.** The `init` command never asks for or writes your private key — you paste it into `.env` yourself. At runtime the miner loads it into memory for local transaction signing only. The key is never logged, transmitted, or sent to any external service.

---

## Prerequisites

Before you start, you'll need:

| Requirement | Details | Where to Get It |
|-------------|---------|------------------|
| **AI Agent Platform** | OpenClaw (recommended), Hermes Agent, or Perplexity Computer | [OpenClaw](https://openclaw.ai) |
| **Node.js** | Version 20 or higher | [nodejs.org](https://nodejs.org) |
| **Ethereum Wallet** | A private key with some ETH for gas fees (~0.01 ETH is enough for many mines) | MetaMask, or any wallet |
| **AI API Key** | xAI API key (recommended) or OpenRouter API key | [console.x.ai](https://console.x.ai) or [openrouter.ai](https://openrouter.ai) |
| **Ethereum RPC** | A mainnet RPC endpoint | [alchemy.com](https://www.alchemy.com) or [infura.io](https://infura.io) |

### Important Notes

- Your private key stays on your local machine and is never transmitted externally
- The AI API key (xAI or OpenRouter) incurs per-call costs — factor this into mining economics
- Use a dedicated hot wallet for mining, NOT your main wallet or hardware wallet

---

## Quick Start (OpenClaw)

The fastest way to start mining:

### Step 1: Install the CLAW Mining Skill

In OpenClaw, install the skill:

```bash
clawhub install claw-mining
```

### Step 2: Restart OpenClaw

Skills are loaded at session start. Restart your OpenClaw session after installing.

### Step 3: Tell the Agent to Mine

Simply say:

> "mine CLAW"

The agent will guide you through the process and ask for:

1. **AI API Key** — from [console.x.ai](https://console.x.ai) (format: `xai-...`) or [openrouter.ai](https://openrouter.ai)
2. **Ethereum RPC URL** — from [Alchemy](https://www.alchemy.com/) or [Infura](https://infura.io/)

The agent will NOT ask for your private key. After setup, you manually edit the `.env` file and paste your `PRIVATE_KEY` yourself. Use a dedicated hot wallet with minimal ETH — never your main wallet.

### Step 4: Let the Agent Mine

Once configured, the agent will:

- Verify the configuration is correct
- Execute mining cycles automatically
- Wait for cooldown periods between mines (~11.67 hours)
- Pause if gas prices are too high
- Retry on errors with backoff
- Report results back to you

No manual intervention required after initial setup.

---

## Other Platforms

### Hermes Agent

Install using the Hermes Skills Hub:

```bash
hermes skills publish skills/my-skill --to github --repo Cliai21/clawing
```

Or install directly from GitHub:

```bash
hermes skills install github:Cliai21/clawing
```

### Perplexity Computer

The skill is compatible with Perplexity Computer's AgentSkills format. Install by referencing the GitHub repository.

### Manual Setup (Any Platform)

If your platform doesn't support automatic skill installation:

1. Clone the repository:
   ```bash
   git clone https://github.com/Cliai21/clawing.git
   cd clawing/miner
   npm install
   ```

2. Run interactive setup:
   ```bash
   npx tsx src/index.ts init
   ```

3. Edit `.env` and add your `PRIVATE_KEY`

4. Start mining:
   ```bash
   npx tsx src/index.ts auto
   ```

---

## Mining Economics

### Reward Formula

```
R = perBlock × (1 + ln(T))
```

Where:
- `R` = CLAW tokens earned per mine
- `perBlock` = Base reward for current Era (Era 1 = 100,000 CLAW)
- `T` = Number of AI tokens consumed (range: 100–100,000)

### Era 1 Reward Examples

| AI Tokens (T) | Reward per Mine | Notes |
|----------------|-----------------|-------|
| 2,100 | ~862,300 CLAW | Minimum practical, best ROI |
| 5,000 | ~931,600 CLAW | Moderate |
| 10,000 | ~1,000,900 CLAW | Higher cost, diminishing returns |

### Cost Breakdown (Era 1)

| Cost Component | Approximate Cost |
|----------------|------------------|
| Gas per mine | ~0.0002 ETH (at 2 gwei) |
| xAI API call (T=2100) | ~$0.002–0.005 |
| Total per mine | ~$0.01–0.02 |

### Key Limits

| Parameter | Value |
|-----------|-------|
| Cooldown | 3,500 blocks (~11.67 hours) |
| Max claims per Epoch | 14 per address |
| Epoch duration | 50,000 blocks (~6.94 days) |
| Era duration | 21 Epochs (~145 days) |
| Total Eras | 24 (~9.6 years) |
| Max supply | 210 billion CLAW |

### Cost-Efficiency Tip

Use `T=2100` (minimum practical tokens). The reward formula is logarithmic — increasing T from 2,100 to 100,000 (47x more API cost) only increases reward by ~40%. Minimize AI API spend for maximum ROI.

---

## Troubleshooting

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `CooldownNotMet` | Mined too recently | Wait ~11.67 hours, or use `auto` mode |
| `EpochClaimLimitReached` | 14 claims this Epoch | Wait for next Epoch (~1 week) |
| `Gas price exceeds limit` | Network gas too high | Wait, or increase `MAX_GAS_PRICE_GWEI` |
| `Oracle nonce error` | Oracle rate limit | Wait 60 seconds and retry |
| `AI API error: 401` | Invalid API key | Check `AI_API_KEY` in `.env` |
| `AI API error: 429` | API rate limit | Wait and retry |
| `InvalidSignature` | Oracle mismatch | Retry; if persistent, check Oracle |
| `Missing required environment variable` | `.env` not loaded | Run `set -a && source .env && set +a` |

### Checking Status

```bash
# Check mining status
npx tsx src/index.ts status

# Check Oracle health
curl https://oracle.minewithclaw.com/health
```

---

## FAQ

### General

**Q: What is Proof of AI Work?**
A: Instead of solving mathematical puzzles (like Bitcoin), miners produce AI-generated content. An Oracle verifies the content quality and signs an attestation. The miner submits this attestation on-chain to receive CLAW tokens.

**Q: Can I use any AI provider?**
A: The recommended provider is xAI Direct (lowest cost). OpenRouter is also supported as an alternative. The Mining Skill supports both options.

**Q: Is my private key safe?**
A: Yes. The `init` command never asks for your private key — you add it to `.env` manually. At runtime the miner loads it into memory for local signing only and removes it from the config object immediately. The key is never logged, transmitted, or sent to the Oracle, AI API, or any external service.

### Mining

**Q: How often can I mine?**
A: Once every ~11.67 hours (3,500 blocks cooldown). In `auto` mode, the miner handles this automatically.

**Q: What's the maximum I can mine per week?**
A: 14 times per Epoch (~1 week). After that, you must wait for the next Epoch.

**Q: Is mining profitable?**
A: At Era 1 rates, each mine costs about $0.01–0.02 and earns ~862,000+ CLAW tokens. Profitability depends on the market value of CLAW.

### Technical

**Q: Do I need to run my own Oracle?**
A: No. Use the public Oracle at `https://oracle.minewithclaw.com`.

**Q: Can I mine with multiple wallets?**
A: Yes. Each wallet has its own independent cooldown. Create separate `.env` files or use separate directories.

**Q: What happens if the Oracle is down?**
A: The miner will retry automatically with exponential backoff. In `auto` mode, it keeps trying until the Oracle comes back online.
