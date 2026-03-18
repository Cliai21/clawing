# Quick Start

Get mining $CLAW in under 5 minutes using [OpenClaw](https://openclaw.ai), the recommended mining platform.

---

## Prerequisites

- An Ethereum wallet (MetaMask, Rabby, or any Web3 wallet)
- A small amount of ETH for gas fees (~0.005 ETH per claim)
- An AI API key for the current mining model (`grok-4.1-fast`)

## Option A: Mine with OpenClaw (Recommended)

[OpenClaw](https://openclaw.ai) is the easiest way to start mining $CLAW. It handles AI API calls, Oracle interaction, and on-chain submission automatically.

### Step 1: Visit OpenClaw

Navigate to [openclaw.ai](https://openclaw.ai) and connect your Ethereum wallet.

### Step 2: Configure Your API Key

Enter your AI API key in the settings panel. OpenClaw currently supports the `grok-4.1-fast` model.

### Step 3: Start Mining

Click **Mine CLAW** or use the built-in command:

```
mine CLAW
```

OpenClaw will:
1. Generate AI content using your API key
2. Submit it to the Oracle for verification
3. Return the signed attestation
4. Prompt you to sign the on-chain transaction
5. Mint $CLAW directly to your wallet

### Step 4: Monitor Your Mining

View your mining status, including:
- Current Era and Epoch
- Cooldown remaining
- Claims used in current Epoch (max 14)
- Accumulated $CLAW balance

## Option B: Mine with the CLI

For developers who prefer command-line tools:

```bash
# Clone the repository
git clone https://github.com/Cliai21/clawing.git
cd clawing

# Install dependencies
npm install

# Initialize your miner configuration
npx claw init

# Check mining status
npx claw status

# Start mining
npx claw mine
```

For full CLI setup instructions, see [Installation](installation.md).

## Option C: Mine with Hermes Agent

Hermes Agent provides an autonomous mining experience. Connect your wallet, configure the agent, and let it mine on your schedule.

See [Platforms](platforms.md) for details on all supported mining interfaces.

---

## What Happens When You Mine

```
You (Miner)                Oracle                    Ethereum
    │                        │                          │
    │── Generate AI Content ─>│                          │
    │                        │── Verify Content ──>     │
    │<── Signed Attestation ──│                          │
    │                        │                          │
    │── Submit Attestation ──────────────────────────>  │
    │                        │                    Verify Signature
    │                        │                    Mint $CLAW
    │<── $CLAW Minted ──────────────────────────────── │
```

### Key Timings

| Event | Duration |
|---|---|
| AI content generation | ~2-5 seconds |
| Oracle verification | ~3-10 seconds |
| On-chain confirmation | ~12-30 seconds (1-2 blocks) |
| **Total per claim** | **~20-45 seconds** |
| Cooldown between claims | ~11.67 hours (3,500 blocks) |

### Rewards

In Era 1, each successful claim earns:

```
R = 100,000 × (1 + ln(T))
```

Where `T` is the number of blocks since your last claim (minimum 3,500).

**Example**: After exactly 3,500 blocks of cooldown:
```
R = 100,000 × (1 + ln(3500))
R = 100,000 × (1 + 8.16)
R = 100,000 × 9.16
R ≈ 916,000 CLAW
```

## Costs

| Cost | Estimate |
|---|---|
| AI API call | ~$0.001-0.01 per generation |
| Ethereum gas | ~0.001-0.005 ETH per claim |
| **Total per claim** | **< $1 USD typical** |

## Troubleshooting Quick Start

| Issue | Solution |
|---|---|
| "Cooldown not met" | Wait for 3,500 blocks (~11.67 hrs) since your last claim |
| "Epoch claim limit reached" | You've used all 14 claims this epoch. Wait for the next epoch (~6.94 days) |
| "Oracle verification failed" | Ensure you're using the correct AI model (`grok-4.1-fast`) |
| "Insufficient gas" | Add more ETH to your wallet for transaction fees |
| "Nonce expired" | Request a fresh nonce from the Oracle and retry |

## Next Steps

- [Installation](installation.md) — Full setup guide with all configuration options
- [Platforms](platforms.md) — Compare all mining platforms
- [CLI Reference](../reference/cli-reference.md) — Complete command reference
- [FAQ](../community/faq.md) — Common questions answered
