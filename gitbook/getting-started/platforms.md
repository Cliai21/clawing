# Platforms

CLAWING supports multiple mining platforms to fit different user preferences and workflows. Each platform connects to the same smart contracts and Oracle — the mining result is identical regardless of which platform you use.

---

## Platform Comparison

| Platform | Type | Difficulty | Automation | Status |
|---|---|---|---|---|
| **OpenClaw** | Web / Agent | Beginner | Full | **Recommended** |
| **Hermes Agent** | Autonomous Agent | Intermediate | Full | Available |
| **Perplexity** | AI Assistant | Beginner | Partial | Coming Soon |
| **CLI (Manual)** | Command Line | Advanced | Configurable | Available |

---

## OpenClaw (Recommended)

**Website**: [openclaw.ai](https://openclaw.ai)

OpenClaw is the primary recommended platform for mining $CLAW. It provides a streamlined interface that handles the entire mining pipeline — from AI content generation through Oracle verification to on-chain submission.

### Features

- **One-click mining**: Connect wallet, configure API key, and mine
- **Built-in status dashboard**: View Era, Epoch, cooldown, and claim history
- **Automated scheduling**: Set-and-forget mining with cooldown management
- **Wallet integration**: Supports MetaMask, Rabby, WalletConnect, and more
- **Real-time notifications**: Alerts for successful claims, cooldown readiness, and epoch resets

### Getting Started with OpenClaw

1. Navigate to [openclaw.ai](https://openclaw.ai)
2. Connect your Ethereum wallet
3. Enter your AI API key in Settings
4. Click **Mine CLAW** or type `mine CLAW` in the command interface

### Why OpenClaw?

OpenClaw is purpose-built for CLAWING mining. It abstracts away the complexity of Oracle interaction and transaction management while keeping your private key securely in your browser wallet — never on a server.

---

## Hermes Agent

Hermes Agent is an autonomous AI agent platform that can be configured to mine $CLAW on a schedule.

### Features

- **Autonomous operation**: Configure once, mine automatically
- **Multi-task capable**: Mining runs alongside other agent tasks
- **Customizable scheduling**: Set mining frequency and timing
- **Transaction management**: Handles gas estimation and retries

### Setup

1. Install and configure Hermes Agent per its documentation
2. Add CLAWING mining as a task:
   - Set the mining contract addresses
   - Configure your AI API key
   - Set the Oracle endpoint to `https://oracle.minewithclaw.com`
3. Define your mining schedule (respecting the 3,500-block cooldown)
4. Start the agent

### Best For

Users who want fully autonomous mining without manual intervention. Hermes handles cooldown tracking and epoch management automatically.

---

## Perplexity (Coming Soon)

Perplexity integration will allow users to mine $CLAW directly through the Perplexity AI assistant interface.

### Planned Features

- **Conversational mining**: Mine through natural language commands
- **Status queries**: Ask about your mining status, rewards, and cooldowns
- **Guided setup**: Step-by-step configuration through conversation

### Status

Currently in development. Follow the [official channels](../community/links.md) for announcements.

---

## CLI (Manual)

The official CLAWING CLI provides full control over the mining process. Best suited for developers and advanced users who want granular control.

### Features

- **Full control**: Configure every parameter of the mining process
- **Scriptable**: Easily integrate with cron jobs, shell scripts, or automation tools
- **Transparent**: See every API call, transaction, and Oracle interaction
- **Lightweight**: No GUI overhead, runs on any system with Node.js

### Setup

```bash
git clone https://github.com/Cliai21/clawing.git
cd clawing
npm install
npx claw init
```

### Commands

| Command | Description |
|---|---|
| `npx claw init` | Initialize configuration |
| `npx claw status` | Display mining status |
| `npx claw mine` | Execute a single mining claim |
| `npx claw auto` | Start automated mining |

See [CLI Reference](../reference/cli-reference.md) for complete documentation.

### Best For

Developers who want full visibility and control, users running on headless servers, or anyone integrating CLAWING mining into custom automation pipelines.

---

## Platform Architecture

All platforms connect to the same backend infrastructure:

```
┌──────────────────────────────────────────────┐
│              Mining Platforms                 │
│                                              │
│  ┌──────────┐ ┌────────┐ ┌──────┐ ┌─────┐  │
│  │ OpenClaw │ │ Hermes │ │ Perp │ │ CLI │  │
│  └────┬─────┘ └───┬────┘ └──┬───┘ └──┬──┘  │
│       │            │         │        │      │
└───────┼────────────┼─────────┼────────┼──────┘
        │            │         │        │
        v            v         v        v
   ┌─────────────────────────────────────────┐
   │          AI API (grok-4.1-fast)         │
   └──────────────────┬──────────────────────┘
                      │
                      v
   ┌─────────────────────────────────────────┐
   │      Oracle (oracle.minewithclaw.com)   │
   └──────────────────┬──────────────────────┘
                      │
                      v
   ┌─────────────────────────────────────────┐
   │         Ethereum Mainnet Contracts      │
   │  CLAW Token ← PoAIWMint ← OracleVerify │
   └─────────────────────────────────────────┘
```

Regardless of which platform you choose, the flow is always:

1. Your platform generates AI content using your API key
2. Content is submitted to the Oracle for verification
3. Oracle returns a signed attestation
4. Your wallet signs and submits the on-chain transaction
5. $CLAW is minted to your address

**Your private key never leaves your machine.** All platforms sign transactions locally.

---

## Choosing a Platform

| If you want... | Use... |
|---|---|
| Easiest setup, best UX | **OpenClaw** |
| Fully autonomous mining | **Hermes Agent** |
| Natural language interface | **Perplexity** (when available) |
| Maximum control & scriptability | **CLI** |
| Headless / server deployment | **CLI** |

## Next Steps

- [Quick Start](quick-start.md) — Start mining with OpenClaw
- [Installation](installation.md) — Set up the CLI from source
- [CLI Reference](../reference/cli-reference.md) — Full command reference
