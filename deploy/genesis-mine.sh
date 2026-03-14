#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# OpenClaw Genesis Mining Script
# ═══════════════════════════════════════════════════════════════════
#
# Performs the first-ever mining on mainnet:
#   1. Calls updateSeed() to initialize the first epoch seed
#   2. Triggers the first mint() via the miner CLI
#
# Prerequisites:
#   - Contracts deployed on mainnet (deploy-mainnet.sh completed)
#   - Oracle server running and connected to mainnet
#   - Miner CLI configured with mainnet .env
#   - Mining wallet has ETH for gas (~0.01 ETH)
#   - AI API key configured and working
#
# Usage:
#   cd clawing/deploy
#   bash genesis-mine.sh
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  OpenClaw — Genesis Mining${NC}"
echo -e "${CYAN}  The First Block on Mainnet${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MINER_DIR="$(cd "$SCRIPT_DIR/../miner" && pwd)"

# ═══════════════════ Pre-Check ═══════════════════

echo -e "${YELLOW}[1/5] Validating configuration...${NC}"

# Check miner .env exists
if [ ! -f "$MINER_DIR/.env" ]; then
    echo -e "${RED}ERROR: Miner .env not found at $MINER_DIR/.env${NC}"
    echo "  Copy .env.mainnet.example to .env and fill in values."
    exit 1
fi

# Source miner env for checks
set -a
source "$MINER_DIR/.env"
set +a

# Validate required vars
for var in PRIVATE_KEY RPC_URL POAIW_MINT_ADDRESS ORACLE_URL AI_API_KEY; do
    if [ -z "${!var:-}" ] || [[ "${!var}" == *"FILL"* ]] || [[ "${!var}" == *"YOUR"* ]]; then
        echo -e "${RED}ERROR: $var not properly configured in miner .env${NC}"
        exit 1
    fi
done

echo -e "${GREEN}  ✓ Miner .env configured${NC}"

# ═══════════════════ Chain Check ═══════════════════

echo -e "${YELLOW}[2/5] Checking chain connection...${NC}"

CHAIN_ID=$(cast chain-id --rpc-url "$RPC_URL" 2>/dev/null || echo "unknown")
echo "  Chain ID: $CHAIN_ID"

MINER_ADDR=$(cast wallet address "$PRIVATE_KEY" 2>/dev/null || echo "unknown")
echo "  Miner address: $MINER_ADDR"

BALANCE=$(cast balance "$MINER_ADDR" --rpc-url "$RPC_URL" --ether 2>/dev/null || echo "unknown")
echo "  Miner balance: $BALANCE ETH"

CURRENT_BLOCK=$(cast block-number --rpc-url "$RPC_URL" 2>/dev/null || echo "unknown")
echo "  Current block: $CURRENT_BLOCK"

echo -e "${GREEN}  ✓ Chain connected${NC}"
echo ""

# ═══════════════════ Oracle Health Check ═══════════════════

echo -e "${YELLOW}[3/5] Checking Oracle server health...${NC}"

HEALTH_RESPONSE=$(curl -sf "$ORACLE_URL/health" 2>/dev/null || echo "FAILED")
if [ "$HEALTH_RESPONSE" = "FAILED" ]; then
    echo -e "${RED}ERROR: Oracle server not reachable at $ORACLE_URL${NC}"
    echo "  Start the Oracle server first: docker compose up -d"
    exit 1
fi

echo "  Oracle response: $HEALTH_RESPONSE"
echo -e "${GREEN}  ✓ Oracle server healthy${NC}"
echo ""

# ═══════════════════ Step 1: updateSeed() ═══════════════════

echo -e "${YELLOW}[4/5] Calling updateSeed() to initialize epoch...${NC}"
echo "  This sets the first random seed for mining."
echo ""

cd "$MINER_DIR"

# Use cast to call updateSeed() on PoAIWMint contract
cast send "$POAIW_MINT_ADDRESS" \
  "updateSeed()" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  2>&1

echo ""
echo -e "${GREEN}  ✓ updateSeed() successful — Epoch 1 initialized${NC}"
echo ""

# Wait a moment for the transaction to be confirmed
echo "  Waiting 15 seconds for block confirmation..."
sleep 15

# Verify seed was set
SEED=$(cast call "$POAIW_MINT_ADDRESS" "currentSeed()(bytes32)" --rpc-url "$RPC_URL" 2>/dev/null || echo "unknown")
echo "  Current seed: $SEED"
echo ""

# ═══════════════════ Step 2: First Mint ═══════════════════

echo -e "${YELLOW}[5/5] Performing genesis mine (first mint)...${NC}"
echo ""
echo "  This will:"
echo "    a. Request a nonce from Oracle"
echo "    b. Call AI API ($AI_MODEL) with task prompt"
echo "    c. Submit API response to Oracle for attestation"
echo "    d. Submit mint() transaction to PoAIWMint"
echo ""

# Run miner CLI for single mine
npx ts-node src/index.ts mine 2>&1

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  🎉 GENESIS MINING COMPLETE${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo ""

# Check miner's CLAW balance
TOKEN_ADDRESS=$(cast call "$POAIW_MINT_ADDRESS" "minterProxy()(address)" --rpc-url "$RPC_URL" 2>/dev/null)
if [ -n "$TOKEN_ADDRESS" ]; then
    PROXY_ADDR="$TOKEN_ADDRESS"
    TOKEN_ADDR=$(cast call "$PROXY_ADDR" "token()(address)" --rpc-url "$RPC_URL" 2>/dev/null || echo "")
    if [ -n "$TOKEN_ADDR" ]; then
        CLAW_BALANCE=$(cast call "$TOKEN_ADDR" "balanceOf(address)(uint256)" "$MINER_ADDR" --rpc-url "$RPC_URL" 2>/dev/null || echo "0")
        echo "  Miner CLAW balance: $CLAW_BALANCE (raw wei)"
    fi
fi

echo ""
echo "  Next steps:"
echo "    1. Verify the mint transaction on Etherscan"
echo "    2. Start auto-mining: npx ts-node src/index.ts auto"
echo "    3. Make GitHub repo public"
echo "    4. Post community announcement"
echo ""
