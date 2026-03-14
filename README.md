# Clawing — Proof of AI Work

**Mine cryptocurrency by doing what AI does best — thinking.**

Clawing is a Proof of AI Work (PoAIW) mining system built on Ethereum. Miners earn $CLAW tokens by generating AI content that is verified by an on-chain Oracle. No GPUs required — just an AI API key and an Ethereum wallet.

## What is $CLAW?

$CLAW is an ERC-20 token on Ethereum mainnet, mined through Proof of AI Work. Each mining cycle:

1. The miner calls an AI API (e.g., xAI Grok) to generate content
2. The response is submitted to an Oracle for quality verification
3. The Oracle signs an attestation proving the work was done
4. The miner submits the attestation on-chain to mint $CLAW tokens

The entire process takes ~30-60 seconds per cycle, with a cooldown of ~11.67 hours between mines.

## Quick Start

### Option A: Using OpenClaw (Recommended)

1. Install the mining skill:
   ```bash
   clawhub install claw-mining
   ```

2. Restart OpenClaw, then say:
   > "mine CLAW"

The agent handles everything — setup, configuration, mining, and cooldown management.

### Option B: Manual Setup

```bash
git clone https://github.com/Cliai21/clawing.git
cd clawing/miner
npm install

# Interactive setup (creates .env)
npx tsx src/index.ts init

# Edit .env and add your PRIVATE_KEY

# Check status
npx tsx src/index.ts status

# Mine once
npx tsx src/index.ts mine

# Or start automatic mining
npx tsx src/index.ts auto
```

See the full [Mining Guide](docs/MINING_GUIDE.md) for detailed instructions.

### Security: Your Keys Stay Local

- The `init` command never asks for or writes your private key — you paste it into `.env` yourself
- The `.env` file is created with restricted permissions (`chmod 600`, owner-only read/write)
- At runtime the miner loads the key into memory for local signing only, then removes it from the config object
- The private key is NEVER logged, transmitted, or sent to the Oracle, AI API, or any external service
- All transactions are signed locally by the miner process on your own computer

## Token Economics

### A Note on the Ticker: From CLI to CLAW

The token was originally designed with the ticker **CLI** — a reference to the Command Line Interface, the foundational way humans interact with machines. In the age of AI, the command line has taken on renewed significance: it is how developers summon intelligence, orchestrate agents, and build the future. As a ticker, CLI was technically elegant and deeply meaningful.

However, we decided to rename the token to **CLAW**. The new name draws on the imagery of a miner's claw — a tool that digs, grips, and extracts value — symbolizing how agents mine intelligence from AI models. CLAW is also a nod to the project's visual identity and personality, resonating with the community's mascot and creative spirit.

We considered several alternatives before settling on CLAW, including MINE (too generic, widely used), PICK (ambiguous, diluted meaning), MOLE (unusual, hard to take seriously), and TOIL (negative connotation). CLAW stood out for its sharpness and memorability.

The contract on Etherscan still shows the original CLI ticker. Updating an ERC-20 token's name and symbol after deployment requires a contract upgrade through a proxy pattern. Our contract is currently a standard (non-upgradeable) ERC-20 deployed at a fixed address. A rename would involve deploying a new proxy contract, migrating token state, and re-routing all integrations — a substantial engineering effort. For now, the on-chain ticker remains CLI while we use CLAW in all documentation, communications, and community references. A formal on-chain rename will be proposed as a governance item in a future community vote.

### Reward Formula

```
R = perBlock × (1 + ln(T))
```

- `perBlock`: Base reward per Era (Era 1 = 100,000 CLAW)
- `T`: AI tokens consumed (100–100,000)
- Logarithmic scaling rewards more tokens used, but with diminishing returns

### Era System

| Parameter | Value |
|-----------|-------|
| Total Eras | 24 (~9.6 years) |
| Era duration | 21 Epochs (~145 days) |
| Epoch duration | 50,000 blocks (~6.94 days) |
| Max supply | 210 billion CLAW |
| Cooldown | 3,500 blocks (~11.67 hours) |
| Max claims/Epoch | 14 per address |

### Mining Costs (Era 1)

| Component | Cost |
|-----------|------|
| Gas per mine | ~0.0002 ETH at 2 gwei |
| AI API call | ~$0.002–0.005 (xAI, T=2100) |
| **Total per mine** | **~$0.01–0.02** |

## Architecture

```
Miner Engine (Node.js/TypeScript) — runs locally
    │
    ├── Read chain state (Era, Epoch, Seed, Cooldown)
    ├── Check gas price (abort if too high)
    ├── Request nonce from Oracle
    ├── Call AI API (grok-4.1-fast)
    ├── Submit response to Oracle for verification
    ├── Validate attestation
    └── Sign and send mint() transaction
         → CLAW tokens minted to wallet
```

## Contract Addresses (Mainnet v2)

| Contract | Address |
|----------|---------|
| CLAW Token | [`0x4ba1209b165b62a1f0d2fbf22d67cacf43a6df2b`](https://etherscan.io/address/0x4ba1209b165b62a1f0d2fbf22d67cacf43a6df2b) |
| PoAIWMint | [`0x511351940d99f3012c79c613478e8f2c887a8259`](https://etherscan.io/address/0x511351940d99f3012c79c613478e8f2c887a8259) |
| MinterProxy | [`0xe7fc311863b95e726a620b07607209965ee72bce`](https://etherscan.io/address/0xe7fc311863b95e726a620b07607209965ee72bce) |
| OracleVerifier | [`0xc24a0ba99b9ff6b7ccea6beb4013b69f39024fd5`](https://etherscan.io/address/0xc24a0ba99b9ff6b7ccea6beb4013b69f39024fd5) |

## CLI Commands

| Command | Description |
|---------|-------------|
| `npx tsx src/index.ts init` | Interactive setup — creates `.env` file |
| `npx tsx src/index.ts status` | Show mining status, balance, cooldown |
| `npx tsx src/index.ts mine` | Execute one mining cycle |
| `npx tsx src/index.ts auto` | Start continuous mining loop |

## Platform Compatibility

| Platform | Status | Installation |
|----------|--------|--------------|
| **OpenClaw** | ✅ Recommended | `clawhub install claw-mining` |
| **Hermes Agent** | ✅ Supported | `hermes skills install github:Cliai21/clawing` |
| **Perplexity Computer** | ✅ Compatible | AgentSkills-compatible |
| **Manual/Other** | ✅ Supported | `git clone` + `npm install` |

## Security

### Audit Status (v2.1)

15 issues identified and fixed:
- 1 Critical, 4 High, 5 Medium, 5 Low
- 67 tests passing (including 52 adversarial tests)

### Key Protections

| Protection | Description |
|------------|-------------|
| **Local signing** | Private keys never leave the user's machine; all transactions signed locally |
| **HTTPS enforcement** | Oracle URL must use HTTPS (except localhost) |
| **Gas validation** | Prevents Infinity/NaN gas price bypass |
| **Nonce validation** | Regex validation prevents prompt injection |
| **Attestation checks** | Verifies miner address, deadline, field integrity |
| **Response size limit** | 2MB cap prevents memory exhaustion |
| **Key cleanup** | Private key removed from config object after wallet creation |

## Links

- **Oracle**: [oracle.minewithclaw.com](https://oracle.minewithclaw.com)
- **Mining Guide**: [docs/MINING_GUIDE.md](docs/MINING_GUIDE.md)
- **CLAW Token**: [Etherscan](https://etherscan.io/address/0x4ba1209b165b62a1f0d2fbf22d67cacf43a6df2b)
- **License**: MIT-0
