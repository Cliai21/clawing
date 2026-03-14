# Clawing Mainnet Deployment Checklist

## Pre-Deployment (Before Running deploy-mainnet.sh)

### Code Freeze
- [ ] All 68 Solidity tests pass: `cd contracts && forge test -vv`
- [ ] All 61 Oracle tests pass: `cd oracle && npm test`
- [ ] All 15 Miner CLI tests pass: `cd miner && npm test`
- [ ] All 10 E2E tests pass (on Anvil): `cd e2e && npm test`
- [ ] `git tag v5.3-release` created
- [ ] No uncommitted changes: `git status` is clean
- [ ] Contract code matches Sepolia-deployed version exactly

### Wallet Preparation
- [ ] **Deployer wallet** funded with ≥ 0.05 ETH (for deployment gas)
- [ ] **Oracle signing wallet** generated (dedicated key, NOT deployer)
- [ ] **Guardian wallet** is a Ledger cold wallet (NOT a hot wallet)
- [ ] **Mining wallet** funded with ≥ 0.01 ETH (for genesis mining gas)
- [ ] All private keys backed up securely (offline, NOT on any server)

### Infrastructure
- [ ] Alchemy/Infura mainnet RPC endpoint ready
- [ ] Etherscan API key available
- [ ] Oracle VPS server running (Docker + HTTPS configured)
- [ ] Domain DNS configured (e.g., oracle.minewithclaw.com → VPS IP)
- [ ] SSL/TLS certificate active (Let's Encrypt or Cloudflare)

### Environment Variables
```bash
# Deployer machine
export DEPLOYER_PRIVATE_KEY=0x...        # Deployer wallet key
export ORACLE_SIGNER_1=0x...             # Oracle signer ADDRESS (not key)
export ETH_RPC_URL=https://eth-mainnet...  # Mainnet RPC
export ETHERSCAN_API_KEY=...             # Etherscan API key
export ERA1_MODEL=grok-4.1-fast                # Era 1 AI model
```

---

## Deployment Execution

### Step 1: Gas Price Check (Target < 1 gwei)
- [ ] Check gas at https://etherscan.io/gastracker
- [ ] Wait for low gas period (typically weekends, early UTC morning)
- [ ] Current gas price: ___ gwei

### Step 2: Run Deployment Script
```bash
cd clawing/deploy
bash deploy-mainnet.sh
```
- [ ] Script pre-flight checks all pass
- [ ] Typed "DEPLOY" to confirm
- [ ] All 4 contracts deployed successfully
- [ ] Deployment log saved

### Step 3: Record Contract Addresses
Fill in after deployment:

| Contract | Address |
|----------|---------|
| OracleVerifier | `0x________________` |
| CLAW_Token | `0x________________` |
| MinterProxy | `0x________________` |
| PoAIWMint | `0x________________` |

### Step 4: Etherscan Verification
- [ ] OracleVerifier source code verified on Etherscan
- [ ] CLAW_Token source code verified on Etherscan
- [ ] MinterProxy source code verified on Etherscan
- [ ] PoAIWMint source code verified on Etherscan

If auto-verification failed, manually verify:
```bash
cd contracts
forge verify-contract <ADDRESS> src/CLAW_Token.sol:CLAW_Token \
  --etherscan-api-key $ETHERSCAN_API_KEY --chain mainnet
```

### Step 5: On-Chain Cross-Reference Verification
Use Etherscan "Read Contract" to verify:
- [ ] `CLAW_Token.minter()` == MinterProxy address
- [ ] `MinterProxy.token()` == CLAW_Token address
- [ ] `MinterProxy.activeMinter()` == PoAIWMint address
- [ ] `MinterProxy.guardian()` == Deployer (Guardian) address
- [ ] `MinterProxy.pendingMinter()` == `0x0000...0000`
- [ ] `MinterProxy.proposalTimestamp()` == `0`
- [ ] `MinterProxy.cancellationCount()` == `0`
- [ ] `PoAIWMint.minterProxy()` == MinterProxy address
- [ ] `PoAIWMint.verifier()` == OracleVerifier address
- [ ] `OracleVerifier.isOracle(ORACLE_SIGNER_1)` == `true`

---

## Oracle Server Switch to Mainnet

### Step 6: Update Oracle Configuration
```bash
# On Oracle VPS
cd clawing/oracle
cp .env.mainnet.example .env
# Edit .env with real values:
#   ORACLE_PRIVATE_KEY=0x...  (Oracle signing key)
#   RPC_URL=https://eth-mainnet...
#   POAIW_MINT_ADDRESS=0x...  (from Step 3)
#   ORACLE_VERIFIER_ADDRESS=0x... (from Step 3)
#   CHAIN_ID=1
```
- [ ] .env updated with mainnet values
- [ ] Oracle private key corresponds to registered signer address
- [ ] RPC_URL points to mainnet (Chain ID = 1)
- [ ] Contract addresses match Step 3

### Step 7: Restart Oracle Server
```bash
docker compose down
docker compose up -d
# Verify startup
docker compose logs -f --tail 20
```
- [ ] Oracle started without errors
- [ ] Signature self-check passed (logged on startup)
- [ ] Health endpoint responds: `curl https://oracle.minewithclaw.com/health`

---

## Genesis Mining

### Step 8: Configure Miner
```bash
cd clawing/miner
cp .env.mainnet.example .env
# Edit .env with real values
```
- [ ] Mining wallet key set
- [ ] AI API key set and tested
- [ ] Oracle URL points to mainnet Oracle
- [ ] RPC_URL points to mainnet
- [ ] POAIW_MINT_ADDRESS set from Step 3

### Step 9: Genesis Mine
```bash
cd clawing/deploy
bash genesis-mine.sh
```
- [ ] `updateSeed()` transaction confirmed
- [ ] First `mint()` transaction confirmed
- [ ] Miner received CLAW tokens (balance > 0)
- [ ] Transaction visible on Etherscan

---

## Go Public

### Step 10: GitHub Repository
```bash
# Make sure .env files are NOT in the repo
git status  # verify clean

# Push to GitHub
git push origin main

# On GitHub: Settings → General → Change visibility → Public
```
- [ ] All code pushed to GitHub
- [ ] Repository set to Public
- [ ] README.md has correct contract addresses
- [ ] CI pipeline green (GitHub Actions)
- [ ] LICENSE file present (MIT)

### Step 11: Update Official Website
- [ ] Contract addresses added to website
- [ ] "Mainnet Live" status displayed
- [ ] Mining guide page has correct Oracle endpoint
- [ ] Whitepaper download link works
- [ ] Redeploy website

### Step 12: Community Announcement
- [ ] Launch announcement posted (see LAUNCH_ANNOUNCEMENT.md)
- [ ] Includes: project intro, contract addresses, mining guide link
- [ ] Oracle endpoint publicly accessible

---

## Post-Launch Monitoring (3 Hours)

### Step 13: Launch Monitor
```bash
cd clawing/deploy
export ETH_RPC_URL=https://...
export POAIW_MINT_ADDRESS=0x...
export ORACLE_URL=https://oracle.minewithclaw.com
bash monitor.sh --loop
```

### Watch For:
- [ ] First 20 mint transactions — all succeed normally
- [ ] Gas consumption per mint ≈ 100k gas
- [ ] No `MinterProposed` events (security check)
- [ ] Oracle server stable (no crashes or errors)
- [ ] CLAW rewards calculated correctly (check with formula)
- [ ] Cooldown period working (3,500 blocks between mints)

### Emergency Procedures
If something goes wrong, refer to: `docs/OPS_RUNBOOK.md`

| Emergency | Action |
|-----------|--------|
| Oracle key compromised | Guardian → `proposeMinter()` to new contract |
| Oracle server down | `systemctl restart openclaw-oracle` or redeploy Docker |
| Abnormal minting | Check Oracle logs, verify signatures |
| Guardian key compromised | Use `cancelMinterChange()` (max 3x), community alert |
| Gas price spike | Miners auto-wait (MAX_GAS_PRICE_GWEI setting) |

---

## Final Status

- [ ] **All 4 contracts live on Ethereum mainnet**
- [ ] **Etherscan verified and source code public**
- [ ] **Oracle server running and healthy**
- [ ] **Genesis mining successful**
- [ ] **GitHub repository public**
- [ ] **Official website updated**
- [ ] **Community announcement posted**
- [ ] **3-hour monitoring completed, no issues**

**Deployment timestamp:** _______________  
**Block number at deployment:** _______________  
**Deployer (Guardian) address:** _______________
