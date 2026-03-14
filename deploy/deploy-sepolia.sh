#!/bin/bash
# OpenClaw Sepolia Deployment Script
#
# Prerequisites:
#   1. DEPLOYER_PRIVATE_KEY set in env (needs Sepolia ETH)
#   2. ORACLE_SIGNER_1 set in env (Oracle signer address)
#   3. SEPOLIA_RPC_URL set in env (e.g., Alchemy/Infura)
#   4. ETHERSCAN_API_KEY set in env (for verification)
#   5. Foundry installed (forge)

set -euo pipefail

# ═══════════════════ Validate Environment ═══════════════════

echo "=== OpenClaw Sepolia Deployment ==="
echo ""

required_vars=(DEPLOYER_PRIVATE_KEY ORACLE_SIGNER_1 SEPOLIA_RPC_URL ETHERSCAN_API_KEY)
for var in "${required_vars[@]}"; do
    if [ -z "${!var:-}" ]; then
        echo "ERROR: Missing required environment variable: $var"
        exit 1
    fi
done

echo "Oracle Signer 1: $ORACLE_SIGNER_1"
[ -n "${ORACLE_SIGNER_2:-}" ] && echo "Oracle Signer 2: $ORACLE_SIGNER_2"
echo "RPC URL: $SEPOLIA_RPC_URL"
echo ""

# ═══════════════════ Deploy Contracts ═══════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/../contracts" && pwd)"

echo "Deploying contracts from: $CONTRACTS_DIR"
echo ""

cd "$CONTRACTS_DIR"

forge script script/Deploy.s.sol:DeployOpenClaw \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --verify \
  --slow \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  -vvvv

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Contract addresses are in: $CONTRACTS_DIR/broadcast/Deploy.s.sol/11155111/"
echo ""
echo "Next steps:"
echo "  1. Copy the contract addresses from broadcast artifacts"
echo "  2. Configure Oracle server .env with POAIW_MINT_ADDRESS and ORACLE_VERIFIER_ADDRESS"
echo "  3. Start Oracle server: cd ../oracle && docker compose up -d"
echo "  4. Configure Miner CLI .env and start mining"
