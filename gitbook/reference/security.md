# Security

CLAWING's security model covers the complete pipeline from local key management through Oracle communication to on-chain verification. This page documents the threat model, security audit results, and protective measures.

---

## Security Principles

1. **Private keys never leave the user's machine** — All transactions are signed locally
2. **All Oracle communication is HTTPS-encrypted** — No plaintext data transmission
3. **On-chain verification is trustless** — Signature checks are performed by smart contracts
4. **Defense in depth** — Multiple layers of protection at each stage

## Architecture Security

```
┌──────────────────────────────────────────────────────────┐
│                    Security Boundaries                    │
│                                                          │
│  ┌──────────────────┐                                    │
│  │  Miner (Local)   │  Private key NEVER transmitted     │
│  │  ● Key storage   │  All tx signed locally             │
│  │  ● Tx signing    │  .env file permissions enforced    │
│  └────────┬─────────┘                                    │
│           │ HTTPS (TLS 1.3)                              │
│           v                                              │
│  ┌──────────────────┐                                    │
│  │  Oracle Server   │  HTTPS enforced                    │
│  │  ● Verify AI     │  Rate limiting                     │
│  │  ● Sign attest   │  Nonce replay protection           │
│  └────────┬─────────┘                                    │
│           │ Signed attestation                           │
│           v                                              │
│  ┌──────────────────┐                                    │
│  │  Smart Contracts │  On-chain signature verification   │
│  │  ● OracleVerify  │  Immutable logic                   │
│  │  ● PoAIWMint     │  Rate limiting (cooldown + epoch)  │
│  │  ● CLAW_Token    │  Supply cap enforcement            │
│  └──────────────────┘                                    │
└──────────────────────────────────────────────────────────┘
```

## Threat Model

### Threats and Mitigations

| Threat | Severity | Mitigation |
|---|---|---|
| **Private key theft** | Critical | Keys stored locally only; `.env` file with `chmod 600`; dedicated mining wallet recommended |
| **Oracle impersonation** | High | HTTPS enforced; Oracle signer address hardcoded in OracleVerifier contract |
| **Replay attacks** | High | Single-use nonces; block reference binding; on-chain claim tracking |
| **Man-in-the-middle** | High | TLS 1.3 encryption on all Oracle communication |
| **Sybil attacks** | Medium | Gas costs per claim (~$1-5); cooldown period (3,500 blocks); epoch limits (14 claims) |
| **Flash loan voting** | Medium | Voting snapshot at epoch boundary; token lock-up during voting phase |
| **Oracle downtime** | Medium | Monitoring via `/metrics` endpoint; future: decentralized Notary network (Phase 2) |
| **Smart contract bugs** | High | Security audit completed; 67 test cases passing; proxy pattern for upgrades |
| **AI content spoofing** | Medium | Oracle verifies content against designated model; nonce prevents pre-generation |
| **Nonce frontrunning** | Low | Nonces are address-bound; attestations are miner-specific |

### Trust Assumptions

| Component | Trust Level | Notes |
|---|---|---|
| Ethereum mainnet | Trustless | Decentralized consensus |
| Smart contracts | Trustless | Verified, audited, immutable |
| Oracle server | Trusted (Phase 1) | Centralized; decentralized in Phase 2 |
| AI API provider | Trusted | External service; verified by Oracle |
| Miner's machine | User responsibility | Key storage, `.env` security |

## Security Audit

### Audit v2.1 Summary

| Metric | Result |
|---|---|
| **Issues found** | 15 |
| **Issues fixed** | 15 (100%) |
| **Test cases** | 67 |
| **Tests passing** | 67 (100%) |

### Issue Breakdown

| Severity | Found | Fixed |
|---|---|---|
| Critical | 0 | 0 |
| High | 2 | 2 |
| Medium | 5 | 5 |
| Low | 4 | 4 |
| Informational | 4 | 4 |

### Key Findings and Fixes

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | Reentrancy risk in claim function | Added reentrancy guard |
| 2 | High | Integer overflow in reward calculation | Fixed-point arithmetic with overflow checks |
| 3 | Medium | Missing zero-address validation | Added address(0) checks |
| 4 | Medium | Unbounded gas in epoch transition | Optimized state updates |
| 5 | Medium | Signature malleability | Enforced low-s ECDSA signatures |

## Key Protection

### Local Key Management

Your Ethereum private key is the most critical security asset. CLAWING enforces strict key management:

```
┌─────────────────────────────────────────────┐
│              Key Security Model             │
│                                             │
│  Private Key (.env)                         │
│  ├── Stored ONLY on miner's local machine   │
│  ├── NEVER transmitted to Oracle            │
│  ├── NEVER transmitted to AI API            │
│  ├── NEVER logged or displayed              │
│  └── Used ONLY for local tx signing         │
│                                             │
│  Transaction Signing                        │
│  ├── Performed locally by ethers.js         │
│  ├── Signed tx submitted to Ethereum RPC    │
│  └── RPC provider sees signed tx, not key   │
└─────────────────────────────────────────────┘
```

### Best Practices

1. **Use a dedicated mining wallet**
   ```
   Do: Create a fresh wallet exclusively for CLAWING mining
   Don't: Use your primary wallet with large holdings
   ```

2. **Secure your `.env` file**
   ```bash
   chmod 600 .env  # Owner read/write only
   ```

3. **Maintain minimal ETH balance**
   ```
   Keep only enough ETH for gas fees (~0.01-0.05 ETH)
   ```

4. **Never expose your private key**
   ```
   Do: Copy-paste directly into .env
   Don't: Send via email, chat, or paste into websites
   ```

5. **Verify contract addresses**
   ```
   Always verify you're interacting with the official contracts
   listed on this page and on Etherscan
   ```

## Oracle Security

### HTTPS Enforcement

All communication with the Oracle uses HTTPS (TLS 1.3):
- Certificate pinning recommended for custom implementations
- HTTP requests are rejected with a 301 redirect to HTTPS
- HSTS headers are set to prevent downgrade attacks

### Nonce System

The nonce system prevents multiple categories of attacks:

| Attack | Prevention |
|---|---|
| Replay | Each nonce is single-use |
| Pre-computation | Nonces are time-limited and address-bound |
| Cross-address | Nonces are tied to the requesting miner address |
| Stale attestation | Block reference ensures freshness |

### Rate Limiting

The Oracle enforces rate limits to prevent abuse:

| Endpoint | Limit |
|---|---|
| Nonce requests | 10/min per address |
| Attestation requests | 5/min per address |
| Health checks | 60/min |

## On-Chain Security

### Immutable Constraints

The smart contracts enforce invariants that cannot be bypassed:

| Constraint | Contract | Purpose |
|---|---|---|
| Supply cap (210B) | CLAW_Token | Prevents inflation |
| Cooldown (3,500 blocks) | PoAIWMint | Prevents spam |
| Epoch limit (14 claims) | PoAIWMint | Bounds per-address mining |
| Signature verification | OracleVerifier | Ensures Oracle authenticity |
| Authorized minter only | CLAW_Token | Prevents unauthorized minting |

### Upgrade Security

The MinterProxy enables upgrades with safeguards:
- Only governance-authorized upgrades
- Implementation address is publicly verifiable
- Previous implementation remains auditable on-chain
- Token balances and state are preserved across upgrades

## Incident Response

If you suspect a security issue:

1. **Do NOT publicly disclose** the vulnerability
2. Report via GitHub security advisory at [github.com/Cliai21/clawing](https://github.com/Cliai21/clawing)
3. Include: description, reproduction steps, potential impact
4. Allow reasonable time for a fix before any public disclosure

## Phase 2: Decentralized Security

Phase 2 eliminates the centralized Oracle trust assumption:

| Phase 1 (Current) | Phase 2 (Future) |
|---|---|
| Single Oracle signer | Distributed Notary network |
| Trust in Oracle operator | Threshold cryptographic consensus |
| Centralized verification | zkTLS proof verification |
| Single point of failure | Byzantine fault tolerant |

See [Roadmap](../protocol/roadmap.md) for Phase 2 timeline.

## Next Steps

- [Architecture](architecture.md) — Technical system design
- [Smart Contracts](contracts.md) — Contract addresses and interfaces
- [Oracle API](oracle-api.md) — API security details
- [FAQ](../community/faq.md) — Security-related questions
