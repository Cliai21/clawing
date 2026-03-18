# Roadmap

CLAWING's development follows a three-phase roadmap, progressing from a centralized Oracle architecture to fully decentralized verification and ultimately an independent Layer 1 blockchain.

---

## Phase Overview

```
Phase 1                    Phase 2                    Phase 3
Centralized Oracle         Decentralized Verify       Independent L1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━>

Current ──────────>  zkTLS + Notary Network ──────>  Blockless L1
                                                     $CLAW as native
                                                     currency
```

---

## Phase 1: Centralized Oracle (Current)

**Status**: Live on Ethereum Mainnet

Phase 1 establishes the core protocol with a centralized Oracle for AI work verification. This architecture prioritizes rapid deployment and iteration while maintaining security through cryptographic attestations.

### Architecture

```
Miner ──> AI API ──> Centralized Oracle ──> Ethereum Smart Contracts
                     (oracle.minewithclaw.com)
```

### Completed Milestones

| Milestone | Status |
|---|---|
| CLAW ERC-20 token deployment | Done |
| PoAIWMint contract (v2) | Done |
| OracleVerifier contract | Done |
| MinterProxy (upgradeability) | Done |
| Oracle server launch | Done |
| CLI miner | Done |
| OpenClaw platform integration | Done |
| Security audit v2.1 (15 issues fixed, 67 tests passing) | Done |
| On-chain governance framework | Done |
| Hermes Agent support | Done |

### Current Work

| Item | Status |
|---|---|
| Perplexity platform integration | In Progress |
| Mining dashboard and analytics | In Progress |
| Cross-platform SDK | In Progress |
| Enhanced Oracle monitoring | In Progress |

### Key Properties

- **Centralization**: Oracle is the single verifier
- **Trust assumption**: Oracle operator is honest
- **Mitigation**: Oracle signing key is public, all attestations are verifiable
- **Upgradeability**: MinterProxy enables contract upgrades without redeployment

---

## Phase 2: Decentralized Verification

**Status**: Research & Development

Phase 2 eliminates the centralized Oracle by introducing cryptographic verification that anyone can perform. The core technology stack is **zkTLS** — zero-knowledge proofs over TLS connections.

### Architecture

```
Miner ──> AI API ──> zkTLS Proof Generation ──> Decentralized Notary Network
                                                         │
                                                         v
                                               Ethereum Smart Contracts
```

### Key Technologies

#### TLSNotary

TLSNotary enables a client to prove to a third party that specific data was received over a TLS connection — without revealing the full connection data to the verifier.

For CLAWING, this means:
- A miner can prove they received a genuine AI model response
- The proof is cryptographic, not trust-based
- No centralized Oracle is needed to attest the AI work

#### MPC-TLS (Multi-Party Computation over TLS)

MPC-TLS distributes the TLS verification across multiple parties:
- No single verifier sees the complete data
- Collusion resistance through threshold cryptography
- Multiple independent parties must agree for verification

#### Notary Network

A decentralized network of Notary nodes replaces the single Oracle:

```
┌─────────────────────────────────────────────────────┐
│              Decentralized Notary Network            │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ Notary 1 │  │ Notary 2 │  │ Notary 3 │  ...    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘         │
│       │              │             │                │
│       └──────────────┼─────────────┘                │
│                      │                              │
│              Threshold Agreement                    │
│                      │                              │
│                      v                              │
│             Attestation Valid                        │
└─────────────────────────────────────────────────────┘
```

### Phase 2 Milestones

| Milestone | Status |
|---|---|
| TLSNotary proof-of-concept for AI API calls | Research |
| MPC-TLS protocol design | Research |
| Notary node software | Planned |
| Notary staking mechanism | Planned |
| On-chain proof verification | Planned |
| Testnet deployment | Planned |
| Mainnet migration | Planned |

### Migration Path

The transition from Phase 1 to Phase 2 will be seamless for miners:

1. MinterProxy enables contract upgrades without token migration
2. Mining clients will be updated to generate zkTLS proofs
3. The Oracle will first run alongside the Notary network (dual-verification)
4. Once the Notary network is stable, the centralized Oracle will be deprecated

---

## Phase 3: Independent Layer 1

**Status**: Vision

The long-term vision for CLAWING is to become an independent **blockless Layer 1** blockchain where $CLAW serves as the native currency of AI computation.

### Vision: The Bitcoin of AI

Just as Bitcoin established digital scarcity through Proof of Work, CLAWING aims to establish **AI computation as a native economic primitive**. $CLAW would become the native currency for:

- AI model inference
- AI content generation and verification
- AI computation marketplaces
- Decentralized AI governance

### Blockless Architecture

The "blockless" design eliminates traditional block production:

- **Asynchronous consensus**: Transactions are validated individually, not batched into blocks
- **Instant finality**: No need to wait for block confirmation
- **Parallel processing**: Multiple AI work proofs can be verified simultaneously
- **Scalability**: Throughput scales with the number of validators, not block size

### $CLAW as Native Currency

In the L1 phase, $CLAW transitions from an ERC-20 token to the native currency of its own blockchain:

- **Gas fees** paid in $CLAW
- **Validator staking** in $CLAW
- **AI computation** priced in $CLAW
- **Governance** powered by $CLAW

### Phase 3 Milestones

| Milestone | Status |
|---|---|
| Blockless consensus research | Vision |
| L1 architecture design | Vision |
| ERC-20 to native token bridge | Vision |
| Testnet launch | Vision |
| Mainnet launch | Vision |

---

## Timeline Summary

| Phase | Focus | Status | Estimated Duration |
|---|---|---|---|
| **Phase 1** | Centralized Oracle + Core Protocol | **Live** | Ongoing |
| **Phase 2** | zkTLS + Decentralized Notary | R&D | TBD |
| **Phase 3** | Independent Blockless L1 | Vision | TBD |

The roadmap is deliberately flexible on timelines. Each phase will ship when its technology is production-ready, not on an arbitrary schedule.

## Next Steps

- [Proof of AI Work](proof-of-ai-work.md) — Current consensus mechanism
- [Architecture](../reference/architecture.md) — Technical system design
- [Security](../reference/security.md) — Security model and audit results
- [Contributing](../community/contributing.md) — Help build the future of CLAWING
