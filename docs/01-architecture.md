# 🦞 CLAWING v4.2 — Era Model Governance + On-Chain Voting

> **"Eras define halving, Epochs define rhythm, community defines the model, blocks define everything"**
> 210 billion total supply · 24 Era halving · 504 Epoch weekly emission · 3500 block cooldown · zero timestamp · on-chain model governance

---

## 0. Core Upgrades in This Version

| Dimension | v4.1 | v4.2 (this version) |
|------|------|------------|
| **Model selection** | Global multi-domain whitelist (5 API domains) | **Single model per Era: Era 1 hard-coded GPT-5.4, subsequent Eras decided by on-chain voting** |
| **Governance mechanism** | None | **Nomination + voting + tally three-phase, one-token-one-vote, lock-up voting with flash-loan protection** |
| **zkTLS proof content** | Verify API domain (domainHash) | **Verify specific model ID (modelHash), based on OpenAI-compatible response format** |
| **Voting window** | None | **Nomination (Ep 11-15) + Voting (Ep 16-20) + Announcement (Ep 21)** |

**Inherited from v4.1 (unchanged):**
- ✅ Dual-layer structure: Era (1.05M blocks halving cycle) + Epoch (50K blocks emission cycle)
- ✅ 3,500 block cooldown (14 times per Epoch)
- ✅ Epoch Seed (updated every 50K blocks)
- ✅ Pure `block.number`, zero timestamp dependency

**Unchanged core (inherited from v1.0-v4.1):**
- ✅ 210 billion total supply, zero premine, Fair Launch
- ✅ R = Base × (1 + ln(T)) logarithmic decay anti-whale
- ✅ zkTLS (TLSNotary) + SP1 Groth16 cryptographic verification
- ✅ MSB bitwise operation (~30 Gas) for logarithm calculation
- ✅ Three-contract decoupled architecture (Token / Verifier / Mint)
- ✅ Ethereum mainnet deployment
- ✅ Instant claim mode
- ✅ MIT open source

---

## 1. Dual-Layer Structure Design

### 1.1 Terminology

```
Era   = 1,050,000 Ethereum blocks ≈ 145.8 days ≈ 4.8 months
        → Halving cycle: each new Era halves perBlock

Epoch = 50,000 Ethereum blocks ≈ 6.94 days ≈ 1 week
        → Emission cycle: each Epoch has an independent hard cap

1 Era = 21 Epochs
```

### 1.2 Dual-Layer Relationship Diagram

```
Era 1 (perBlock = 100,000 CLAW)
├── Epoch 1  [block 0 - 49,999]         hard cap: 5 billion CLAW     mining
├── Epoch 2  [block 50K - 99,999]       hard cap: 5 billion CLAW     mining
│   ...
├── Epoch 10 [block 450K - 499,999]     hard cap: 5 billion CLAW     mining
├── Epoch 11-15 [block 500K - 749,999] hard cap: 5 billion/week      mining + nomination
├── Epoch 16-20 [block 750K - 999,999] hard cap: 5 billion/week      mining + voting
└── Epoch 21 [block 1M - 1,049,999]     hard cap: 5 billion CLAW     mining + announcement of results
                                       Era 1 total: 105 billion CLAW

Era 2 (perBlock = 50,000 CLAW)  ← halving!
├── Epoch 22-31  hard cap: 2.5 billion/week   mining
├── Epoch 32-36  hard cap: 2.5 billion/week   mining + nomination
├── Epoch 37-41  hard cap: 2.5 billion/week   mining + voting
└── Epoch 42     hard cap: 2.5 billion        mining + announcement of results
                                       Era 2 total: 52.5 billion CLAW

...and so on, 24 Eras total, 504 Epochs...
```

### 1.3 Why Split Into Two Layers?

**Problem:** In v4.0, one Epoch = 1M blocks ≈ 4.6 months. If many participants join, the Epoch hard cap could be exhausted in the first month, leaving 3.6 months as an idle period — no one can mine.

**Solution:** Reduce the emission granularity to 50K blocks ≈ 1 week. Even if an Epoch's hard cap is quickly exhausted, the idle period lasts only a few days at most. When the next Epoch starts (the following week), a new hard cap takes effect and miners can mine again.

**Miner experience:**

| Model | Idle period experience |
|------|-----------|
| v4.0 (single-layer 4.6 months) | "Epoch exhausted, have to wait months..." 😩 |
| v4.1 (dual-layer 1 week) | "This week's quota is mined out, next Monday there's more!" 😊 |

### 1.4 Core Parameters

| Parameter | Value | Description |
|------|-----|------|
| **Total supply** | 210,000,000,000 CLAW | MAX_SUPPLY |
| **Era length** | 1,050,000 blocks ≈ 145.8 days | Halving cycle |
| **Epoch length** | 50,000 blocks ≈ 6.94 days | Emission cycle |
| **Epochs per Era** | 21 | |
| **First Era per-block output** | 100,000 CLAW | INITIAL_PER_BLOCK |
| **Epoch hard cap** | perBlock × 50,000 | Era 1: 5 billion/epoch |
| **Claim cooldown** | 3,500 blocks ≈ 11.67 hours | Minimum interval between claims per address |
| **Max per address per Epoch** | 14 times | 50,000 ÷ 3,500 = 14 |
| **Seed update** | Once per Epoch | Based on blockhash combination |
| **Halving rule** | Output halves each Era | perBlock >> (era - 1) |
| **Stop condition** | perBlock < 0.01 CLAW | < 10^16 wei |
| **Total Eras** | 24 | Mathematically determined |
| **Total Epochs** | 504 | 24 × 21 |
| **Total mining duration** | ≈ 9.58 years | 25.2M blocks × 12 seconds |

### 1.5 Advantages of Pure Block-Based Timing

The entire contract no longer uses `block.timestamp`; all time logic is entirely based on `block.number`:

| Concept | Old approach | New approach |
|------|--------|--------|
| Era calculation | block.number | block.number (unchanged) |
| Epoch calculation | block.number | block.number (unchanged) |
| Claim frequency | `block.timestamp / 1 days` (5 times/day) | **`lastClaimBlock + 3500`** |
| Seed update | `block.timestamp / 1 days` (daily) | **Per Epoch update (50K blocks)** |

**Why is this better?**

1. **Non-manipulable**: `block.timestamp` allows miners to adjust within ±15 seconds, potentially exploiting boundary conditions. `block.number` is strictly monotonically increasing and cannot be manipulated
2. **Deterministic**: Given startBlock, anyone can precisely calculate which Era and Epoch any block belongs to, and whether an address can claim
3. **Simple**: All contract logic is unified as block arithmetic, no need to convert between two time systems

---

## 2. Complete Emission Schedule

### 2.1 Era Level (Halving Perspective)

| Era | perBlock (CLI) | Epoch hard cap | Era total emission | Cumulative emission | Cumulative years |
|----:|----------------:|-----------:|----------:|---------:|--------:|
| 1 | 100,000 | 5,000,000,000 | 105,000,000,000 | 105,000,000,000 | 0.40 |
| 2 | 50,000 | 2,500,000,000 | 52,500,000,000 | 157,500,000,000 | 0.80 |
| 3 | 25,000 | 1,250,000,000 | 26,250,000,000 | 183,750,000,000 | 1.20 |
| 4 | 12,500 | 625,000,000 | 13,125,000,000 | 196,875,000,000 | 1.60 |
| 5 | 6,250 | 312,500,000 | 6,562,500,000 | 203,437,500,000 | 2.00 |
| 6 | 3,125 | 156,250,000 | 3,281,250,000 | 206,718,750,000 | 2.40 |
| 7 | 1,562.5 | 78,125,000 | 1,640,625,000 | 208,359,375,000 | 2.79 |
| 8 | 781.25 | 39,062,500 | 820,312,500 | 209,179,687,500 | 3.19 |
| 9 | 390.625 | 19,531,250 | 410,156,250 | 209,589,843,750 | 3.59 |
| 10 | 195.3125 | 9,765,625 | 205,078,125 | 209,794,921,875 | 3.99 |
| 11 | 97.65625 | 4,882,812 | 102,539,062 | 209,897,460,937 | 4.39 |
| 12 | 48.828125 | 2,441,406 | 51,269,531 | 209,948,730,468 | 4.79 |
| 13 | 24.414062 | 1,220,703 | 25,634,765 | 209,974,365,234 | 5.19 |
| 14 | 12.207031 | 610,351 | 12,817,382 | 209,987,182,617 | 5.59 |
| 15 | 6.103516 | 305,175 | 6,408,691 | 209,993,591,308 | 5.99 |
| 16 | 3.051758 | 152,587 | 3,204,345 | 209,996,795,654 | 6.39 |
| 17 | 1.525879 | 76,293 | 1,602,172 | 209,998,397,827 | 6.79 |
| 18 | 0.762939 | 38,146 | 801,086 | 209,999,198,913 | 7.19 |
| 19 | 0.38147 | 19,073 | 400,543 | 209,999,599,456 | 7.59 |
| 20 | 0.190735 | 9,536 | 200,271 | 209,999,799,728 | 7.99 |
| 21 | 0.095367 | 4,768 | 100,135 | 209,999,899,864 | 8.38 |
| 22 | 0.047684 | 2,384 | 50,067 | 209,999,949,932 | 8.78 |
| 23 | 0.023842 | 1,192 | 25,033 | 209,999,974,966 | 9.18 |
| 24 | 0.011921 | 596 | 12,516 | 209,999,987,483 | 9.58 |

> **Total: 209,999,987,483 CLAW (12,517 less than 210 billion, accounting for 0.000006%)**

### 2.2 Epoch Level (Era 1 Details)

| Epoch | Block range | Epoch hard cap | Duration | Activity |
|------:|---------|----------:|-----:|-----:|
| 1 | 0 — 49,999 | 5 billion CLAW | 6.94 days | mining |
| 2 | 50,000 — 99,999 | 5 billion CLAW | 6.94 days | mining |
| 3 | 100,000 — 149,999 | 5 billion CLAW | 6.94 days | mining |
| ... | ... | ... | ... | mining |
| 10 | 450,000 — 499,999 | 5 billion CLAW | 6.94 days | mining |
| 11 | 500,000 — 549,999 | 5 billion CLAW | 6.94 days | 🟡 mining + nomination |
| 12 | 550,000 — 599,999 | 5 billion CLAW | 6.94 days | 🟡 mining + nomination |
| ... | ... | ... | ... | 🟡 mining + nomination |
| 15 | 700,000 — 749,999 | 5 billion CLAW | 6.94 days | 🟡 mining + nomination |
| 16 | 750,000 — 799,999 | 5 billion CLAW | 6.94 days | 🟢 mining + voting |
| 17 | 800,000 — 849,999 | 5 billion CLAW | 6.94 days | 🟢 mining + voting |
| ... | ... | ... | ... | 🟢 mining + voting |
| 20 | 950,000 — 999,999 | 5 billion CLAW | 6.94 days | 🟢 mining + voting |
| 21 | 1,000,000 — 1,049,999 | 5 billion CLAW | 6.94 days | 📌 mining + announcement of results |

**Within Era 1, every Epoch has the same hard cap (5 billion CLAW), totaling 105 billion across 21 Epochs.** Upon entering Era 2, each Epoch's hard cap is halved to 2.5 billion, and so on.

Governance timeline: Epoch 1-10 pure mining → Epoch 11-15 nomination phase (~34.7 days) → Epoch 16-20 voting phase (~34.7 days) → Epoch 21 announcement of results (~6.9 days). Mining continues during all phases.

### 2.3 Idle Period Analysis (3500 Block Cooldown)

Under the new cooldown mechanism, a single address can claim at most 14 times per Epoch (50,000 ÷ 3,500 = 14).

Assuming average T = 1,000 → logarithmic bonus ≈ 7.24× → single reward ≈ 723,700 CLAW:

| Active miners | Total claims per Epoch | Total consumed | Ratio to Epoch hard cap | Idle period situation |
|---------:|------------------:|------:|:--------------:|:--------:|
| 100 | 1,400 | 1.01 billion | 0.20× | Will not exhaust |
| 500 | 7,000 | 5.07 billion | 1.01× | Just exhausted, idle ~0 days |
| 1,000 | 14,000 | 10.13 billion | 2.03× | Exhausted in ~3.4 days, idle ~3.5 days |
| 5,000 | 70,000 | 50.66 billion | 10.1× | Exhausted in ~0.7 days, idle ~6.3 days |
| 10,000 | 140,000 | 101.3 billion | 20.3× | Exhausted in ~0.3 days, idle ~6.6 days |

**Key findings:** Compared to the old approach (5 times/day, 35 times per Epoch), the new cooldown mechanism reduces single-address output by 60%. This means:

1. **More distributed allocation**: The same Epoch hard cap requires more miners to participate before exhaustion → fairer
2. **500 miners is the equilibrium point**: With 500 active miners, the Epoch hard cap is just exhausted, with almost no idle period
3. **Idle period does not exceed one week**: Even with extremely high participation, the idle period only affects the current Epoch, automatically resetting the following week

---

## 3. Refactored Contract Code

### 3.1 CLAW_Token.sol

> Identical to v4.0, no modifications needed. MAX_SUPPLY = 210 billion, immutable minter, zero premine.
> Full code in v4.0 documentation section 3.1.

### 3.2 ClawingVerifier.sol

> Identical to v3.0, no modifications needed. SP1 Groth16 verifier does not depend on tokenomics parameters.
> Full code in v3.0 documentation section 4.2.

### 3.3 PoAIWMint.sol (v4.2 — Era Model Governance + On-Chain Voting)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./CLAW_Token.sol";
import "./ClawingVerifier.sol";

/**
 * @title PoAIWMint v4.2 — Proof-of-AI-Work Mining Main Contract + Era Model Governance
 * @author CLAW Community
 * @notice Era/Epoch dual-layer emission + on-chain model governance + lock-up voting
 *
 * @dev
 *   Dual-layer structure + model governance:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Era   = 1,050,000 blocks (halving cycle, ≈ 145.8 days)   │
 *   │  Epoch = 50,000 blocks (emission cycle, ≈ 1 week)          │
 *   │  1 Era = 21 Epochs                                         │
 *   │                                                             │
 *   │  Halving each Era: perBlock = INITIAL >> (era - 1)         │
 *   │  Each Epoch has independent hard cap + independent Seed     │
 *   │  Claim cooldown: 3,500 blocks (≈ 11.67 hours)             │
 *   │  Zero block.timestamp dependency — pure block.number timing │
 *   │                                                             │
 *   │  Era model governance:                                      │
 *   │  - Era 1: hard-coded GPT-5.4                               │
 *   │  - Era N (N>1): decided by Era N-1 voting                  │
 *   │  - Nomination: Epoch 11-15 | Voting: Epoch 16-20           │
 *   │  - Announcement: Epoch 21 | one-token-one-vote, lock-up    │
 *   │    flash-loan protection                                    │
 *   └─────────────────────────────────────────────────────────────┘
 *
 *   Security model:
 *   - Zero trust: all claims must include a valid Groth16 proof
 *   - Replay protection: (address, globalEpoch, claimIndex) tuple globally unique
 *   - Rate-limit protection: 3,500 block cooldown + max 14 times per Epoch
 *   - Anti-whale: R = perBlock × (1 + ln(T)) logarithmic decay
 *   - Flash-loan protection: voting lock-up mechanism
 *   - Fairness: zero premine, zero admin privileges, community voting governance
 *
 *   Gas budget (single mint): ~320k-340k
 */
contract PoAIWMint {

    // ═══════════════════ External Contract References ═══════════════════

    CLAW_Token public immutable token;
    ClawingVerifier public immutable verifier;

    // ═══════════════════ Dual-Layer Emission Parameters ═══════════════════

    uint256 public constant INITIAL_PER_BLOCK = 100_000 * 1e18;
    uint256 public constant BLOCKS_PER_EPOCH = 50_000;
    uint256 public constant EPOCHS_PER_ERA = 21;
    uint256 public constant BLOCKS_PER_ERA = BLOCKS_PER_EPOCH * EPOCHS_PER_ERA; // 1,050,000
    uint256 public constant STOP_THRESHOLD = 1e16;
    uint256 public constant MAX_ERAS = 24;

    uint256 public immutable startBlock;
    mapping(uint256 => uint256) public epochMinted;

    // ═══════════════════ Epoch Seed ═══════════════════

    uint256 public currentSeed;
    uint256 public seedEpoch;

    // ═══════════════════ Claim Cooldown ═══════════════════

    uint256 public constant COOLDOWN_BLOCKS = 3_500;
    mapping(address => uint256) public lastClaimBlock;
    mapping(address => mapping(uint256 => uint256)) public epochClaimCount;
    uint256 public constant MAX_CLAIMS_PER_EPOCH = 14;

    // ═══════════════════ Era Model Governance ═══════════════════

    /// @notice Nomination starts at which Epoch within the Era (1-indexed)
    uint256 public constant NOMINATION_START_EPOCH_IN_ERA = 11;

    /// @notice Voting starts at which Epoch within the Era (1-indexed)
    uint256 public constant VOTING_START_EPOCH_IN_ERA = 16;

    /// @notice Announcement Epoch (last Epoch within an Era)
    uint256 public constant ANNOUNCEMENT_EPOCH_IN_ERA = 21;

    /// @notice Maximum number of candidate models per Era
    uint256 public constant MAX_CANDIDATES_PER_ERA = 20;

    /// @notice Designated model per Era: era => keccak256(modelId)
    mapping(uint256 => bytes32) public eraModel;

    /// @notice Candidate list: era => modelHash[]
    mapping(uint256 => bytes32[]) internal _candidates;

    /// @notice Whether already nominated: era => modelHash => bool
    mapping(uint256 => mapping(bytes32 => bool)) public isCandidate;

    /// @notice Addresses that have nominated: era => address => bool
    mapping(uint256 => mapping(address => bool)) public hasProposed;

    /// @notice Vote statistics: era => modelHash => totalVotes
    mapping(uint256 => mapping(bytes32 => uint256)) public modelVotes;

    /// @notice Voter choice: era => address => modelHash
    mapping(uint256 => mapping(address => bytes32)) public voterChoice;

    /// @notice Voter lock-up amount: era => address => amount
    mapping(uint256 => mapping(address => uint256)) public voterAmount;

    /// @notice Whether Era model has been finalized
    mapping(uint256 => bool) public eraModelFinalized;

    // ═══════════════════ Statistics ═══════════════════

    uint256 public totalClaims;

    // ═══════════════════ Events ═══════════════════

    event Mined(
        address indexed miner,
        uint256 reward,
        uint256 totalTokensSpent,
        uint256 indexed era,
        uint256 indexed globalEpoch,
        uint256 claimIndex
    );
    event SeedUpdated(uint256 indexed globalEpoch, uint256 seed);
    event ModelProposed(uint256 indexed era, bytes32 indexed modelHash, string modelId, address proposer);
    event Voted(uint256 indexed era, bytes32 indexed modelHash, address indexed voter, uint256 amount);
    event EraModelFinalized(uint256 indexed era, bytes32 indexed modelHash);
    event VoteWithdrawn(uint256 indexed era, address indexed voter, uint256 amount);

    // ═══════════════════ Errors ═══════════════════

    error AddressMismatch();
    error ModelNotApproved();
    error TokensMustBePositive();
    error CooldownNotMet();
    error EpochClaimLimitReached();
    error WrongSeedEpoch();
    error WrongSeed();
    error AlreadyClaimed();
    error EpochExhausted();
    error MiningEnded();
    error InvalidProof();
    error SeedAlreadySet();
    error NotInNominationWindow();
    error NotInVotingWindow();
    error AlreadyProposed();
    error CandidatesFull();
    error ModelAlreadyProposed();
    error NotACandidate();
    error CannotChangeVote();
    error AmountZero();
    error EraNotEnded();
    error AlreadyFinalized();
    error NothingToWithdraw();
    error EraModelNotSet();

    constructor(address _token, address _verifier) {
        token = CLAW_Token(_token);
        verifier = ClawingVerifier(_verifier);
        startBlock = block.number;

        // Era 1 hard-coded GPT-5.4
        eraModel[1] = keccak256("grok-4.1-fast");
        eraModelFinalized[1] = true;
    }

    // ═══════════════════════════════════════════════════════
    //              Era / Epoch Calculation (Pure Math, Zero Storage)
    // ═══════════════════════════════════════════════════════

    function _blocksSinceStart() internal view returns (uint256) {
        return block.number - startBlock;
    }

    function currentEra() public view returns (uint256) {
        return _blocksSinceStart() / BLOCKS_PER_ERA + 1;
    }

    function currentGlobalEpoch() public view returns (uint256) {
        return _blocksSinceStart() / BLOCKS_PER_EPOCH + 1;
    }

    /// @notice Current Epoch position within the Era (1-21)
    function _epochInEra() internal view returns (uint256) {
        return (_blocksSinceStart() % BLOCKS_PER_ERA) / BLOCKS_PER_EPOCH + 1;
    }

    function perBlockForEra(uint256 era) public pure returns (uint256) {
        if (era == 0 || era > MAX_ERAS) return 0;
        return INITIAL_PER_BLOCK >> (era - 1);
    }

    function epochCap(uint256 globalEpoch) public pure returns (uint256) {
        uint256 era = (globalEpoch - 1) / EPOCHS_PER_ERA + 1;
        return perBlockForEra(era) * BLOCKS_PER_EPOCH;
    }

    // ═══════════════════════════════════════════════════════
    //                    Core Mining Function
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Submit ZK proof and mint CLAW
     * @param proof Groth16 proof (SP1 generated, 8 uint256)
     * @param publicInputs Public inputs:
     *   [0] modelHash     — keccak256(model ID string, e.g. "grok-4.1-fast")
     *   [1] totalTokens   — Number of LLM tokens consumed T
     *   [2] seedEpoch     — Global Epoch number corresponding to the Seed
     *   [3] seed          — Epoch Seed
     *   [4] minerAddress  — Miner address (as uint256)
     *   [5] claimIndex    — The nth claim by this address in this Epoch (0-based)
     */
    function mint(
        uint256[8] calldata proof,
        uint256[6] calldata publicInputs
    ) external {
        // ─── 0. Has mining ended? ───
        uint256 era = currentEra();
        if (era > MAX_ERAS) revert MiningEnded();

        uint256 gEpoch = currentGlobalEpoch();

        // ─── 1. Unpack public inputs ───
        bytes32 modelHash = bytes32(publicInputs[0]);
        uint256 totalTokens = publicInputs[1];
        uint256 claimSeedEpoch = publicInputs[2];
        uint256 claimSeed = publicInputs[3];
        address minerAddr = address(uint160(publicInputs[4]));
        uint256 claimIndex = publicInputs[5];

        // ─── 2. Basic validation ───
        if (minerAddr != msg.sender) revert AddressMismatch();
        if (eraModel[era] == bytes32(0)) revert EraModelNotSet();
        if (modelHash != eraModel[era]) revert ModelNotApproved();
        if (totalTokens == 0) revert TokensMustBePositive();

        // ─── 3. Cooldown check (3,500 blocks) ───
        if (lastClaimBlock[msg.sender] + COOLDOWN_BLOCKS > block.number) {
            revert CooldownNotMet();
        }

        // ─── 4. Epoch claim count check ───
        uint256 currentCount = epochClaimCount[msg.sender][gEpoch];
        if (currentCount >= MAX_CLAIMS_PER_EPOCH) revert EpochClaimLimitReached();
        if (claimIndex != currentCount) revert AlreadyClaimed();

        // ─── 5. Epoch Seed validation ───
        if (claimSeedEpoch != seedEpoch) revert WrongSeedEpoch();
        if (claimSeed != currentSeed) revert WrongSeed();
        if (seedEpoch != gEpoch) revert WrongSeedEpoch();

        // ─── 6. ZK proof verification (~270k gas) ───
        bool valid = verifier.verify(proof, publicInputs);
        if (!valid) revert InvalidProof();

        // ─── 7. Calculate reward (~40 gas) ───
        uint256 base = perBlockForEra(era);
        uint256 reward = _calculateReward(totalTokens, base);

        // ─── 8. Epoch hard cap check ───
        uint256 cap = epochCap(gEpoch);
        if (epochMinted[gEpoch] + reward > cap) {
            reward = cap - epochMinted[gEpoch];
            if (reward == 0) revert EpochExhausted();
        }

        // ─── 9. State update ───
        lastClaimBlock[msg.sender] = block.number;
        unchecked {
            epochClaimCount[msg.sender][gEpoch]++;
            epochMinted[gEpoch] += reward;
            totalClaims++;
        }

        // ─── 10. Mint tokens ───
        token.mint(msg.sender, reward);

        emit Mined(msg.sender, reward, totalTokens, era, gEpoch, claimIndex);
    }

    // ═══════════════════════════════════════════════════════
    //                Era Model Governance
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Nominate a candidate model (only open during Epoch 11-15)
     * @param modelId Model ID string, e.g. "grok-4.1-fast", "claude-opus-5"
     */
    function proposeModel(string calldata modelId) external {
        uint256 era = currentEra();
        if (era > MAX_ERAS) revert MiningEnded();

        uint256 eInEra = _epochInEra();
        if (eInEra < NOMINATION_START_EPOCH_IN_ERA || eInEra >= VOTING_START_EPOCH_IN_ERA) {
            revert NotInNominationWindow();
        }

        if (hasProposed[era][msg.sender]) revert AlreadyProposed();

        bytes32 mHash = keccak256(bytes(modelId));
        if (isCandidate[era][mHash]) revert ModelAlreadyProposed();
        if (_candidates[era].length >= MAX_CANDIDATES_PER_ERA) revert CandidatesFull();

        _candidates[era].push(mHash);
        isCandidate[era][mHash] = true;
        hasProposed[era][msg.sender] = true;

        emit ModelProposed(era, mHash, modelId, msg.sender);
    }

    /**
     * @notice Vote: lock CLAW tokens to vote for a candidate model (only open during Epoch 16-20)
     * @param modelHash keccak256 hash of the candidate model
     * @param amount Voting amount (i.e. lock-up amount, 1 CLAW = 1 vote)
     */
    function vote(bytes32 modelHash, uint256 amount) external {
        uint256 era = currentEra();
        if (era > MAX_ERAS) revert MiningEnded();

        uint256 eInEra = _epochInEra();
        if (eInEra < VOTING_START_EPOCH_IN_ERA || eInEra >= ANNOUNCEMENT_EPOCH_IN_ERA) {
            revert NotInVotingWindow();
        }

        if (!isCandidate[era][modelHash]) revert NotACandidate();
        if (amount == 0) revert AmountZero();

        // Check if already voted for a different model
        bytes32 prev = voterChoice[era][msg.sender];
        if (prev != bytes32(0) && prev != modelHash) revert CannotChangeVote();

        // Lock tokens into contract
        token.transferFrom(msg.sender, address(this), amount);

        voterChoice[era][msg.sender] = modelHash;
        voterAmount[era][msg.sender] += amount;
        modelVotes[era][modelHash] += amount;

        emit Voted(era, modelHash, msg.sender, amount);
    }

    /**
     * @notice Tally: determine voting results for a given Era, set the model for the next Era
     * @param votingEra The Era in which voting occurred
     * @dev Can only be called during votingEra's Epoch 21 (announcement phase) or after the Era ends
     */
    function finalizeEraModel(uint256 votingEra) external {
        uint256 targetEra = votingEra + 1;
        // Allow calling during announcement Epoch (Epoch 21) or after Era ends
        if (currentEra() == votingEra && _epochInEra() < ANNOUNCEMENT_EPOCH_IN_ERA) {
            revert EraNotEnded(); // Not yet in announcement phase
        }
        if (eraModelFinalized[targetEra]) revert AlreadyFinalized();

        bytes32[] storage cands = _candidates[votingEra];
        bytes32 winner = bytes32(0);
        uint256 maxVotes = 0;

        for (uint256 i = 0; i < cands.length; i++) {
            uint256 v = modelVotes[votingEra][cands[i]];
            if (v > maxVotes) {
                maxVotes = v;
                winner = cands[i];
            }
            // In case of tie, keep the first one (smaller index = nominated earlier)
        }

        if (winner == bytes32(0)) {
            // No votes or no candidates — carry over the previous Era's model
            winner = eraModel[votingEra];
        }

        eraModel[targetEra] = winner;
        eraModelFinalized[targetEra] = true;

        emit EraModelFinalized(targetEra, winner);
    }

    /**
     * @notice Withdraw vote-locked tokens (only during announcement phase Epoch 21 or after Era ends)
     * @param votingEra The Era in which voting occurred
     */
    function withdrawVote(uint256 votingEra) external {
        // Allow withdrawal during announcement Epoch (Epoch 21) or after Era ends
        if (currentEra() == votingEra && _epochInEra() < ANNOUNCEMENT_EPOCH_IN_ERA) {
            revert EraNotEnded();
        }

        uint256 amount = voterAmount[votingEra][msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        voterAmount[votingEra][msg.sender] = 0;
        token.transfer(msg.sender, amount);

        emit VoteWithdrawn(votingEra, msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════
    //                   Epoch Seed Management
    // ═══════════════════════════════════════════════════════

    function updateSeed() external {
        uint256 gEpoch = currentGlobalEpoch();
        if (gEpoch <= seedEpoch) revert SeedAlreadySet();

        currentSeed = uint256(keccak256(abi.encodePacked(
            blockhash(block.number - 1),
            blockhash(block.number - 2),
            blockhash(block.number - 3),
            block.prevrandao
        )));

        seedEpoch = gEpoch;
        emit SeedUpdated(gEpoch, currentSeed);
    }

    // ═══════════════════════════════════════════════════════
    //                  MSB Bitwise Operation Logarithm Calculation
    // ═══════════════════════════════════════════════════════

    function _msb(uint256 x) internal pure returns (uint256 r) {
        assembly {
            let f := shl(7, gt(x, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF))
            r := f
            x := shr(f, x)

            f := shl(6, gt(x, 0xFFFFFFFFFFFFFFFF))
            r := or(r, f)
            x := shr(f, x)

            f := shl(5, gt(x, 0xFFFFFFFF))
            r := or(r, f)
            x := shr(f, x)

            f := shl(4, gt(x, 0xFFFF))
            r := or(r, f)
            x := shr(f, x)

            f := shl(3, gt(x, 0xFF))
            r := or(r, f)
            x := shr(f, x)

            f := shl(2, gt(x, 0xF))
            r := or(r, f)
            x := shr(f, x)

            f := shl(1, gt(x, 0x3))
            r := or(r, f)
            x := shr(f, x)

            f := gt(x, 0x1)
            r := or(r, f)
        }
    }

    function _calculateReward(
        uint256 totalTokens,
        uint256 base
    ) internal pure returns (uint256) {
        uint256 log2T = _msb(totalTokens);
        return base * (1000 + log2T * 693) / 1000;
    }

    // ═══════════════════════════════════════════════════════
    //                   View Functions (Free)
    // ═══════════════════════════════════════════════════════

    function miningEnded() external view returns (bool) {
        return currentEra() > MAX_ERAS;
    }

    function estimateReward(uint256 totalTokens) external view returns (uint256) {
        uint256 era = currentEra();
        if (era > MAX_ERAS) return 0;
        return _calculateReward(totalTokens, perBlockForEra(era));
    }

    function cooldownRemaining(address miner) external view returns (uint256) {
        uint256 last = lastClaimBlock[miner];
        if (last == 0) return 0;
        uint256 ready = last + COOLDOWN_BLOCKS;
        if (block.number >= ready) return 0;
        return ready - block.number;
    }

    function remainingClaims(address miner) external view returns (uint256) {
        uint256 gEpoch = currentGlobalEpoch();
        uint256 used = epochClaimCount[miner][gEpoch];
        if (used >= MAX_CLAIMS_PER_EPOCH) return 0;
        return MAX_CLAIMS_PER_EPOCH - used;
    }

    function epochRemaining() external view returns (uint256) {
        uint256 gEpoch = currentGlobalEpoch();
        uint256 era = currentEra();
        if (era > MAX_ERAS) return 0;
        uint256 cap = epochCap(gEpoch);
        uint256 minted = epochMinted[gEpoch];
        if (minted >= cap) return 0;
        return cap - minted;
    }

    function getCurrentPerBlock() external view returns (uint256) {
        uint256 era = currentEra();
        if (era > MAX_ERAS) return 0;
        return perBlockForEra(era);
    }

    function epochInEra() external view returns (uint256) {
        return _epochInEra();
    }

    function blocksUntilNextEpoch() external view returns (uint256) {
        uint256 blocksIntoEpoch = _blocksSinceStart() % BLOCKS_PER_EPOCH;
        return BLOCKS_PER_EPOCH - blocksIntoEpoch;
    }

    function miningProgress() external view returns (uint256 progressBps) {
        uint256 totalMinted = token.totalMinted();
        progressBps = totalMinted / (210_000_000_000 * 1e18 / 10000);
    }

    /// @notice Query the number of candidate models for a given Era
    function candidateCount(uint256 era) external view returns (uint256) {
        return _candidates[era].length;
    }

    /// @notice Query the i-th candidate model hash for a given Era
    function candidateAt(uint256 era, uint256 index) external view returns (bytes32) {
        return _candidates[era][index];
    }

    /// @notice Whether currently in the nomination window
    function isNominationOpen() external view returns (bool) {
        uint256 eInEra = _epochInEra();
        return eInEra >= NOMINATION_START_EPOCH_IN_ERA && eInEra < VOTING_START_EPOCH_IN_ERA;
    }

    /// @notice Whether currently in the voting window
    function isVotingOpen() external view returns (bool) {
        uint256 eInEra = _epochInEra();
        return eInEra >= VOTING_START_EPOCH_IN_ERA && eInEra < ANNOUNCEMENT_EPOCH_IN_ERA;
    }

    /// @notice Whether currently in the announcement window (Epoch 21)
    function isAnnouncementPhase() external view returns (bool) {
        return _epochInEra() == ANNOUNCEMENT_EPOCH_IN_ERA;
    }

    /// @notice Query the designated model for a given Era
    function getEraModel(uint256 era) external view returns (bytes32) {
        return eraModel[era];
    }
}
```

## 4. v4.1 → v4.2 Contract Change Comparison

| Change | v4.1 | v4.2 |
|--------|------|------|
| **Model verification** | `approvedDomains[domainHash]` global whitelist | **`eraModel[era] == modelHash` single model per Era** |
| **publicInputs[0]** | `domainHash` (API domain hash) | **`modelHash` (model ID hash)** |
| **Governance mechanism** | None (hard-coded whitelist) | **On-chain voting: nomination + voting + tally** |
| **Era 1 model** | 5 domains allowed simultaneously | **Hard-coded GPT-5.4 single model** |
| **Era N model** | Same as Era 1 | **Decided by Era N-1 on-chain voting** |
| **Voting window** | None | **Ep 11-15 nomination, Ep 16-20 voting, Ep 21 announcement** |
| **Voting rights** | None | **1 CLAW = 1 vote, tokens locked into contract** |
| **New constants** | — | `NOMINATION_START_EPOCH_IN_ERA=11`, `VOTING_START_EPOCH_IN_ERA=16`, `ANNOUNCEMENT_EPOCH_IN_ERA=21`, `MAX_CANDIDATES_PER_ERA=20` |
| **New functions** | — | `proposeModel()`, `vote()`, `finalizeEraModel()`, `withdrawVote()` |
| **New views** | — | `candidateCount()`, `candidateAt()`, `isNominationOpen()`, `isVotingOpen()`, `isAnnouncementPhase()`, `getEraModel()` |
| **New Events** | — | `ModelProposed`, `Voted`, `EraModelFinalized`, `VoteWithdrawn` |
| **New Errors** | — | `ModelNotApproved`, `EraModelNotSet`, `NotInNominationWindow`, `NotInVotingWindow`, etc. |
| **Removed** | `approvedDomains` mapping, `DomainNotApproved` error | — |
| **Constructor** | Initialize 5 API domains | **Set `eraModel[1] = keccak256("grok-4.1-fast")`** |
| **mint() Gas** | ~320k-340k | **~320k-340k (unchanged)** |
| **CLAW_Token** | No changes | No changes |
| **ClawingVerifier** | No changes | No changes |

---

## 5. Key Design Decisions

### 5.1 Why Epoch Hard Cap = perBlock × 50,000 Instead of EraCap / 21?

The two are mathematically equivalent:

$$\frac{EraCap}{21} = \frac{perBlock \times 1{,}050{,}000}{21} = perBlock \times 50{,}000$$

But in contract implementation, `perBlock × BLOCKS_PER_EPOCH` is more direct — it only requires knowing the current Era's perBlock, no extra division needed.

### 5.2 Why Use globalEpoch Instead of (era, epochInEra) as the epochMinted Key?

Two approaches:
- `epochMinted[era][epochInEra]` — requires nested mapping, two SLOADs
- `epochMinted[globalEpoch]` — single-layer mapping, one SLOAD

Choosing the latter saves ~2,100 gas per call and avoids the complexity of nested mappings. Computing globalEpoch requires only one division.

### 5.3 Why Use 3,500 Block Cooldown Instead of “5 Times Per Day”?

The old approach used `block.timestamp / 1 days` to calculate “today”, which had two problems:

1. **Timestamp is manipulable**: Miners can adjust timestamp within ±15 seconds, potentially double-claiming at the UTC 0:00 boundary
2. **Incompatible with pure block-based timing**: Era/Epoch uses `block.number`, Claim frequency uses `block.timestamp`, two time systems coexisting increases complexity

Advantages of the new approach `lastClaimBlock + 3500`:

- **Fully deterministic**: Given the current `block.number` and `lastClaimBlock`, anyone can precisely calculate whether a claim is possible
- **More distributed allocation**: Single-address output reduced by 60%, the same Epoch hard cap requires more miners to participate before exhaustion
- **Unified time model**: Zero `block.timestamp` dependency within the contract, reducing audit complexity

### 5.4 Why Change Seed to Per-Epoch Update Instead of Daily?

Daily Seed relied on `block.timestamp / 1 days`, which was the last timestamp contamination source in the contract. After switching to Epoch Seed:

1. **Complete timestamp elimination**: Seed is triggered based on `currentGlobalEpoch()` (i.e., `block.number`), zero `block.timestamp` usage in the contract
2. **Simpler client logic**: No need to track UTC midnight, just listen for the `SeedUpdated` event to start mining in the new Epoch
3. **Natural alignment with hard cap**: Both Seed and hard cap operate on Epoch cycles, stronger logical consistency
4. **Minimal familiarity impact**: In Epoch Seed mode, all claims within an Epoch share the same Seed, miners only need to fetch it once for the whole week

### 5.5 Why Designate Only One Model Per Era Instead of a Whitelist?

v4.1 used a global `approvedDomains` whitelist, allowing 5 API domains. Problems:

1. **No community governance**: The whitelist was hard-coded in the constructor, immutable
2. **Insufficient model granularity**: Domain-level cannot distinguish different models from the same provider
3. **Cannot adapt to changes**: AI models iterate extremely fast, hard-coding cannot keep up

Advantages of the new approach “single model per Era + on-chain voting”:

1. **Community self-governance**: Token holders decide which model to use, not developers
2. **Precise to model ID**: zkTLS verifies the specific model name, not the domain
3. **Adaptive**: Can switch to a new model every ~4.8 months, keeping up with AI iteration pace
4. **Discussion catalyst**: “Which model for the next Era?” becomes a hot community topic, enhancing virality
5. **Single model simplicity**: The contract only needs to store one `bytes32`, no need to iterate a whitelist

### 5.6 Why Is an On-Chain Model Registry Not Needed?

A natural question: after switching models each Era, does the miner client code need to be updated every time? Is an on-chain registry needed to restrict the candidate pool?

**The answer is no.** Key design decision: all candidate models must comply with the **OpenAI-compatible API format** (i.e., the `/v1/chat/completions` standard interface).

This means miner client code is universal and **never needs to be updated due to model switches**:

```
Miner client operations during Era switch:
1. Read eraModel[currentEra()] → get modelHash
2. Look up modelHash from on-chain ModelProposed events → get modelId string (e.g. "grok-4.1-fast")
3. Enter API endpoint + API key in the Clawing configuration wizard
4. Client calls using unified format: POST /v1/chat/completions, body.model = "grok-4.1-fast"
5. TLSNotary verifies "model": "grok-4.1-fast" in the response → generate ZK proof → submit on-chain
```

**Why does this work?**

Virtually all current mainstream AI models support OpenAI-compatible format:

| Provider | Compatibility |
|------|----------|
| OpenAI | Native |
| Anthropic | Via compatibility layer or SDK adapter |
| Google Gemini | Provides OpenAI-compatible endpoint |
| DeepSeek | Natively compatible |
| xAI Grok | Natively compatible |
| Open-source models (vLLM/Ollama) | Natively compatible |

**Benefits of not needing a registry:**

1. **Zero admin privileges**: No one controls the candidate list, fully decentralized
2. **Client never expires**: API format is standardized, just switch endpoint + model parameter
3. **Community self-correction**: Nominating a nonexistent model will get no votes, naturally eliminated
4. **Contract simplicity**: No need for extra registry storage and governance logic

### 5.7 Is the Idle Period a Bug or a Feature?

**Feature.** The existence of idle periods means:

1. **Demand signal**: Hard cap quickly exhausted = strong CLAW demand = bullish
2. **Natural regulation**: Idle periods reduce short-term supply → scarcity → price support
3. **Fairness**: Everyone faces the same hard cap, no one has privileges
4. **Predictability**: Miners know "there will definitely be new tokens next week", no despair

This is much better than v4.0's "potentially months-long idle period" — weekly-level idle periods are psychologically acceptable.

---

## 6. Era Model Governance — On-Chain Model Governance

### 6.1 Core Rules

```
Era 1:  Hard-coded GPT-5.4 (set in constructor, immutable)
Era N:  Decided by Era N-1 on-chain voting results (one-token-one-vote)
```

Each Era has only one designated model. Miners must use the current Era's designated model to call the API; the `modelHash` included in the zkTLS proof must exactly match the `eraModel[era]` stored in the contract.

### 6.2 Timeline

```
Era N (1,050,000 blocks = 21 Epochs)
├── Epoch 1-10  [block 0 - 499,999]           → Normal mining (~69.4 days)
├── Epoch 11-15 [block 500K - 749,999]       → 🟡 Mining + nomination phase (~34.7 days)
│   └─ Token holders nominate candidate models (proposeModel)
├── Epoch 16-20 [block 750K - 999,999]       → 🟢 Mining + voting phase (~34.7 days)
│   └─ Lock-up voting (vote)
├── Epoch 21    [block 1M - 1,049,999]       → 📌 Mining + announcement of results (~6.9 days)
│   └─ Anyone calls finalizeEraModel() to tally votes
│   └─ Voters call withdrawVote() to withdraw tokens
└── Mining never stops: miners can claim normally during all phases
```

**Note**: During nomination, voting, and announcement windows, mining proceeds normally. Governance is an additional activity that does not affect the mining process. The announcement phase (Epoch 21) is a dedicated result confirmation window, giving the community sufficient time to confirm and prepare the model configuration for the new Era.

### 6.3 Nomination Phase (Epoch 11-15)

| Rule | Description |
|------|------|
| **Who can nominate** | Any address holding CLAW |
| **Nomination method** | Call `proposeModel(string calldata modelId)` |
| **Nomination limit** | Each address can nominate only 1 model per Era |
| **Candidate cap** | Max 20 candidate models per Era |
| **Cost** | No staking required, only Gas consumed |
| **Time window** | Epoch 11-15 within the Era (blocks 500,000 - 749,999, ~34.7 days) |

The nomination function stores the `keccak256` hash of the model ID string as a candidate. For example, `proposeModel("grok-4.1-fast")` adds `keccak256("grok-4.1-fast")` to the candidate list.

**Constraint**: Candidate models must support the OpenAI-compatible API format (`/v1/chat/completions`). This is not enforced at the contract level (the contract cannot verify API compatibility), but rather a community consensus — nominating an incompatible model means miners cannot call it, so it naturally will not receive votes.

### 6.4 Voting Phase (Epoch 16-20)

| Rule | Description |
|------|------|
| **Voting method** | `vote(bytes32 modelHash, uint256 amount)` |
| **Voting rights** | 1 CLAW = 1 vote, tokens locked into contract |
| **Prerequisites** | Must first call `token.approve(PoAIWMint, amount)` |
| **Voting limit** | Each address can only vote for one model per Era, can add more amount in multiple transactions |
| **Time window** | Epoch 16-20 within the Era (blocks 750,000 - 999,999, ~34.7 days) |

**Voting lock-up mechanism**:

```
Miner A holds 10,000 CLAW
  │
  ├─ approve(PoAIWMint, 8000)   ← Authorize contract to transfer 8000 CLAW
  ├─ vote(modelHash, 5000)     ← 5000 CLAW locked into contract, voting for model X
  ├─ vote(modelHash, 3000)     ← Add 3000 CLAW, total 8000 votes for model X
  │
  └─ After Epoch 21 (announcement phase) begins:
     └─ withdrawVote(eraOfVote)  ← Withdraw 8000 CLAW
```

### 6.5 Announcement and Vote Counting (Epoch 21)

| Rule | Description |
|------|------|
| **Announcement window** | Epoch 21 within the Era (blocks 1,000,000 - 1,049,999, ~6.9 days) |
| **Tally trigger** | After Epoch 21 begins, anyone calls `finalizeEraModel(uint256 votingEra)` |
| **Winning rule** | The model with the most votes wins |
| **Tie-breaking** | In case of equal votes, the model nominated first wins (smaller proposalIndex) |
| **Zero votes** | If no one votes, the previous Era's model carries over |
| **Effective time** | Takes effect immediately after tally, miners in the new Era must use the new model |
| **Token withdrawal** | After Epoch 21 begins, voters can call `withdrawVote()` to retrieve locked tokens |
| **Delayed tally** | If no one calls finalize after the new Era starts, miners cannot claim (because eraModel is not set) |
| **Incentive** | The first person to call finalize can be the first to start mining in the new Era |

**Why is the Epoch 21 announcement phase needed?**

A ~6.9-day announcement window is reserved between the end of voting (end of Epoch 20) and the start of the new Era, giving the community time to:
1. Confirm voting results and call `finalizeEraModel()`
2. Pre-configure the new model's API endpoint and API key
3. Voters withdraw locked tokens
4. Miner clients prepare for smooth transition to the new model

### 6.6 Anti-Gaming Design

| Attack vector | Defense measure |
|----------|----------|
| **Flash-loan attack** | Tokens locked in contract until new Era starts; flash loans must repay in the same block, cannot attack |
| **Duplicate voting** | Each address can only vote for one model per Era, enforced by contract |
| **Spam nominations** | Max 20 candidates per Era, low-vote candidates naturally eliminated |
| **Vote buying/manipulation** | Tokens are actually locked, voting cost = capital opportunity cost (max ~41.6-day lock period, from Ep 16 voting start to Ep 21 withdrawal) |
| **Vote rigging** | One-token-one-vote, weighted by holdings; large holders have more influence but must vote with real capital |
| **Tally delay** | Miners unable to claim creates natural incentive; someone will call finalize ASAP |

### 6.7 Storage Structure

```solidity
// === Era Model Governance ===

// Designated model per Era: era => keccak256(modelId)
mapping(uint256 => bytes32) public eraModel;

// Candidate list: era => candidate model hash array
mapping(uint256 => bytes32[]) internal _candidates;

// Whether already nominated: era => modelHash => bool
mapping(uint256 => mapping(bytes32 => bool)) public isCandidate;

// Addresses that have nominated: era => address => bool
mapping(uint256 => mapping(address => bool)) public hasProposed;

// Vote statistics: era => modelHash => total votes
mapping(uint256 => mapping(bytes32 => uint256)) public modelVotes;

// Voter choice: era => address => modelHash
mapping(uint256 => mapping(address => bytes32)) public voterChoice;

// Voter lock-up amount: era => address => amount
mapping(uint256 => mapping(address => uint256)) public voterAmount;

// Whether Era model has been finalized
mapping(uint256 => bool) public eraModelFinalized;
```

### 6.8 Key Constants

```solidity
uint256 constant NOMINATION_START_EPOCH_IN_ERA = 11;   // Nomination starts at Epoch 11
uint256 constant VOTING_START_EPOCH_IN_ERA = 16;        // Voting starts at Epoch 16
uint256 constant ANNOUNCEMENT_EPOCH_IN_ERA = 21;        // Announcement of results at Epoch 21
uint256 constant MAX_CANDIDATES_PER_ERA = 20;            // Max 20 candidates per Era
```

### 6.9 Changes to zkTLS Proofs

| Field | v4.1 (old) | v4.2 (new) |
|------|----------|----------|
| publicInputs[0] | `domainHash` — keccak256(API domain) | **`modelHash` — keccak256(model ID string)** |
| zkTLS verification content | Target domain of TLS connection | **`model` field in the API response** |
| Contract validation | `approvedDomains[domainHash]` | **`eraModel[era] == modelHash`** |

TLSNotary's selective disclosure capability supports extracting and verifying the `model` field from JSON responses. Since all candidate models use the OpenAI-compatible API format, the response structure is standardized as:

```json
{
  "id": "chatcmpl-...",
  "model": "grok-4.1-fast",        // ← TLSNotary extracts this field
  "choices": [...],
  "usage": {
    "total_tokens": 1523     // ← TLSNotary extracts this field
  }
}
```

The ZK proof's public inputs contain `keccak256(model)` as the `modelHash`, and the contract validates that it matches `eraModel[era]`. Since the response format is standardized, TLSNotary's extraction logic is universal for all models, requiring no provider-specific adaptations.

### 6.10 Gas Impact

| Operation | Estimated Gas | Description |
|------|----------|------|
| `proposeModel()` | ~60k-80k | Storage writes + array push |
| `vote()` | ~80k-100k | transferFrom + storage writes |
| `finalizeEraModel()` | ~50k-200k | Iterates candidate list, depends on candidate count |
| `withdrawVote()` | ~40k-60k | transfer + storage clearing |
| `mint()` change | ≈ 0 | Removed approvedDomains lookup (-2.1k), added eraModel lookup (+2.1k) |

Mining Gas itself remains unchanged (~320k-340k). Voting is an additional transaction, only needed once per Era.

### 6.11 Miner Client Flow (Model Switching)

The miner client uses the OpenAI-compatible API standard format. When switching models, **no code updates are needed** — just switch the configuration:

```
New Era begins → Miner client automatic flow:

┌───────────────────────────────────────────────┐
│  1. Read contract eraModel[currentEra()]      │
│     → get modelHash (bytes32)                  │
│                                                 │
│  2. Query on-chain ModelProposed events        │
│     → reverse lookup modelHash → modelId string│
│     → e.g. "claude-opus-5"                     │
│                                                 │
│  3. Clawing config wizard prompts miner to     │
│     enter:                                      │
│     → API Endpoint (https://api.anthropic.com) │
│     → API Key                                   │
│                                                 │
│  4. Unified call format (no code changes):     │
│     POST /v1/chat/completions                   │
│     {                                            │
│       "model": "claude-opus-5",                  │
│       "messages": [{...}]                        │
│     }                                            │
│                                                 │
│  5. TLSNotary selective disclosure:             │
│     → Extract "model" field from response JSON  │
│     → Verify model == "claude-opus-5"            │
│     → Compute keccak256("claude-opus-5")         │
│     → Match against contract eraModel[era] ✓    │
│                                                 │
│  6. Generate ZK proof → mint()                  │
└───────────────────────────────────────────────┘
```

Key point: The call format in step 4 is identical for all models — only the `model` parameter and endpoint URL differ. This is the value of a standardized API format — the miner client code can achieve "develop once, run forever".

---

## 7. Version Evolution Diagram

```
v1.0 (Oracle model, 21B)
 │
 ▼
v2.0 (zkTLS model, 21B)
 │
 ▼
v3.0 (Production-grade architecture, 21B)
 │  - MSB bitwise operation (~30 gas)
 │  - SP1 Groth16 (~270k gas)
 │  - Three-contract decoupled architecture
 │
 ▼
v4.0 (200B economics, single-layer Epoch)
 │  - 200B total supply (v4.0 era), 24 Epoch halving
 │  - Block-level emission
 │  - Problem: idle period could last months
 │
 ▼
v4.1 (Era/Epoch dual-layer + pure block-based timing)
    - Era (1.05M blocks) = halving cycle
    - Epoch (50K blocks ≈ 1 week) = emission cycle
    - 210 billion total supply, 24 Era, 504 Epoch
    - 3,500 block cooldown (14 times per Epoch)
    - Epoch Seed (zero timestamp dependency)
    - Idle period shortened to a few days at most
 |
 ▼
v4.2 (Era Model Governance + on-chain voting) ← this document
    - Single model per Era: Era 1 = GPT-5.4
    - On-chain voting: Ep 11-15 nomination + Ep 16-20 voting + Ep 21 announcement
    - One-token-one-vote, lock-up flash-loan protection
    - domainHash → modelHash
    - Community self-governance: vote for the next model each Era
```

---

## 8. Appendix: Solidity Constants Quick Reference

```solidity
// ═══ Dual-Layer Structure ═══
uint256 constant INITIAL_PER_BLOCK    = 100_000 * 1e18;
uint256 constant BLOCKS_PER_EPOCH     = 50_000;          // ≈ 6.94 days
uint256 constant EPOCHS_PER_ERA       = 21;
uint256 constant BLOCKS_PER_ERA       = 1_050_000;       // ≈ 145.8 days
uint256 constant MAX_ERAS             = 24;

// ═══ Claim Cooldown ═══
uint256 constant COOLDOWN_BLOCKS      = 3_500;           // ≈ 11.67 hours
uint256 constant MAX_CLAIMS_PER_EPOCH = 14;              // 50,000 / 3,500

// ═══ Total Supply ═══
uint256 constant MAX_SUPPLY           = 210_000_000_000 * 1e18;
uint256 constant STOP_THRESHOLD       = 1e16;             // 0.01 CLAW

// ═══ Era Model Governance ═══
uint256 constant NOMINATION_START_EPOCH_IN_ERA = 11;      // Nomination starts at Epoch 11
uint256 constant VOTING_START_EPOCH_IN_ERA     = 16;      // Voting starts at Epoch 16
uint256 constant ANNOUNCEMENT_EPOCH_IN_ERA     = 21;      // Announcement of results at Epoch 21
uint256 constant MAX_CANDIDATES_PER_ERA        = 20;      // Max 20 candidates per Era
// Era 1 model: keccak256("grok-4.1-fast")                      // Hard-coded, immutable

// ═══ Key Derived Values ═══
// Era 1 Epoch Cap       = 100_000e18 × 50_000 = 5,000,000,000 CLAW (5 billion)
// Era 1 Total           = 100_000e18 × 1,050,000 = 105,000,000,000 CLAW (105 billion)
// Total Epochs          = 24 × 21 = 504
// Total Duration        = 25,200,000 blocks × 12s = 9.58 years
// Total Mined           = 209,999,987,483 CLAW
// Seed update frequency = per Epoch (50K blocks ≈ 1 week)
// timestamp dependency  = zero
// Nomination window     = Epoch 11-15 within Era (blocks 500K-749,999, ≈ 34.7 days)
// Voting window         = Epoch 16-20 within Era (blocks 750K-999,999, ≈ 34.7 days)
// Announcement window   = Epoch 21 within Era (blocks 1M-1,049,999, ≈ 6.9 days)
// Vote lock period      = from voting start to announcement phase (max ≈ 41.6 days)
```

---

*Document version: v4.2.1*
*Last updated: 2026-03-11*
*Positioning: Era Model Governance + on-chain voting final version, ready to hand off to the development team for implementation*

**Where Eras Halve the Reward, Epochs Reset the Hope, and Communities Choose the Model. 🦞**
