# Clawing Launch Announcement

> Copy this template and customize for your community channels.

---

## Introducing Clawing: Proof of AI Work on Ethereum

Clawing is now live on Ethereum mainnet.

Clawing implements Proof of AI Work (PoAIW) — a novel consensus mechanism where miners perform verifiable AI inference tasks to earn CLAW tokens. Instead of burning electricity, miners contribute useful AI computation.

### How It Works

1. **Mine with AI** — Miners send prompts to an AI model and submit the response for verification
2. **Oracle Attestation** — The Oracle server validates the AI response through multi-layer anti-cheat mechanisms
3. **Earn CLAW** — Valid work is rewarded with CLAW tokens, proportional to computation effort

### Key Facts

| Parameter | Value |
|-----------|-------|
| Token | CLAW (ERC-20) |
| Total Supply | 210,000,000,000 CLAW |
| Network | Ethereum Mainnet |
| Era 1 Model | grok-4.1-fast |
| Cooldown | 3,500 blocks (~11.7 hours) |
| Halving | Every 1,050,000 blocks (~145 days) |

### Contract Addresses

| Contract | Address |
|----------|---------|
| CLAW_Token | `0x_FILL_AFTER_DEPLOYMENT` |
| OracleVerifier | `0x_FILL_AFTER_DEPLOYMENT` |
| MinterProxy | `0x_FILL_AFTER_DEPLOYMENT` |
| PoAIWMint | `0x_FILL_AFTER_DEPLOYMENT` |

All contracts are verified on Etherscan. Source code is fully open.

### Fair Launch — No Pre-Mine

- **No pre-mined tokens** — Every CLAW must be earned through AI work
- **No team allocation** — The creator mines under the same rules as everyone else
- **No admin keys** — Model governance is fully decentralized through on-chain voting
- **Open source** — All code is publicly auditable

### Guardian Role (Transparency)

The Guardian is a security mechanism, not an admin role:
- Can only propose minter contract changes (7-day timelock)
- Cannot mint, transfer, or freeze tokens
- Cannot modify tokenomics or mining rules
- Community has 7 days to review any proposed change
- Guardian can be permanently renounced via `renounceGuardian()`
- Guardian key is stored on a Ledger cold wallet

### Start Mining

1. Install the **CLAW Mining Skill** on a compatible AI Agent platform
2. Tell your agent: "Help me set up CLAW mining"
3. Provide your credentials when asked (AI API key, Ethereum RPC, mining wallet)
4. The agent handles everything else — configuration, mining, cooldown management

Full mining guide: [Mining Guide](MINING_GUIDE.md)

### Architecture

Clawing uses a 4-contract architecture with clean separation of concerns:

- **CLAW_Token** — ERC-20 token with immutable minter reference
- **OracleVerifier** — Multi-node ECDSA signature verification
- **MinterProxy** — 7-day timelock governance with Guardian safety
- **PoAIWMint** — Core mining logic with era-based halving

### Anti-Cheat

Three layers of defense against mining fraud:
1. **Nonce embedding** — One-time nonces embedded in prompts
2. **Cross-validation** — Token counts, timestamps, finish reasons verified
3. **API callback** — Oracle independently validates responses

### Links

- **Website:** [https://minewithclaw.com]
- **GitHub:** [https://github.com/Cliai21/clawing]
- **Whitepaper:** [Download from website]
- **Mining Guide:** [Website mining page]
- **Oracle Endpoint:** `https://oracle.minewithclaw.com`

---

*Clawing was created by a single developer, released in the spirit of Satoshi Nakamoto — code speaks louder than teams.*
