# Tokenomics

$CLAW follows a Bitcoin-inspired deflationary emission model with a fixed total supply, periodic halving events, and zero premine or insider allocation. Every token is distributed through Protocol Bootstrap Mining.

---

## Supply Overview

| Parameter | Value |
|---|---|
| **Token Name** | CLAWING |
| **Symbol** | CLAW |
| **Standard** | ERC-20 |
| **Network** | Ethereum Mainnet |
| **Total Supply** | 210,000,000,000 (210 billion) |
| **Decimals** | 18 |
| **Premine** | 0 |
| **ICO / IEO** | None |
| **VC Allocation** | None |
| **Team Allocation** | None |

100% of $CLAW supply is mined through Protocol Bootstrap Mining. There is no treasury, no foundation fund, and no reserved allocation.

## Halving System

$CLAW uses a **24-Era halving schedule**. The base reward (`perBlock`) is cut in half at the start of each new Era.

### Era Structure

```
1 Era = 21 Epochs = 1,050,000 blocks ≈ 145.83 days
1 Epoch = 50,000 blocks ≈ 6.94 days
```

### Halving Schedule

| Era | perBlock (CLAW) | Era Duration | Cumulative Supply (approx.) |
|---|---|---|---|
| 1 | 100,000 | ~146 days | — |
| 2 | 50,000 | ~146 days | — |
| 3 | 25,000 | ~146 days | — |
| 4 | 12,500 | ~146 days | — |
| 5 | 6,250 | ~146 days | — |
| 6 | 3,125 | ~146 days | — |
| ... | ... | ... | ... |
| 12 | ~48.83 | ~146 days | — |
| 18 | ~0.76 | ~146 days | — |
| 24 | ~0.012 | ~146 days | 210B (final) |

After Era 24, no more $CLAW can be minted. The total elapsed time across all 24 Eras is approximately **9.6 years**.

### Emission Curve

```
Emission per Era (log scale)

Era 1  ████████████████████████████████████████  100,000
Era 2  ████████████████████                      50,000
Era 3  ██████████                                25,000
Era 4  █████                                     12,500
Era 5  ███                                       6,250
Era 6  ██                                        3,125
...
Era 24 ▏                                         ~0.012
```

The emission follows a geometric decay: each Era produces half the tokens of the previous Era, approaching the 210 billion cap asymptotically.

## Reward Formula

Each successful mining claim earns:

```
R = perBlock × (1 + ln(T))
```

Where:
- `perBlock` = Base reward for the current Era (Era 1 = 100,000 CLAW)
- `T` = Number of AI tokens consumed in the mining call (range: 100–100,000)
- `ln(T)` = Natural logarithm of T
- The cooldown period is enforced separately (3,500 blocks ≈ 11.67 hours)

### Reward Examples (Era 1)

| AI Tokens (T) | Reward per Mine | Notes |
|---|---|---|
| 2,100 | ~862,300 CLAW | Minimum practical, best ROI |
| 5,000 | ~931,600 CLAW | Moderate |
| 10,000 | ~1,000,900 CLAW | Higher cost, diminishing returns |
| 100,000 | ~1,251,300 CLAW | Maximum T, worst ROI |

### Economic Rationale

The logarithmic formula creates an anti-whale mechanism:

1. **Diminishing returns on AI spend**: Increasing T from 2,100 to 100,000 (47x more API cost) only increases reward by ~45%. Optimal strategy is to use minimum practical tokens.
2. **Fair access**: Even miners using minimal AI API budgets earn competitive rewards
3. **Productive work**: Every token represents genuine AI computation, not wasted energy

## Mining Rate Limits

### Per-Address Limits

| Constraint | Value | Rationale |
|---|---|---|
| Cooldown period | 3,500 blocks (~11.67 hrs) | Prevents rapid-fire claims |
| Epoch claim cap | 14 claims per address | Bounds per-address rewards |
| Epoch duration | 50,000 blocks (~6.94 days) | Defines the cap window |

### Maximum Per-Address Output (Era 1)

```
Max claims per epoch:    14
Max claims per era:      14 × 21 = 294
Reward per claim (min):  ~916,000 CLAW (at cooldown)
Max per era per address: ~269,304,000 CLAW
```

## Mining Costs

Mining $CLAW has two primary costs:

### 1. AI API Costs

Each claim requires one AI content generation call:

| Model | Approx. Cost per Call |
|---|---|
| `grok-4.1-fast` | ~$0.001 - $0.01 |

### 2. Ethereum Gas Costs

Each on-chain mint transaction uses approximately 100k gas:

| Gas Price | Approx. Cost |
|---|---|
| 2 gwei | ~0.0002 ETH (~$0.01) |
| 5 gwei | ~0.0005 ETH (~$0.02) |
| 10 gwei | ~0.001 ETH (~$0.04) |

The miner includes a configurable `MAX_GAS_PRICE_GWEI` setting (default: 2 gwei) that automatically pauses mining when gas prices are elevated.

### Total Cost per Claim

```
Total ≈ AI API cost + Ethereum gas
     ≈ $0.005 + $0.01
     ≈ $0.01-0.02 per claim (typical, at low gas)
```

## Token Distribution Model

Since there is no premine, ICO, or allocation, the distribution is entirely market-driven:

```
Distribution of 210B $CLAW

┌─────────────────────────────────────────┐
│                                         │
│     100% Protocol Bootstrap Mining      │
│                                         │
│   - Era 1: ~50% of total supply        │
│   - Era 2: ~25% of total supply        │
│   - Era 3: ~12.5% of total supply      │
│   - Eras 4-24: ~12.5% remaining        │
│                                         │
└─────────────────────────────────────────┘
```

Early eras distribute the majority of tokens, creating strong incentives for early miners while maintaining the long-term emission schedule.

## Comparison to Bitcoin

| Property | Bitcoin (BTC) | CLAWING (CLAW) |
|---|---|---|
| Total supply | 21 million | 210 billion |
| Halving period | ~4 years (210,000 blocks) | ~146 days (1,050,000 blocks) |
| Number of halvings | ~33 | 24 |
| Full emission | ~2140 | ~2036 |
| Mining mechanism | SHA-256 PoW | PoAIW |
| Premine | 0% | 0% |
| VC / ICO | None | None |
| Reward formula | Fixed per block | Logarithmic bonus |

## Contract Address

The $CLAW ERC-20 token is deployed at:

```
0x4ba1209b165b62a1f0d2fbf22d67cacf43a6df2b
```

Verify on [Etherscan](https://etherscan.io/token/0x4ba1209b165b62a1f0d2fbf22d67cacf43a6df2b).

## Next Steps

- [Proof of AI Work](proof-of-ai-work.md) — How the consensus mechanism works
- [Governance](governance.md) — Token-holder governance of AI model selection
- [Smart Contracts](../reference/contracts.md) — All contract addresses and details
- [FAQ](../community/faq.md) — Common questions about tokenomics
