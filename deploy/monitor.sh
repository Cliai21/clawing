#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# OpenClaw Post-Launch Monitoring Script
# ═══════════════════════════════════════════════════════════════════
#
# Monitors the OpenClaw contracts and Oracle server after launch.
# Run this during the 3-hour post-launch monitoring window.
#
# Checks:
#   - Oracle server health (HTTP health endpoint)
#   - Recent mint events on-chain
#   - MinterProposed events (security: detect unauthorized changes)
#   - Gas price trends
#   - Contract state (total minted, epoch, era)
#
# Usage:
#   export ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
#   export POAIW_MINT_ADDRESS=0x...
#   export ORACLE_URL=https://oracle.minewithclaw.com
#   bash monitor.sh [--loop]
#
#   --loop: Continuously monitor every 60 seconds
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ═══════════════════ Config ═══════════════════

RPC_URL="${ETH_RPC_URL:-}"
POAIW="${POAIW_MINT_ADDRESS:-}"
ORACLE="${ORACLE_URL:-https://oracle.minewithclaw.com}"
LOOP_MODE="${1:-}"
INTERVAL=60  # seconds between checks in loop mode

if [ -z "$RPC_URL" ] || [ -z "$POAIW" ]; then
    echo -e "${RED}ERROR: Set ETH_RPC_URL and POAIW_MINT_ADDRESS${NC}"
    exit 1
fi

# ═══════════════════ Monitor Function ═══════════════════

run_check() {
    local timestamp
    timestamp=$(date "+%Y-%m-%d %H:%M:%S")
    
    echo ""
    echo -e "${CYAN}═══ OpenClaw Monitor — $timestamp ═══${NC}"
    echo ""
    
    # --- 1. Oracle Health ---
    echo -e "${YELLOW}[Oracle Health]${NC}"
    HEALTH=$(curl -sf --max-time 5 "$ORACLE/health" 2>/dev/null || echo "UNREACHABLE")
    if [ "$HEALTH" = "UNREACHABLE" ]; then
        echo -e "  ${RED}⚠ Oracle server UNREACHABLE at $ORACLE${NC}"
    else
        echo -e "  ${GREEN}✓ Oracle server healthy${NC}"
    fi
    
    # Check /metrics if available
    METRICS=$(curl -sf --max-time 5 "$ORACLE/metrics" 2>/dev/null || echo "")
    if [ -n "$METRICS" ]; then
        echo "  Metrics: $METRICS" | head -5
    fi
    echo ""
    
    # --- 2. Chain State ---
    echo -e "${YELLOW}[Chain State]${NC}"
    
    BLOCK=$(cast block-number --rpc-url "$RPC_URL" 2>/dev/null || echo "ERROR")
    echo "  Current block: $BLOCK"
    
    GAS_WEI=$(cast gas-price --rpc-url "$RPC_URL" 2>/dev/null || echo "0")
    GAS_GWEI=$(echo "scale=2; $GAS_WEI / 1000000000" | bc 2>/dev/null || echo "?")
    echo "  Gas price: ${GAS_GWEI} gwei"
    echo ""
    
    # --- 3. Contract State ---
    echo -e "${YELLOW}[Contract State]${NC}"
    
    # Total minted
    TOTAL_MINTED=$(cast call "$POAIW" "totalMinted()(uint256)" --rpc-url "$RPC_URL" 2>/dev/null || echo "ERROR")
    echo "  Total minted (wei): $TOTAL_MINTED"
    
    # Start block
    START_BLOCK=$(cast call "$POAIW" "startBlock()(uint256)" --rpc-url "$RPC_URL" 2>/dev/null || echo "ERROR")
    echo "  Start block: $START_BLOCK"
    
    # Current seed
    SEED=$(cast call "$POAIW" "currentSeed()(bytes32)" --rpc-url "$RPC_URL" 2>/dev/null || echo "ERROR")
    echo "  Current seed: ${SEED:0:18}..."
    
    # Seed epoch
    SEED_EPOCH=$(cast call "$POAIW" "seedEpoch()(uint256)" --rpc-url "$RPC_URL" 2>/dev/null || echo "ERROR")
    echo "  Seed epoch: $SEED_EPOCH"
    echo ""
    
    # --- 4. MinterProxy Security Check ---
    echo -e "${YELLOW}[Security — MinterProxy]${NC}"
    
    PROXY_ADDR=$(cast call "$POAIW" "minterProxy()(address)" --rpc-url "$RPC_URL" 2>/dev/null || echo "ERROR")
    
    if [ "$PROXY_ADDR" != "ERROR" ]; then
        PENDING=$(cast call "$PROXY_ADDR" "pendingMinter()(address)" --rpc-url "$RPC_URL" 2>/dev/null || echo "ERROR")
        CANCEL_COUNT=$(cast call "$PROXY_ADDR" "cancellationCount()(uint256)" --rpc-url "$RPC_URL" 2>/dev/null || echo "ERROR")
        
        if [ "$PENDING" = "0x0000000000000000000000000000000000000000" ]; then
            echo -e "  ${GREEN}✓ No pending minter proposal${NC}"
        else
            echo -e "  ${RED}⚠ ALERT: Pending minter proposal detected!${NC}"
            echo -e "  ${RED}  Pending address: $PENDING${NC}"
            echo -e "  ${RED}  ACTION: Check if this is authorized. If not, cancel immediately.${NC}"
        fi
        echo "  Cancellation count: $CANCEL_COUNT / 3"
    fi
    echo ""
    
    # --- 5. Recent Mint Events ---
    echo -e "${YELLOW}[Recent Mint Events (last 100 blocks)]${NC}"
    
    FROM_BLOCK=$((BLOCK - 100))
    if [ "$FROM_BLOCK" -lt 0 ]; then FROM_BLOCK=0; fi
    
    # Minted event signature: Minted(address,uint256,uint256,uint256)
    MINT_EVENTS=$(cast logs \
        --rpc-url "$RPC_URL" \
        --from-block "$FROM_BLOCK" \
        --to-block latest \
        --address "$POAIW" \
        "Minted(address,uint256,uint256,uint256)" \
        2>/dev/null | grep -c "blockNumber" || echo "0")
    
    echo "  Mint events in last 100 blocks: $MINT_EVENTS"
    
    # MinterProposed event (security alert)
    PROPOSE_EVENTS=$(cast logs \
        --rpc-url "$RPC_URL" \
        --from-block "$FROM_BLOCK" \
        --to-block latest \
        --address "$PROXY_ADDR" \
        "MinterProposed(address,uint256)" \
        2>/dev/null | grep -c "blockNumber" || echo "0")
    
    if [ "$PROPOSE_EVENTS" != "0" ]; then
        echo -e "  ${RED}⚠ MinterProposed events detected: $PROPOSE_EVENTS${NC}"
    else
        echo -e "  ${GREEN}✓ No MinterProposed events${NC}"
    fi
    
    echo ""
    echo -e "${CYAN}═══ Check complete ═══${NC}"
}

# ═══════════════════ Main ═══════════════════

if [ "$LOOP_MODE" = "--loop" ]; then
    echo -e "${CYAN}Starting continuous monitoring (Ctrl+C to stop)...${NC}"
    while true; do
        run_check
        echo ""
        echo "  Next check in $INTERVAL seconds..."
        sleep $INTERVAL
    done
else
    run_check
fi
