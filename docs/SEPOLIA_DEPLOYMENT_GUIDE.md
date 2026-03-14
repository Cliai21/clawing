# Clawing Sepolia Testnet Deployment Guide

## Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [Environment Setup](#2-environment-setup)
3. [Contract Deployment](#3-contract-deployment)
4. [Etherscan Verification](#4-etherscan-verification)
5. [Oracle Server Deployment](#5-oracle-server-deployment)
6. [SSL/HTTPS Configuration](#6-sslhttps-configuration)
7. [Miner CLI Configuration](#7-miner-cli-configuration)
8. [End-to-End Testing](#8-end-to-end-testing)
9. [Troubleshooting / FAQ](#9-troubleshooting--faq)

---

## 1. Prerequisites

### 1.1 Obtain Sepolia ETH
- Visit [Google Cloud Sepolia Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) or [Alchemy Sepolia Faucet](https://sepoliafaucet.com/)
- You can claim 0.5 ETH each time; deploying the contracts requires approximately 0.05 ETH

### 1.2 Obtain RPC URL
- Register an [Alchemy](https://www.alchemy.com/) account
- Create an application on the Sepolia network
- Copy the HTTPS RPC URL (format: `https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY`)

### 1.3 Obtain Etherscan API Key
- Register an [Etherscan](https://etherscan.io/) account
- Go to the API Keys page and create a new API Key

### 1.4 Install Foundry
```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### 1.5 Prepare Wallets
You need 2 separate private keys:
- **Deployer wallet**: For deploying contracts (requires Sepolia ETH)
- **Oracle wallet**: For Oracle server signing (does not require ETH)

You can use `cast wallet new` to generate a new wallet:
```bash
cast wallet new
```

---

## 2. Environment Setup

### 2.1 Create Environment Variable File

Create `.env.sepolia` in the project root directory:

```bash
# Deployer (requires Sepolia ETH)
DEPLOYER_PRIVATE_KEY=0xYourDeployerPrivateKey

# Oracle signer (at least 1, up to 5)
ORACLE_SIGNER_1=0xYourOracleSignerAddress

# Sepolia RPC
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# Etherscan verification
ETHERSCAN_API_KEY=YourEtherscanAPIKey

# Model ID (AI model used for Era 1)
ERA1_MODEL=grok-4.1-fast
```

### 2.2 Load Environment Variables
```bash
source .env.sepolia
```

---

## 3. Contract Deployment

### 3.1 Using the Deployment Script

```bash
cd deploy/
./deploy-sepolia.sh
```

### 3.2 Manual Deployment (if the script has issues)

```bash
cd contracts/

forge script script/Deploy.s.sol:DeployClawing \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --verify \
  --slow \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  -vvvv
```

### 3.3 Obtain Contract Addresses

After deployment, the contract addresses will be in the output logs:
```
CLAW_Token:       0x...
OracleVerifier:   0x...
MinterProxy:      0x...
PoAIWMint:        0x...
```

They can also be found in the JSON files under the `contracts/broadcast/Deploy.s.sol/11155111/` directory.

---

## 4. Etherscan Verification

If the `--verify` flag was used during deployment, the contracts will be verified automatically.

### 4.1 Manual Verification (if automatic verification fails)

```bash
# Verify OracleVerifier
forge verify-contract \
  --chain sepolia \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  ORACLE_VERIFIER_ADDRESS \
  src/OracleVerifier.sol:OracleVerifier \
  --constructor-args $(cast abi-encode "constructor(address[])" "[$ORACLE_SIGNER_1]")
```

### 4.2 Confirm Verification Status

Search for the contract address on [Sepolia Etherscan](https://sepolia.etherscan.io/) and confirm that the code tab displays a green checkmark.

---

## 5. Oracle Server Deployment

### 5.1 Prepare VPS

Recommended configuration:
- 1 vCPU, 1GB RAM (minimum)
- Ubuntu 22.04 LTS
- Install Docker and Docker Compose

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Docker Compose (v2)
sudo apt-get install docker-compose-plugin
```

### 5.2 Configure Oracle Environment Variables

Create `oracle/.env` on the VPS:

```bash
ORACLE_PRIVATE_KEY=0xYourOraclePrivateKey
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY
POAIW_MINT_ADDRESS=0xPoAIWMintAddressFilledInAfterDeployment
ORACLE_VERIFIER_ADDRESS=0xOracleVerifierAddressFilledInAfterDeployment
PORT=3000
CHAIN_ID=11155111
NONCE_TTL_SECONDS=300
RATE_LIMIT_WINDOW_SECONDS=41000
RATE_LIMIT_MAX_PER_WINDOW=1
DEADLINE_BLOCKS_AHEAD=200
SIGNATURE_VALIDITY_BLOCKS=300
```

### 5.3 Start Oracle

```bash
cd oracle/

# Build and start
docker compose up -d

# View logs
docker compose logs -f

# Check health status
curl http://localhost:3000/health | jq
```

### 5.4 Verify Oracle Is Running Properly

```bash
# Should return status: "ok"
curl -s http://localhost:3000/health | jq '.status'

# Check if the Oracle signer is registered
curl -s http://localhost:3000/health | jq '.oracle_address'
```

---

## 6. SSL/HTTPS Configuration

### 6.1 Install Nginx

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

### 6.2 Configure Nginx

```bash
# Copy configuration file
sudo cp deploy/nginx-oracle.conf /etc/nginx/sites-available/oracle
sudo ln -s /etc/nginx/sites-available/oracle /etc/nginx/sites-enabled/

# Change server_name to your domain
sudo nano /etc/nginx/sites-available/oracle

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### 6.3 Install SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d oracle.yourdomain.com

# Auto-renewal (certbot will automatically add a cron job)
sudo certbot renew --dry-run
```

### 6.4 Verify HTTPS

```bash
curl https://oracle.yourdomain.com/health
```

---

## 7. Miner CLI Configuration

### 7.1 Create Miner Environment Variables

```bash
cd miner/
cp .env.example .env
```

Edit `.env`:

```bash
PRIVATE_KEY=0xYourMinerPrivateKey
AI_API_KEY=sk-YourOpenAIAPIKey
AI_API_URL=https://api.x.ai/v1/chat/completions
AI_MODEL=grok-4.1-fast
ORACLE_URL=https://oracle.yourdomain.com
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY
POAIW_MINT_ADDRESS=0xPoAIWMintAddressFilledInAfterDeployment
MAX_GAS_PRICE_GWEI=50
TASK_PROMPT=Explain the latest advances in quantum computing
```

### 7.2 Check Status

```bash
npx tsx src/index.ts status
```

### 7.3 Single Mining Run

```bash
npx tsx src/index.ts mine
```

### 7.4 Auto Mining

```bash
npx tsx src/index.ts auto
```

Press `Ctrl+C` to gracefully exit.

---

## 8. End-to-End Testing

### 8.1 Checklist

1. **Contracts deployed**: 4 contracts are visible on Sepolia Etherscan
2. **Contracts verified**: Code tab displays a green checkmark
3. **Oracle running**: `/health` returns `status: "ok"`
4. **Oracle signer registered**: OracleVerifier contract's `isOracleSigner` returns true
5. **Miner has ETH**: Miner address has Sepolia ETH for paying gas

### 8.2 First Mining Run

```bash
# 1. First call updateSeed() (if seedEpoch is not the current epoch)
npx tsx src/index.ts status

# 2. Execute a single mining run
npx tsx src/index.ts mine

# 3. Check balance
npx tsx src/index.ts status
```

### 8.3 View Transactions on Etherscan

- Search for the miner address and view `mint()` transactions
- Search for the CLAW_Token contract and view Transfer events
- Search for the PoAIWMint contract and view Mined events

---

## 9. Troubleshooting / FAQ

### 9.1 Contract Deployment Failure

**Problem**: `forge script` reports a nonce mismatch error

**Solution**:
- Make sure the deployer wallet has no other pending transactions
- Use the `--slow` flag to ensure transactions are serialized
- Check that the Sepolia ETH balance is sufficient

### 9.2 Oracle Startup Failure

**Problem**: Oracle reports `Missing required environment variable`

**Solution**: Check that all required environment variables in the `.env` file are set correctly

**Problem**: Oracle reports `Oracle signer check: NOT REGISTERED`

**Solution**: Confirm that the address corresponding to `ORACLE_PRIVATE_KEY` in `.env` matches the `ORACLE_SIGNER_1` provided during deployment

### 9.3 Mining Failure

**Problem**: `SEED_NOT_UPDATED` error

**Solution**: Call `updateSeed()` first; this can be handled automatically via the Miner CLI's `mine` command

**Problem**: `COOLDOWN_ACTIVE` error

**Solution**: Wait for 3,500 blocks (on Sepolia, approximately 12 seconds/block = 11.67 hours)

**Problem**: `INVALID_MODEL` error

**Solution**: Confirm that the model name returned by the AI API exactly matches the `ERA1_MODEL` set during deployment

**Problem**: Gas estimation failure

**Solution**:
- Check that the miner address has enough Sepolia ETH
- Check that `MAX_GAS_PRICE_GWEI` is not set too low

### 9.4 Docker Related

**Problem**: Docker build failure

**Solution**:
```bash
# Clean cache and rebuild
docker compose build --no-cache
docker compose up -d
```

**Problem**: Oracle container keeps restarting

**Solution**:
```bash
# View logs
docker compose logs oracle --tail 50

# Common causes: missing environment variables, RPC URL unreachable
```

### 9.5 Network Issues

**Problem**: Alchemy RPC request rate limiting

**Solution**:
- The free plan allows a maximum of 5 requests per second
- Upgrade the Alchemy plan or use multiple RPC nodes
- The Oracle has a built-in 30-second cache; normal usage should not trigger rate limiting
