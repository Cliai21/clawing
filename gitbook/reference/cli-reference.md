# CLI Reference

Complete reference for the CLAWING command-line interface. The CLI provides full control over the mining process, from initialization to automated mining.

---

## Installation

```bash
git clone https://github.com/Cliai21/clawing.git
cd clawing
npm install
```

All commands are run via `npx claw <command>`.

---

## Commands

### `claw init`

Initialize the miner configuration. Creates a `.env` file with the required template.

```bash
npx claw init
```

**Behavior:**
- Creates `.env` from the default template if it doesn't exist
- Prompts for required values (private key, AI API key) in interactive mode
- Sets secure file permissions (`chmod 600 .env`)
- Validates the Ethereum RPC connection

**Options:**

| Flag | Description |
|---|---|
| `--non-interactive` | Skip prompts; use defaults and env vars |
| `--rpc <url>` | Set a custom Ethereum RPC URL |
| `--model <name>` | Override the default AI model |

**Example:**
```bash
# Interactive setup
npx claw init

# Non-interactive with custom RPC
npx claw init --non-interactive --rpc https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
```

---

### `claw status`

Display the current mining status for your configured wallet.

```bash
npx claw status
```

**Output:**
```
CLAWING Miner Status
====================
Network:        Ethereum Mainnet
Wallet:         0x1234...abcd
ETH Balance:    0.05 ETH
CLAW Balance:   1,832,000 CLAW

Mining Status:
  Current Era:    1
  Current Epoch:  3
  Claims Used:    2 / 14
  Cooldown:       Ready (last claim: block 19,498,200)
  Next Claim:     Available now
  AI Model:       grok-4.1-fast

Rewards:
  Total Mined:    1,832,000 CLAW
  Claims Today:   1
  Est. Next:      ~916,000 CLAW

Contracts:
  CLAW Token:     0x4ba1209b165b62a1f0d2fbf22d67cacf43a6df2b
  PoAIWMint:      0x511351940d99f3012c79c613478e8f2c887a8259
  OracleVerifier: 0xc24a0ba99b9ff6b7ccea6beb4013b69f39024fd5
  Oracle:         https://oracle.minewithclaw.com (healthy)
```

**Options:**

| Flag | Description |
|---|---|
| `--json` | Output in JSON format |
| `--no-oracle` | Skip Oracle health check |

**Example:**
```bash
# JSON output for scripting
npx claw status --json

# Quick status without Oracle ping
npx claw status --no-oracle
```

---

### `claw mine`

Execute a single mining claim. Generates AI content, obtains an Oracle attestation, and submits the on-chain transaction.

```bash
npx claw mine
```

**Process:**
1. Check cooldown status — abort if not ready
2. Check epoch claim limit — abort if 14 claims reached
3. Request nonce from Oracle
4. Generate AI content using the configured model
5. Submit content to Oracle for attestation
6. Receive signed attestation
7. Estimate gas and submit on-chain transaction
8. Wait for transaction confirmation
9. Report minted $CLAW amount

**Output:**
```
Mining CLAW...
  [1/5] Checking cooldown........... OK (3,502 blocks since last claim)
  [2/5] Requesting nonce............ OK (nonce: 0x8a3f...b7c2)
  [3/5] Generating AI content....... OK (model: grok-4.1-fast)
  [4/5] Requesting attestation...... OK (signature received)
  [5/5] Submitting on-chain......... OK (tx: 0xabcd...ef01)

  Reward:     916,290 CLAW
  Gas Used:   142,000
  Gas Cost:   0.00213 ETH
  Block:      19,501,702
  Tx Hash:    0xabcd...ef01
```

**Options:**

| Flag | Description |
|---|---|
| `--dry-run` | Simulate the mining process without submitting on-chain |
| `--gas-limit <gwei>` | Set maximum gas price (overrides `MAX_GAS_GWEI`) |
| `--verbose` | Show detailed logging including API responses |
| `--no-wait` | Submit transaction without waiting for confirmation |

**Example:**
```bash
# Test run without spending gas
npx claw mine --dry-run

# Mine with gas cap
npx claw mine --gas-limit 30

# Verbose output for debugging
npx claw mine --verbose
```

---

### `claw auto`

Start automated mining mode. Continuously monitors cooldown and claims when ready.

```bash
npx claw auto
```

**Behavior:**
- Polls cooldown status at regular intervals
- Automatically initiates a claim when the cooldown has elapsed
- Respects the 14-claim epoch limit
- Logs all activity to `./logs/mining.log`
- Gracefully handles errors and retries

**Output:**
```
CLAWING Auto-Miner Started
===========================
Wallet:    0x1234...abcd
Model:     grok-4.1-fast
Strategy:  Mine at cooldown

[12:34:56] Cooldown active. 1,200 blocks remaining (~4.0 hrs)
[16:42:13] Cooldown elapsed. Initiating claim...
[16:42:45] Claim successful! +916,000 CLAW (tx: 0xabcd...ef01)
[16:42:45] Cooldown reset. Next claim in ~11.67 hrs
[16:42:45] Claims this epoch: 3/14

Press Ctrl+C to stop.
```

**Options:**

| Flag | Description |
|---|---|
| `--poll-interval <sec>` | Polling interval in seconds (default: 60) |
| `--max-gas <gwei>` | Maximum gas price — skip claim if gas exceeds this |
| `--log-file <path>` | Custom log file path |
| `--quiet` | Minimal console output |

**Example:**
```bash
# Auto-mine with 30-second polling and gas cap
npx claw auto --poll-interval 30 --max-gas 25

# Quiet mode with custom log location
npx claw auto --quiet --log-file /var/log/claw-miner.log
```

---

## Environment Variables

All configuration is managed via the `.env` file or system environment variables. Environment variables take precedence over `.env` values.

### Required Variables

| Variable | Description | Example |
|---|---|---|
| `PRIVATE_KEY` | Ethereum wallet private key | `0xabcd...1234` |
| `AI_API_KEY` | API key for the mining AI model | `xai-...` |

### Optional Variables

| Variable | Default | Description |
|---|---|---|
| `ETH_RPC_URL` | Public endpoint | Ethereum RPC provider URL |
| `ORACLE_URL` | `https://oracle.minewithclaw.com` | Oracle server URL |
| `AI_MODEL` | `grok-4.1-fast` | AI model identifier |
| `GAS_STRATEGY` | `auto` | Gas pricing: `auto`, `fast`, `standard`, `slow` |
| `MAX_GAS_GWEI` | `50` | Maximum gas price in gwei |
| `LOG_LEVEL` | `info` | Logging verbosity: `debug`, `info`, `warn`, `error` |
| `LOG_FILE` | `./logs/mining.log` | Log file path |
| `POLL_INTERVAL` | `60` | Auto-mine polling interval (seconds) |

### Gas Strategies

| Strategy | Description |
|---|---|
| `auto` | Use the provider's suggested gas price |
| `fast` | Priority fee for faster confirmation (~15 seconds) |
| `standard` | Normal fee for typical confirmation (~30 seconds) |
| `slow` | Minimum fee; may take several minutes |

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | General error |
| `2` | Configuration error (missing env vars) |
| `3` | Cooldown not met |
| `4` | Epoch claim limit reached |
| `5` | Oracle error |
| `6` | On-chain transaction failed |
| `7` | Insufficient ETH for gas |
| `8` | AI API error |

---

## Logging

All mining activity is logged to `./logs/mining.log` by default. Log entries include:

```
2025-01-15T12:34:56.789Z [INFO]  Claim initiated (nonce: 0x8a3f...b7c2)
2025-01-15T12:35:01.234Z [INFO]  AI content generated (model: grok-4.1-fast, 1.2s)
2025-01-15T12:35:05.678Z [INFO]  Attestation received (oracle: ok)
2025-01-15T12:35:18.901Z [INFO]  Tx confirmed (hash: 0xabcd...ef01, gas: 142000)
2025-01-15T12:35:18.902Z [INFO]  Reward: 916,290 CLAW
```

Configure log level with the `LOG_LEVEL` environment variable:

| Level | Output |
|---|---|
| `debug` | Everything including API payloads |
| `info` | Claims, rewards, errors |
| `warn` | Warnings and errors only |
| `error` | Errors only |

---

## Scripting Examples

### Cron Job (Mine Every 12 Hours)

```bash
# crontab -e
0 */12 * * * cd /path/to/clawing && npx claw mine >> /var/log/claw-cron.log 2>&1
```

### Check Status from Script

```bash
#!/bin/bash
STATUS=$(npx claw status --json)
COOLDOWN=$(echo $STATUS | jq -r '.mining.cooldownRemaining')

if [ "$COOLDOWN" = "0" ]; then
    echo "Ready to mine!"
    npx claw mine
else
    echo "Cooldown: $COOLDOWN blocks remaining"
fi
```

### Monitor with Watch

```bash
# Refresh status every 60 seconds
watch -n 60 'npx claw status'
```

## Next Steps

- [Installation](../getting-started/installation.md) — Full setup guide
- [Quick Start](../getting-started/quick-start.md) — Get started quickly
- [Oracle API](oracle-api.md) — API endpoints the CLI uses
- [Architecture](architecture.md) — System design overview
