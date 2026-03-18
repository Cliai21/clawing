# Governance

CLAWING implements on-chain governance that allows $CLAW token holders to decide which AI model is used for mining in each Era. This creates a decentralized mechanism for AI model selection — one of the first protocols to put AI governance on-chain.

---

## Overview

Each Era (21 epochs, ~145 days) follows a structured governance cycle with four distinct phases. Token holders nominate candidate AI models, vote on their preferred choice, and the winning model becomes the designated mining model for the next Era.

```
Era Governance Timeline (21 Epochs)

Epoch  1                   10  11         15  16         20  21
       │─── Mining Phase ───│── Nominate ──│─── Vote ────│── Final ──│
       │                    │              │             │           │
       │  Normal mining     │  Propose new │  Cast votes │  Tally &  │
       │  continues with    │  AI models   │  for model  │  announce │
       │  current model     │  for next    │  candidates │  winner   │
       │                    │  Era         │             │           │
```

## Governance Phases

### Phase 1: Mining (Epochs 1-10)

Standard mining operations proceed with the current Era's designated model. No governance actions take place during this phase.

| Property | Value |
|---|---|
| Duration | 10 epochs (~69.4 days) |
| Activity | Normal mining |
| Governance | None |

### Phase 2: Nomination (Epochs 11-15)

Token holders may nominate candidate AI models for the next Era. Nominations require a minimum $CLAW balance to prevent spam.

| Property | Value |
|---|---|
| Duration | 5 epochs (~34.7 days) |
| Activity | Model nominations |
| Requirement | Minimum $CLAW balance |

**Nomination Criteria:**
- The proposed model must be publicly accessible via API
- The model must be capable of generating verifiable content
- The nominator must hold a minimum $CLAW balance
- Each address may nominate one model per Era

### Phase 3: Voting (Epochs 16-20)

Token holders vote for their preferred model from the nomination pool. Voting follows a **one-token-one-vote** system with a lock-up mechanism.

| Property | Value |
|---|---|
| Duration | 5 epochs (~34.7 days) |
| Activity | Casting votes |
| Mechanism | One-token-one-vote |
| Lock-up | Tokens locked during voting period |

**Voting Rules:**
- Each $CLAW token equals one vote
- Tokens used for voting are locked until the voting phase ends
- Voters may delegate their votes to another address
- Votes are cast on-chain and are publicly visible
- No vote changes after submission

### Phase 4: Finalization (Epoch 21)

The votes are tallied and the winning model is announced. The result is recorded on-chain, and the new model takes effect at the start of the next Era.

| Property | Value |
|---|---|
| Duration | 1 epoch (~6.94 days) |
| Activity | Tally and transition |
| Output | New mining model for next Era |

## Voting Mechanism

### One-Token-One-Vote

The voting system is straightforward:

```
Voting Power = Number of $CLAW tokens held at snapshot block
```

There are no multipliers, no quadratic voting, and no delegation bonuses. One token equals one vote.

### Lock-Up

When a holder casts votes, their tokens are locked in the governance contract for the duration of the voting phase. This prevents:

- **Double voting**: Using the same tokens across multiple votes
- **Vote manipulation**: Buying tokens, voting, then selling immediately
- **Flash loan attacks**: Borrowing tokens to influence votes

Tokens are automatically unlocked when the finalization phase completes.

### Snapshot

A snapshot of token balances is taken at the start of the voting phase (Epoch 16, block 0). Only tokens held at the snapshot block have voting power. This prevents last-minute token accumulation to influence votes.

## Governance Flow

```
┌──────────────────────────────────────────────────────────┐
│                    Governance Cycle                       │
│                                                          │
│  Mining Phase (Ep 1-10)                                  │
│  └─> No governance actions                               │
│                                                          │
│  Nomination Phase (Ep 11-15)                             │
│  └─> Token holders submit model proposals                │
│      └─> Minimum balance required                        │
│      └─> One nomination per address                      │
│                                                          │
│  Voting Phase (Ep 16-20)                                 │
│  └─> Snapshot taken at Epoch 16, Block 0                 │
│      └─> Token holders cast votes                        │
│      └─> Tokens locked during voting                     │
│      └─> One-token-one-vote                              │
│                                                          │
│  Finalization (Ep 21)                                    │
│  └─> Votes tallied                                       │
│      └─> Winner announced on-chain                       │
│      └─> New model takes effect next Era                 │
│      └─> Locked tokens released                          │
└──────────────────────────────────────────────────────────┘
```

## Why On-Chain Model Governance?

### Decentralized AI Selection

The choice of AI model is the single most important parameter in PoAIW mining. By putting this decision on-chain, CLAWING ensures:

- **No central authority** dictates which AI model is used
- **Token holders** — the miners themselves — have direct control
- **Model evolution** keeps pace with AI advancement
- **Transparency** — every nomination and vote is publicly verifiable

### Adaptive Protocol

As AI models improve rapidly, the governance system allows CLAWING to adopt newer, better models each Era without requiring a protocol upgrade or hard fork.

### Model Diversity

Over time, different Eras may use different models, creating a historical record of which AI models the community valued at each point in time.

## Current State

| Parameter | Value |
|---|---|
| Current Era | 1 |
| Current Model | `grok-4.1-fast` |
| Governance Phase | Mining (Epochs 1-10) |

## Future Enhancements

As the protocol matures, governance may expand to cover:

- **Oracle parameters**: Verification thresholds and requirements
- **Protocol upgrades**: Via the MinterProxy upgradeability pattern
- **Fee structures**: Mining cost parameters
- **Emission adjustments**: Within the fixed total supply framework

## Next Steps

- [Proof of AI Work](proof-of-ai-work.md) — The consensus mechanism governance controls
- [Tokenomics](tokenomics.md) — Token economics and voting power
- [Roadmap](roadmap.md) — Future governance developments
- [Architecture](../reference/architecture.md) — Smart contract governance integration
