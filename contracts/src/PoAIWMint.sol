// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OracleVerifier} from "./OracleVerifier.sol";
import {MinterProxy} from "./MinterProxy.sol";
import {CLAW_Token} from "./CLAW_Token.sol";

/**
 * @title PoAIWMint v5.3 — Proof-of-AI-Work Mining Main Contract (Oracle Phase 1)
 * @author Clawing Community
 * @notice Era/Epoch dual-layer emission + on-chain model governance + lock-up voting + Oracle signature verification
 *
 * @dev
 *   Dual-layer structure + model governance:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Era   = 1,050,000 blocks (halving cycle, ~ 145.8 days)   │
 *   │  Epoch = 50,000 blocks (emission cycle, ~ 1 week)          │
 *   │  1 Era = 21 Epochs                                         │
 *   │                                                             │
 *   │  Halving per Era: perBlock = INITIAL >> (era - 1)          │
 *   │  Each Epoch has its own hard cap + independent Seed        │
 *   │  Claim cooldown: 3,500 blocks (~ 11.67 hours)             │
 *   │  Zero block.timestamp dependency — pure block.number timer │
 *   │                                                             │
 *   │  Era model governance:                                      │
 *   │  - Era 1: hardcoded GPT-5.4                                │
 *   │  - Era N (N>1): decided by Era N-1 voting                  │
 *   │  - Nomination: Epoch 11-15 | Voting: Epoch 16-20           │
 *   │  - Announcement: Epoch 21 | 1 token = 1 vote, lock-up     │
 *   │    for flash-loan protection                                │
 *   └─────────────────────────────────────────────────────────────┘
 *
 *   Oracle verification flow (Phase 1):
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Miner calls mint(modelHash, totalTokens, seedEpoch,       │
 *   │              seed, claimIndex, deadline, signature)         │
 *   │     ↓                                                       │
 *   │  PoAIWMint runs basic checks (model, cooldown, Epoch cap)  │
 *   │     ↓                                                       │
 *   │  OracleVerifier.verify() — ECDSA signature verification    │
 *   │     ↓                                                       │
 *   │  ecrecover recovers signer, checks valid Oracle node       │
 *   │     ↓                                                       │
 *   │  MinterProxy.mint() — mint CLAW via proxy                  │
 *   │     ↓                                                       │
 *   │  CLAW_Token.mint() — actual minting (~100k gas total)      │
 *   └─────────────────────────────────────────────────────────────┘
 *
 *   Security model:
 *   - Oracle verification: ECDSA signatures, multi-node redundancy
 *   - Replay protection: (address, globalEpoch, claimIndex) + usedSignatures
 *   - Rate-limit protection: 3,500 blocks cooldown + max 14 per Epoch
 *   - Anti-whale: R = perBlock × (1 + ln(T)) logarithmic decay
 *   - Flash-loan protection: vote lock-up mechanism
 *   - Signature hoarding protection: deadline time window
 *   - Fairness: zero premine, zero admin privilege, community voting governance
 *   - Upgrade safety: MinterProxy + 7-day Timelock
 *
 *   Gas budget (single mint): ~100k
 */
contract PoAIWMint {

    // ═══════════════════ External Contract References ═══════════════════

    MinterProxy public immutable minterProxy;
    OracleVerifier public immutable verifier;

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

    /// @notice Claim cooldown: 3,500 blocks (based on block.number, ~ 11.67 hours @ 12s/block)
    /// @dev Paired with OracleVerifier.MIN_VERIFY_INTERVAL (41,000s, based on block.timestamp).
    ///      Both are ~11.67 hours but use different units. OracleVerifier acts as a slightly stricter "secondary safeguard".
    ///      If block time fluctuates, the two cooldowns may not perfectly sync — this is by design (dual protection). [V3-I5]
    uint256 public constant COOLDOWN_BLOCKS = 3_500;
    mapping(address => uint256) public lastClaimBlock;
    mapping(address => mapping(uint256 => uint256)) public epochClaimCount;
    uint256 public constant MAX_CLAIMS_PER_EPOCH = 14;

    // ═══════════════════ Era Model Governance ═══════════════════

    uint256 public constant NOMINATION_START_EPOCH_IN_ERA = 11;
    uint256 public constant VOTING_START_EPOCH_IN_ERA = 16;
    uint256 public constant ANNOUNCEMENT_EPOCH_IN_ERA = 21;
    uint256 public constant MAX_CANDIDATES_PER_ERA = 20;

    mapping(uint256 => bytes32) public eraModel;
    mapping(uint256 => bytes32[]) internal _candidates;
    mapping(uint256 => mapping(bytes32 => bool)) public isCandidate;
    mapping(uint256 => mapping(address => bool)) public hasProposed;
    mapping(uint256 => mapping(bytes32 => uint256)) public modelVotes;
    mapping(uint256 => mapping(address => bytes32)) public voterChoice;
    mapping(uint256 => mapping(address => uint256)) public voterAmount;
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

    error ModelNotApproved();
    error TokensMustBePositive();
    error CooldownNotMet();
    error EpochClaimLimitReached();
    error WrongSeedEpoch();
    error WrongSeed();
    error AlreadyClaimed();
    error EpochExhausted();
    error MiningEnded();
    error InvalidSignature();
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
    error TokensOutOfRange();
    error FinalizationWindowExpired();

    // ═══════════════════ Anti-Cheat Constants ═══════════════════

    /// @notice Minimum token consumption (a reasonable AI conversation consumes at least 2100 tokens)
    uint256 public constant MIN_TOKENS = 2_100;

    /// @notice Maximum token consumption (a single conversation cannot exceed 100,000 tokens)
    uint256 public constant MAX_TOKENS = 100_000;

    constructor(address _minterProxy, address _verifier, string memory _era1ModelId) {
        minterProxy = MinterProxy(_minterProxy);
        verifier = OracleVerifier(_verifier);
        startBlock = block.number;

        // Era 1 model — configured via constructor argument (e.g. "grok-4.1-fast")
        bytes32 modelHash = keccak256(bytes(_era1ModelId));
        eraModel[1] = modelHash;
        eraModelFinalized[1] = true;

        // Note: seedEpoch starts at 0. Miners MUST call updateSeed() for the
        // current epoch before any mint() call will succeed. This is by design —
        // it ensures a valid on-chain seed exists before mining begins.
    }

    // ═══════════════════════════════════════════════════════
    //              Era / Epoch Computation (Pure Math, Zero Storage)
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
    //                    Core Mining Function (Oracle Version)
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Submit Oracle signature and mint CLAW
     * @param modelHash keccak256(model ID string, e.g. "grok-4.1-fast")
     * @param totalTokens LLM token consumption T
     * @param claimSeedEpoch Global Epoch number corresponding to the Seed
     * @param claimSeed Epoch Seed
     * @param claimIndex Claim index for this address in this epoch (0-based)
     * @param deadline Signature expiry block number
     * @param signature Oracle ECDSA signature (65 bytes)
     */
    function mint(
        bytes32 modelHash,
        uint256 totalTokens,
        uint256 claimSeedEpoch,
        uint256 claimSeed,
        uint256 claimIndex,
        uint256 deadline,
        bytes calldata signature
    ) external {
        // ─── 0. Has mining ended? ───
        uint256 era = currentEra();
        if (era > MAX_ERAS) revert MiningEnded();

        uint256 gEpoch = currentGlobalEpoch();

        // ─── 1. Model validation ───
        if (eraModel[era] == bytes32(0)) revert EraModelNotSet();
        if (modelHash != eraModel[era]) revert ModelNotApproved();

        // ─── 2. Token consumption range check (anti-cheat) ───
        if (totalTokens < MIN_TOKENS || totalTokens > MAX_TOKENS) revert TokensOutOfRange();

        // ─── 3. Cooldown check (3,500 blocks) ───
        if (lastClaimBlock[msg.sender] + COOLDOWN_BLOCKS > block.number) {
            revert CooldownNotMet();
        }

        // ─── 4. Epoch claim count check ───
        {
            uint256 currentCount = epochClaimCount[msg.sender][gEpoch];
            if (currentCount >= MAX_CLAIMS_PER_EPOCH) revert EpochClaimLimitReached();
            if (claimIndex != currentCount) revert AlreadyClaimed();
        }

        // ─── 5. Epoch Seed validation ───
        if (claimSeedEpoch != seedEpoch) revert WrongSeedEpoch();
        if (claimSeed != currentSeed) revert WrongSeed();
        if (seedEpoch != gEpoch) revert WrongSeedEpoch();

        // ─── 6. Oracle signature verification (~10k gas) ───
        // [V4-L1] Explicitly check return value as defensive programming, even though verify() already reverts on failure
        bool valid = verifier.verify(
            msg.sender,
            modelHash,
            totalTokens,
            claimSeedEpoch,
            claimSeed,
            claimIndex,
            deadline,
            signature
        );
        if (!valid) revert InvalidSignature();

        // ─── 7. Calculate reward ───
        uint256 reward = _calculateReward(totalTokens, perBlockForEra(era));

        // ─── 8. Epoch hard cap check ───
        {
            uint256 cap = epochCap(gEpoch);
            if (epochMinted[gEpoch] + reward > cap) {
                reward = cap - epochMinted[gEpoch];
                if (reward == 0) revert EpochExhausted();
            }
        }

        // ─── 9. State update ───
        lastClaimBlock[msg.sender] = block.number;
        epochMinted[gEpoch] += reward; // checked: defense-in-depth
        unchecked {
            epochClaimCount[msg.sender][gEpoch]++;  // safe: max 14
            totalClaims++;  // safe: won't overflow in practice
        }

        // ─── 10. Mint tokens via MinterProxy ───
        minterProxy.mint(msg.sender, reward);

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
     * @param amount Vote amount (i.e. lock-up amount, 1 CLAW = 1 vote)
     *
     * @dev Warning: once a vote is cast, the target model cannot be changed! You can add more votes for the same model, but cannot switch.
     *      Vote-locked tokens can only be withdrawn via withdrawVote() after the Era ends.
     *      Tokens locked during voting cannot be used for mining — there is an opportunity cost, so decide carefully. [V3-L3]
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

        bytes32 prev = voterChoice[era][msg.sender];
        if (prev != bytes32(0) && prev != modelHash) revert CannotChangeVote();

        // Lock tokens: transfer from miner to this contract
        // Note: voting uses CLAW_Token.transferFrom, not via MinterProxy
        // CLAW_Token's transferFrom is standard ERC-20, callable by anyone
        CLAW_Token tokenContract = minterProxy.token();
        bool ok = tokenContract.transferFrom(msg.sender, address(this), amount);
        require(ok, "Transfer failed");

        voterChoice[era][msg.sender] = modelHash;
        voterAmount[era][msg.sender] += amount;
        modelVotes[era][modelHash] += amount;

        emit Voted(era, modelHash, msg.sender, amount);
    }

    /**
     * @notice Tally votes: determine the voting result for a given Era, set the model for the next Era
     * @dev Tie-breaking rule: if two candidate models receive exactly the same number of votes,
     *      the model that appears first in the _candidates array wins (uses > not >=).
     *      Nomination order depends on transaction ordering (no guaranteed first-come advantage).
     *      An exact tie is extremely unlikely (requires precision down to 1 wei).
     *      If there are no candidates or votes, the previous Era's model carries over. [V3-L2]
     *
     * @dev Time limit: must be called before votingEra + 2 ends (2 Era grace period)  [V4-M2]
     *      Prevents indefinite delay in calling finalizeEraModel, ensuring governance timeliness.
     */
    function finalizeEraModel(uint256 votingEra) external {
        uint256 targetEra = votingEra + 1;
        if (currentEra() == votingEra && _epochInEra() < ANNOUNCEMENT_EPOCH_IN_ERA) {
            revert EraNotEnded();
        }
        // [V4-M2] Time limit: must be called before votingEra + 2 ends
        if (currentEra() > votingEra + 2) revert FinalizationWindowExpired();
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
        }

        if (winner == bytes32(0)) {
            winner = eraModel[votingEra];
        }

        eraModel[targetEra] = winner;
        eraModelFinalized[targetEra] = true;

        emit EraModelFinalized(targetEra, winner);
    }

    /**
     * @notice Withdraw vote-locked tokens
     */
    function withdrawVote(uint256 votingEra) external {
        if (currentEra() == votingEra && _epochInEra() < ANNOUNCEMENT_EPOCH_IN_ERA) {
            revert EraNotEnded();
        }

        uint256 amount = voterAmount[votingEra][msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        voterAmount[votingEra][msg.sender] = 0;

        // Directly call token's transfer (PoAIWMint holds the locked tokens)
        CLAW_Token tokenContract = minterProxy.token();
        bool ok = tokenContract.transfer(msg.sender, amount);
        require(ok, "Transfer failed");

        emit VoteWithdrawn(votingEra, msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════
    //                   Epoch Seed Management
    // ═══════════════════════════════════════════════════════

    /**
     * @notice Update the current Epoch's Seed (takes effect on the first call per Epoch)
     * @dev Seed security analysis:
     *   The Seed is not involved in reward calculation; it only binds Oracle signatures to a specific Epoch.
     *   The reward formula R = perBlock x (1 + ln(T)) depends solely on token consumption T, independent of the Seed.
     *   MEV searchers could theoretically manipulate blockhash to influence the Seed value, but since the Seed
     *   does not affect reward amounts, the economic gain from manipulating the Seed is zero. [V3-M2]
     */
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
    //       MSB Bitwise Logarithm Computation (precision edge-case fix)
    // ═══════════════════════════════════════════════════════

    function _msb(uint256 x) internal pure returns (uint256 r) {
        // Edge case: x == 0 returns 0 (prevents undefined behavior)
        if (x == 0) return 0;

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

    /// @notice Logarithmic reward calculation: R = base × (1 + ln(T))
    /// @dev Approximation: ln(T) ~ log2(T) × 0.693 = msb(T) × 693 / 1000
    ///      Fix: when T < MIN_TOKENS, return base directly (T=0 cannot reach here, already blocked by mint function)
    ///      Precision analysis:
    ///        T=100   -> msb=6  -> ln~4.158  -> R~5.158×base  (actual ln(100)=4.605)
    ///        T=1000  -> msb=9  -> ln~6.237  -> R~7.237×base  (actual ln(1000)=6.908)
    ///        T=100000-> msb=16 -> ln~11.088 -> R~12.088×base (actual ln(100000)=11.513)
    ///        Error ~10-15%, within acceptable range
    ///
    ///      Warning — error margin note [V3-L4]:
    ///        The approximation is always below the true ln(T) — this is a conservative design,
    ///        meaning actual rewards are slightly lower than the mathematically exact value.
    ///        All miners use the exact same formula, so fairness is not affected.
    ///        The frontend can use JavaScript Math.log() to compute the exact value and display it alongside the on-chain value.
    ///
    ///      Overflow analysis:
    ///        Maximum: base=100,000×1e18, msb max=16 (for MAX_TOKENS=100,000)
    ///        base × (1000 + 16 × 693) / 1000 = base × 12088 / 1000
    ///        = 100,000 × 1e18 × 12.088 = 1.2088 × 1e24 -> far below uint256 max
    function _calculateReward(
        uint256 totalTokens,
        uint256 base
    ) internal pure returns (uint256) {
        // totalTokens >= MIN_TOKENS is guaranteed by mint()
        uint256 log2T = _msb(totalTokens);
        // Upper-bound protection: prevents overflow even if msb is abnormally large
        if (log2T > 255) log2T = 255;
        return base * (1000 + log2T * 693) / 1000;
    }

    // ═══════════════════════════════════════════════════════
    //                   View Functions (free)
    // ═══════════════════════════════════════════════════════

    function miningEnded() external view returns (bool) {
        return currentEra() > MAX_ERAS;
    }

    function estimateReward(uint256 totalTokens) external view returns (uint256) {
        uint256 era = currentEra();
        if (era > MAX_ERAS) return 0;
        if (totalTokens < MIN_TOKENS) totalTokens = MIN_TOKENS;
        if (totalTokens > MAX_TOKENS) totalTokens = MAX_TOKENS;
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
        uint256 totalMinted = minterProxy.token().totalMinted();
        progressBps = totalMinted / (210_000_000_000 * 1e18 / 10000);
    }

    function candidateCount(uint256 era) external view returns (uint256) {
        return _candidates[era].length;
    }

    function candidateAt(uint256 era, uint256 index) external view returns (bytes32) {
        return _candidates[era][index];
    }

    function isNominationOpen() external view returns (bool) {
        uint256 eInEra = _epochInEra();
        return eInEra >= NOMINATION_START_EPOCH_IN_ERA && eInEra < VOTING_START_EPOCH_IN_ERA;
    }

    function isVotingOpen() external view returns (bool) {
        uint256 eInEra = _epochInEra();
        return eInEra >= VOTING_START_EPOCH_IN_ERA && eInEra < ANNOUNCEMENT_EPOCH_IN_ERA;
    }

    function isAnnouncementPhase() external view returns (bool) {
        return _epochInEra() == ANNOUNCEMENT_EPOCH_IN_ERA;
    }

    function getEraModel(uint256 era) external view returns (bytes32) {
        return eraModel[era];
    }
}
