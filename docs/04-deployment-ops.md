# Deployment and Operations Manual

> Complete deployment path from testnet to mainnet, including prerequisites, deployment steps, and verification checklist.

---

## 1. Prerequisites

### 1.1 Compile SP1 Guest Program

```bash
# Install SP1 toolchain
curl -L https://sp1up.dev | bash
sp1up

# Compile Guest Program -> Generate ELF + programVKey
cd sp1-circuit
cargo prove build

# Output:
#   target/elf-compilation/.../openclaw-circuit   <- Guest ELF
#   program vkey: 0xabc123...                      <- programVKey (must be recorded)
```

**Record programVKey** — This is a required parameter for deploying ClawingVerifier.

### 1.2 Confirm SP1VerifierGateway Address

| Network | SP1VerifierGateway Address | Status |
|---------|---------------------------|--------|
| Ethereum Mainnet | Refer to [Succinct documentation](https://docs.succinct.xyz/docs/onchain-verification/contract-addresses) | Confirm before deployment |
| Sepolia | Refer to the above | Confirm before deployment |
| Holesky | Refer to the above | Confirm before deployment |

### 1.3 Environment Setup

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies
cd contracts
forge install succinctlabs/sp1-contracts
forge install foundry-rs/forge-std

# Create .env
cat > .env << 'EOF'
DEPLOYER_PRIVATE_KEY=0x...
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
HOLESKY_RPC_URL=https://ethereum-holesky-rpc.publicnode.com
ETHERSCAN_API_KEY=YOUR_KEY
EOF
```

## 2. Testnet Deployment Process (Sepolia / Holesky)

### 2.1 Run Tests

```bash
cd contracts

# Unit tests
forge test -vvv

# With gas report
forge test --gas-report

# Fork tests (connect to real SP1VerifierGateway)
forge test --fork-url $SEPOLIA_RPC_URL -vvv
```

### 2.2 Deploy to Sepolia

```bash
# 1. Update constants in Deploy.s.sol:
#    SP1_VERIFIER_GATEWAY = Real address on Sepolia
#    PROGRAM_VKEY = vkey obtained after compiling Guest Program

# 2. Deploy
forge script script/Deploy.s.sol:DeployClawing \
    --rpc-url $SEPOLIA_RPC_URL \
    --broadcast \
    --verify \
    -vvvv

# 3. Record the output contract addresses
```

### 2.3 Testnet Verification Checklist

| Check Item | Command/Method | Expected Result |
|------------|----------------|-----------------|
| Token minter is correct | `cast call $TOKEN "minter()"` | PoAIWMint address |
| PoAIWMint.token is correct | `cast call $MINT "token()"` | CLAW_Token address |
| Era 1 model is correct | `cast call $MINT "eraModel(uint256)" 1` | keccak256("grok-4.1-fast") |
| startBlock is reasonable | `cast call $MINT "startBlock()"` | Block number at deployment |
| updateSeed is available | `cast send $MINT "updateSeed()"` | Transaction succeeds |
| Mock mint is available | Call mint using SP1 mock proof | Transaction succeeds |

### 2.4 End-to-End Test

```bash
# 1. Update Seed
cast send $MINT "updateSeed()" --private-key $KEY

# 2. Generate proof using SP1 host (mock mode)
cd ../sp1-circuit
cargo run --release -p openclaw-host -- \
    --evidence test_evidence.json \
    --seed-epoch 1 \
    --seed $(cast call $MINT "currentSeed()") \
    --miner $MINER_ADDRESS \
    --claim-index 0 \
    --mock \
    --output proof.json

# 3. Submit to contract
PUBLIC_VALUES=$(jq -r '.public_values' proof.json)
PROOF_BYTES=$(jq -r '.proof_bytes' proof.json)

cast send $MINT "mint(bytes,bytes)" $PUBLIC_VALUES $PROOF_BYTES \
    --private-key $KEY

# 4. Check balance
cast call $TOKEN "balanceOf(address)" $MINER_ADDRESS
```

## 3. Mainnet Deployment Process

### 3.1 Pre-Deployment Security Review

| Review Item | Description | Responsible |
|-------------|-------------|-------------|
| Code audit | Professional security audit firm audits all three contracts | External |
| Formal verification | Formal proof of critical invariants (optional) | External |
| Community review | Code publicly available on GitHub for at least 2 weeks, collect feedback | Community |
| Testnet operation | Testnet runs for at least 1 full Epoch (approximately 1 week) | Team |
| Gas optimization | Confirm mint() is within 340k gas | Team |
| Edge case testing | Epoch boundary, Era transition, halving, Seed update | Team |

### 3.2 Mainnet Deployment

```bash
# Update Deploy.s.sol:
#   SP1_VERIFIER_GATEWAY = Mainnet address
#   PROGRAM_VKEY = Production vkey

forge script script/Deploy.s.sol:DeployClawing \
    --rpc-url $ETH_RPC_URL \
    --broadcast \
    --verify \
    --slow \
    -vvvv

# --slow: Wait for each transaction to be confirmed before sending the next one (safer)
```

### 3.3 Post-Deployment Verification

```bash
# 1. Verify all three contract source codes on Etherscan
forge verify-contract $TOKEN src/CLAW_Token.sol:CLAW_Token \
    --constructor-args $(cast abi-encode "constructor(address)" $MINT) \
    --etherscan-api-key $ETHERSCAN_API_KEY

forge verify-contract $VERIFIER src/ClawingVerifier.sol:ClawingVerifier \
    --constructor-args $(cast abi-encode "constructor(address,bytes32)" $SP1_GATEWAY $PROGRAM_VKEY) \
    --etherscan-api-key $ETHERSCAN_API_KEY

forge verify-contract $MINT src/PoAIWMint.sol:PoAIWMint \
    --constructor-args $(cast abi-encode "constructor(address,address)" $TOKEN $VERIFIER) \
    --etherscan-api-key $ETHERSCAN_API_KEY

# 2. Manually check the following on Etherscan:
#    - Whether the source code matches completely
#    - Whether the constructor arguments are correct
#    - Whether all immutable variables are correct

# 3. First Seed update
cast send $MINT "updateSeed()" --private-key $KEY
```

## 4. Operations

### 4.1 Monitoring Metrics

| Metric | Data Source | Alert Threshold |
|--------|-------------|-----------------|
| Epoch consumption rate | `epochMinted/epochCap` | > 50% within first 3 days |
| Active miner count | Deduplicated `Mined` events | < 10 / Epoch |
| Abnormal gas price | On-chain data | > 100 gwei sustained for 1 hour |
| Seed not updated | `seedEpoch` vs `currentGlobalEpoch()` | Difference > 1 |
| Era model not finalized | `eraModelFinalized` | Still not finalized after announcement period ends |
| Contract balance (vote lockup) | `token.balanceOf(mint)` | Abnormal growth |

### 4.2 Epoch Transition Operations

```
Every ~7 days (50,000 blocks):
  1. Monitor for new Epoch start
  2. Someone calls updateSeed() (community-driven, incentivized)
  3. Miner clients automatically detect new Seed
  4. New round of mining begins
```

### 4.3 Era Transition Operations

```
Every ~4.8 months (1,050,000 blocks):

  Epoch 11-15 (Nomination phase, ~35 days):
    - Community discusses candidate models
    - Token holders nominate (proposeModel)
    - Monitor: Whether candidateCount() is reasonable

  Epoch 16-20 (Voting phase, ~35 days):
    - Token holders vote (approve + vote)
    - Monitor: modelVotes distribution
    - Community: Discuss voting results

  Epoch 21 (Announcement phase, ~7 days):
    - Someone calls finalizeEraModel() (incentivized)
    - Voters call withdrawVote() to reclaim tokens
    - Miners prepare: Configure new model's API endpoint + key
    - Monitor: Whether eraModelFinalized is true

  New Era begins:
    - Miner clients automatically switch to new model
    - Yield halved (perBlock >> 1)
```

### 4.4 Emergencies

```
Note: The contracts are non-upgradable, non-pausable, and have no admin.
This is by design - immutability is the cornerstone of fairness.

If a critical vulnerability is discovered:
  1. The contract itself cannot be modified or paused
  2. Community level: Public disclosure, advise miners to pause their clients
  3. If the issue is with the SP1 Guest Program:
     -> Release a new Guest Program (new programVKey)
     -> Deploy a new ClawingVerifier
     -> Deploy a new PoAIWMint (pointing to the new Verifier)
     -> Old contracts continue to exist but the new contracts are used
  4. Token does not need redeployment (minter is immutable, cannot migrate to new Mint contract)

  Therefore, if the Token contract has an issue, a complete redeployment is required
  -> This is why code audits are critical
```

## 5. GitHub Open-Source Checklist

### 5.1 Repository Structure

```
clawing/
├── contracts/           # Foundry project
│   ├── src/
│   │   ├── CLAW_Token.sol
│   │   ├── ClawingVerifier.sol
│   │   └── PoAIWMint.sol
│   ├── test/
│   │   └── PoAIWMint.t.sol
│   ├── script/
│   │   └── Deploy.s.sol
│   ├── foundry.toml
│   └── lib/             # git submodules
│       ├── forge-std/
│       └── sp1-contracts/
│
├── sp1-circuit/         # SP1 Guest Program (Rust)
│   ├── program/
│   │   └── src/main.rs  # ZK circuit
│   ├── host/
│   │   └── src/main.rs  # Proof generator
│   └── Cargo.toml
│
├── docs/
│   ├── 01-architecture.md     # Project design document (i.e., existing v4.2 document)
│   ├── 02-tlsnotary-integration.md
│   ├── 03-mining-client-flow.md
│   └── 04-deployment-ops.md
│
├── deployments/         # Deployment records
│   ├── sepolia.json
│   └── mainnet.json
│
├── README.md            # Project overview
├── LICENSE              # MIT
└── .github/
    └── workflows/
        └── ci.yml       # CI: forge test + SP1 build
```

### 5.2 CI/CD (GitHub Actions)

```yaml
# .github/workflows/ci.yml
name: Clawing CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: foundry-rs/foundry-toolchain@v1
      - run: cd contracts && forge build
      - run: cd contracts && forge test -vvv

  sp1-circuit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - name: Install SP1
        run: |
          curl -L https://sp1up.dev | bash
          sp1up
      - run: cd sp1-circuit && cargo prove build
```

## 6. Deployment Record Template

```json
{
  "network": "sepolia",
  "chainId": 11155111,
  "deployer": "0x...",
  "deployBlock": 12345678,
  "timestamp": "2026-03-15T10:00:00Z",
  "contracts": {
    "CLAW_Token": {
      "address": "0x...",
      "constructorArgs": ["0x...PoAIWMintAddress"]
    },
    "ClawingVerifier": {
      "address": "0x...",
      "constructorArgs": ["0x...SP1Gateway", "0x...programVKey"]
    },
    "PoAIWMint": {
      "address": "0x...",
      "constructorArgs": ["0x...TokenAddress", "0x...VerifierAddress"],
      "startBlock": 12345678
    }
  },
  "sp1": {
    "programVKey": "0x...",
    "guestElfHash": "0x...",
    "sp1VerifierGateway": "0x..."
  },
  "verification": {
    "etherscan": true,
    "sourcify": true
  }
}
```
