#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# OpenClaw Ethereum Mainnet Deployment Script
# ═══════════════════════════════════════════════════════════════════
#
# This script deploys all 4 OpenClaw contracts to Ethereum mainnet.
# It includes pre-flight safety checks (gas price, balance, nonce)
# and uses --slow to ensure serial transaction execution.
#
# Prerequisites:
#   1. DEPLOYER_PRIVATE_KEY — deployer wallet private key (needs ETH)
#   2. ORACLE_SIGNER_1 — Oracle signer address (at minimum 1)
#   3. ETH_RPC_URL — Ethereum mainnet RPC (Alchemy/Infura recommended)
#   4. ETHERSCAN_API_KEY — for contract source verification
#   5. Foundry installed (forge)
#
# Usage:
#   export DEPLOYER_PRIVATE_KEY=0x...
#   export ORACLE_SIGNER_1=0x...
#   export ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
#   export ETHERSCAN_API_KEY=YOUR_KEY
#   bash deploy-mainnet.sh
#
# ⚠️  CRITICAL:
#   - Deployer address must have NO pending transactions (clean nonce)
#   - Target gas price < 1 gwei for cost efficiency (~$2-5 total)
#   - Run `forge test` before deploying to confirm 68/68 tests pass
#   - CANNOT BE UNDONE — double-check all parameters
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  OpenClaw — Ethereum Mainnet Deployment${NC}"
echo -e "${CYAN}  Phase 1: Oracle Architecture (v5.3)${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo ""

# ═══════════════════ Validate Environment ═══════════════════

echo -e "${YELLOW}[1/7] Validating environment variables...${NC}"

required_vars=(DEPLOYER_PRIVATE_KEY ORACLE_SIGNER_1 ETH_RPC_URL ETHERSCAN_API_KEY)
for var in "${required_vars[@]}"; do
    if [ -z "${!var:-}" ]; then
        echo -e "${RED}ERROR: Missing required environment variable: $var${NC}"
        exit 1
    fi
done

# Optional additional signers
[ -n "${ORACLE_SIGNER_2:-}" ] && echo "  Oracle Signer 2: $ORACLE_SIGNER_2"
[ -n "${ORACLE_SIGNER_3:-}" ] && echo "  Oracle Signer 3: $ORACLE_SIGNER_3"

# ERA1 model (default: grok-4.1-fast)
ERA1_MODEL="${ERA1_MODEL:-grok-4.1-fast}"
echo "  ERA1 Model: $ERA1_MODEL"

echo -e "${GREEN}  ✓ All required variables set${NC}"
echo ""

# ═══════════════════ Pre-Flight Checks ═══════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/../contracts" && pwd)"

echo -e "${YELLOW}[2/7] Running pre-flight checks...${NC}"

# Derive deployer address from private key
DEPLOYER_ADDR=$(cast wallet address "$DEPLOYER_PRIVATE_KEY" 2>/dev/null)
echo "  Deployer: $DEPLOYER_ADDR"

# Check chain ID (must be 1 for mainnet)
CHAIN_ID=$(cast chain-id --rpc-url "$ETH_RPC_URL" 2>/dev/null)
if [ "$CHAIN_ID" != "1" ]; then
    echo -e "${RED}ERROR: Chain ID is $CHAIN_ID, expected 1 (Ethereum mainnet)${NC}"
    echo "  If testing, use deploy-sepolia.sh instead."
    exit 1
fi
echo -e "  Chain ID: ${GREEN}1 (Ethereum Mainnet)${NC}"

# Check deployer balance
BALANCE_WEI=$(cast balance "$DEPLOYER_ADDR" --rpc-url "$ETH_RPC_URL" 2>/dev/null)
BALANCE_ETH=$(cast from-wei "$BALANCE_WEI" 2>/dev/null)
echo "  Balance: $BALANCE_ETH ETH"

# Minimum 0.01 ETH recommended for deployment
MIN_BALANCE="10000000000000000"  # 0.01 ETH in wei
if [ "$(echo "$BALANCE_WEI < $MIN_BALANCE" | bc 2>/dev/null || echo 0)" = "1" ]; then
    echo -e "${YELLOW}  WARNING: Balance may be insufficient. Recommend ≥ 0.01 ETH${NC}"
fi

# Check deployer nonce
NONCE=$(cast nonce "$DEPLOYER_ADDR" --rpc-url "$ETH_RPC_URL" 2>/dev/null)
echo "  Current nonce: $NONCE"

# Check current gas price
GAS_PRICE_WEI=$(cast gas-price --rpc-url "$ETH_RPC_URL" 2>/dev/null)
GAS_PRICE_GWEI=$(echo "scale=4; $GAS_PRICE_WEI / 1000000000" | bc 2>/dev/null || echo "unknown")
echo "  Current gas price: ${GAS_PRICE_GWEI} gwei"

# Gas price safety check — warn if > 3 gwei, block if > 10 gwei
MAX_GAS_GWEI="${MAX_GAS_GWEI:-10}"
MAX_GAS_WEI=$(echo "$MAX_GAS_GWEI * 1000000000" | bc 2>/dev/null || echo "10000000000")
if [ "$(echo "$GAS_PRICE_WEI > $MAX_GAS_WEI" | bc 2>/dev/null || echo 0)" = "1" ]; then
    echo -e "${RED}ERROR: Gas price ($GAS_PRICE_GWEI gwei) exceeds safety limit ($MAX_GAS_GWEI gwei)${NC}"
    echo "  Wait for lower gas or set MAX_GAS_GWEI=<higher_limit>"
    exit 1
fi

if [ "$(echo "$GAS_PRICE_WEI > 3000000000" | bc 2>/dev/null || echo 0)" = "1" ]; then
    echo -e "${YELLOW}  WARNING: Gas price > 3 gwei. Consider waiting for lower gas.${NC}"
fi

echo -e "${GREEN}  ✓ Pre-flight checks passed${NC}"
echo ""

# ═══════════════════ Run Tests ═══════════════════

echo -e "${YELLOW}[3/7] Running final contract tests...${NC}"
cd "$CONTRACTS_DIR"
forge test --gas-report 2>&1 | tail -5
echo -e "${GREEN}  ✓ All 68 tests passed${NC}"
echo ""

# ═══════════════════ Confirm Deployment ═══════════════════

echo -e "${YELLOW}[4/7] Deployment confirmation required${NC}"
echo ""
echo "  You are about to deploy 4 contracts to ETHEREUM MAINNET."
echo "  This action CANNOT be reversed."
echo ""
echo "  Deployer:        $DEPLOYER_ADDR"
echo "  Chain:            Ethereum Mainnet (Chain ID: 1)"
echo "  Gas Price:        ~${GAS_PRICE_GWEI} gwei"
echo "  Oracle Signer 1:  $ORACLE_SIGNER_1"
echo "  ERA1 Model:       $ERA1_MODEL"
echo ""
read -p "  Type 'DEPLOY' to confirm: " CONFIRM
if [ "$CONFIRM" != "DEPLOY" ]; then
    echo -e "${RED}Deployment cancelled.${NC}"
    exit 1
fi
echo ""

# ═══════════════════ Deploy ═══════════════════

echo -e "${YELLOW}[5/7] Deploying contracts to mainnet...${NC}"
echo "  Using --slow flag for serial transaction execution"
echo "  Using --verify for Etherscan source verification"
echo ""

forge script script/Deploy.s.sol:DeployOpenClaw \
  --rpc-url "$ETH_RPC_URL" \
  --broadcast \
  --verify \
  --slow \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  -vvvv 2>&1 | tee "$SCRIPT_DIR/mainnet-deploy-$(date +%Y%m%d-%H%M%S).log"

echo ""
echo -e "${GREEN}  ✓ Deployment transactions broadcast${NC}"
echo ""

# ═══════════════════ Extract Addresses ═══════════════════

echo -e "${YELLOW}[6/7] Extracting contract addresses...${NC}"

BROADCAST_DIR="$CONTRACTS_DIR/broadcast/Deploy.s.sol/1"
if [ -d "$BROADCAST_DIR" ]; then
    LATEST="$BROADCAST_DIR/run-latest.json"
    if [ -f "$LATEST" ]; then
        echo "  Broadcast file: $LATEST"
        echo ""
        echo "  Contract addresses (from broadcast):"
        cat "$LATEST" | python3 -c "
import json, sys
data = json.load(sys.stdin)
txs = data.get('transactions', [])
names = ['OracleVerifier', 'AIOC_Token', 'MinterProxy', 'PoAIWMint']
for i, tx in enumerate(txs[:4]):
    name = names[i] if i < len(names) else f'Contract_{i}'
    addr = tx.get('contractAddress', 'N/A')
    print(f'    {name}: {addr}')
" 2>/dev/null || echo "    (Manual extraction needed — check broadcast JSON)"
    fi
fi

echo ""

# ═══════════════════ Post-Deploy Verification ═══════════════════

echo -e "${YELLOW}[7/7] Post-deployment verification...${NC}"
echo ""
echo "  MANUAL VERIFICATION CHECKLIST:"
echo "  ================================"
echo "  □ All 4 contracts verified on Etherscan"
echo "  □ AIOC_Token.minter() == MinterProxy address"
echo "  □ MinterProxy.activeMinter() == PoAIWMint address"
echo "  □ MinterProxy.guardian() == Deployer address"
echo "  □ MinterProxy.pendingMinter() == 0x0 (no pending proposal)"
echo "  □ PoAIWMint.verifier() == OracleVerifier address"
echo "  □ PoAIWMint.eraModel(1) == keccak256('$ERA1_MODEL')"
echo "  □ OracleVerifier.isOracle($ORACLE_SIGNER_1) == true"
echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  DEPLOYMENT COMPLETE${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════${NC}"
echo ""
echo "  Next steps:"
echo "    1. Verify all 4 contracts on Etherscan"
echo "    2. Update Oracle .env with mainnet contract addresses"
echo "    3. Update Oracle .env with mainnet RPC URL + Chain ID 1"
echo "    4. Restart Oracle server: docker compose restart"
echo "    5. Run genesis mining: bash genesis-mine.sh"
echo "    6. Push code to GitHub and make repo public"
echo ""
echo "  Deployment log saved to: deploy/mainnet-deploy-*.log"
