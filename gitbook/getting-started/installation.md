# Installation

Complete guide to setting up the CLAWING miner from source. This covers cloning the repository, configuring your environment, and running all available CLI commands.

---

## System Requirements

| Requirement | Minimum |
|---|---|
| **Node.js** | v18.0.0 or higher |
| **npm** | v9.0.0 or higher |
| **OS** | Linux, macOS, or Windows (WSL recommended) |
| **Network** | Stable internet connection |
| **ETH** | Small amount for gas fees |

## Step 1: Clone the Repository

```bash
git clone https://github.com/Cliai21/clawing.git
cd clawing
```

## Step 2: Install Dependencies

```bash
npm install
```

This installs all required packages, including:
- `ethers` — Ethereum interaction
- `dotenv` — Environment variable management
- CLI tooling and Oracle client libraries

## Step 3: Initialize Configuration

```bash
npx claw init
```

This creates a `.env` file with the required configuration template. You will need to fill in the following values:

### Environment Variables

```bash
# === Required ===

# Your Ethereum private key (never share this!)
PRIVATE_KEY=0x_your_private_key_here

# AI API key for the current mining model
AI_API_KEY=your_api_key_here

# === Optional (defaults shown) ===

# Ethereum RPC endpoint
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/your_key

# Oracle endpoint
ORACLE_URL=https://oracle.minewithclaw.com

# AI model to use for mining
AI_MODEL=grok-4.1-fast

# Gas price strategy: "auto", "fast", "standard", "slow"
GAS_STRATEGY=auto

# Maximum gas price in gwei (safety cap)
MAX_GAS_GWEI=50
```

### Configuration Notes

| Variable | Required | Description |
|---|---|---|
| `PRIVATE_KEY` | Yes | Ethereum wallet private key for signing transactions |
| `AI_API_KEY` | Yes | API key for the designated AI model |
| `ETH_RPC_URL` | No | Custom RPC endpoint (default: public endpoint) |
| `ORACLE_URL` | No | Oracle server URL (default: `https://oracle.minewithclaw.com`) |
| `AI_MODEL` | No | Mining model (default: current Era model) |
| `GAS_STRATEGY` | No | Gas pricing strategy (default: `auto`) |
| `MAX_GAS_GWEI` | No | Gas price safety cap (default: `50`) |

## Step 4: Verify Setup

Check that everything is configured correctly:

```bash
npx claw status
```

This displays:

```
CLAWING Miner Status
====================
Network:        Ethereum Mainnet
Wallet:         0x1234...abcd
ETH Balance:    0.05 ETH
CLAW Balance:   0 CLAW

Mining Status:
  Current Era:    1
  Current Epoch:  3
  Claims Used:    0 / 14
  Cooldown:       Ready
  AI Model:       grok-4.1-fast

Contracts:
  CLAW Token:     0x4ba1209b165b62a1f0d2fbf22d67cacf43a6df2b
  PoAIWMint:      0x511351940d99f3012c79c613478e8f2c887a8259
  OracleVerifier: 0xc24a0ba99b9ff6b7ccea6beb4013b69f39024fd5
```

## Step 5: Start Mining

### Single Claim

```bash
npx claw mine
```

This executes one complete mining cycle:
1. Generates AI content via the configured model
2. Requests a nonce from the Oracle
3. Submits the content for Oracle verification
4. Receives the signed attestation
5. Submits the on-chain transaction
6. Reports the minted $CLAW amount

### Automated Mining

```bash
npx claw auto
```

Automated mode continuously mines whenever the cooldown period has elapsed. It:
- Monitors the cooldown timer
- Automatically initiates claims when ready
- Respects the 14-claim epoch limit
- Logs all activity to `./logs/mining.log`

Press `Ctrl+C` to stop automated mining.

## RPC Provider Setup

For reliable mining, use a dedicated RPC provider instead of public endpoints:

| Provider | Free Tier | URL Format |
|---|---|---|
| **Alchemy** | 300M compute units/month | `https://eth-mainnet.g.alchemy.com/v2/{KEY}` |
| **Infura** | 100K requests/day | `https://mainnet.infura.io/v3/{KEY}` |
| **QuickNode** | Rate-limited free tier | `https://{NAME}.quiknode.pro/{KEY}` |

Set your chosen provider in the `ETH_RPC_URL` environment variable.

## Wallet Security

Your private key is stored locally in the `.env` file and **never** transmitted to the Oracle or any external service.

### Best Practices

1. **Use a dedicated mining wallet** — Do not use your primary wallet for mining
2. **Keep minimal ETH** — Only maintain enough ETH for gas fees
3. **Secure the `.env` file** — Set file permissions to `600`:
   ```bash
   chmod 600 .env
   ```
4. **Never commit `.env`** — The `.gitignore` already excludes it, but always verify
5. **Back up your key** — Store your private key backup in a secure offline location

## Updating

To update to the latest version:

```bash
cd clawing
git pull origin main
npm install
```

Check for breaking changes in the release notes before updating.

## Uninstalling

```bash
# Remove the project directory
rm -rf clawing

# (Optional) Revoke AI API key if no longer needed
```

Your $CLAW tokens remain in your Ethereum wallet regardless of whether the miner software is installed.

## Next Steps

- [CLI Reference](../reference/cli-reference.md) — Full command documentation
- [Platforms](platforms.md) — Explore alternative mining interfaces
- [Architecture](../reference/architecture.md) — Understand the technical design
- [Security](../reference/security.md) — Full security model documentation
