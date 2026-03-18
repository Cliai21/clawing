// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {CLAW_Token} from "../src/CLAW_Token.sol";
import {OracleVerifier} from "../src/OracleVerifier.sol";
import {MinterProxy} from "../src/MinterProxy.sol";
import {PoAIWMint} from "../src/PoAIWMint.sol";

/// @title PoAIWMint comprehensive test suite (Oracle Phase 1)
/// @notice Covers: Oracle signature verification, multi-node, replay protection, rate limiting, time window,
///         MinterProxy timelock, mining logic, governance, edge cases, ln(T) precision
contract PoAIWMintTest is Test {

    CLAW_Token token;
    OracleVerifier verifier;
    MinterProxy proxy;
    PoAIWMint mint;

    // Oracle signer private keys (for testing)
    uint256 constant ORACLE_PK_1 = 0xA11CE;
    uint256 constant ORACLE_PK_2 = 0xB0B;
    address oracle1;
    address oracle2;

    address miner1 = address(0x1111);
    address miner2 = address(0x2222);
    address guardian = address(0x9999);

    bytes32 constant ERA1_MODEL = keccak256("grok-4.1-fast");

    function setUp() public {
        // ensure block.number is large enough:
        // 1) blockhash(block.number - N) does not underflow
        // 2) first mint cooldown check: lastClaimBlock=0, 0 + COOLDOWN=3500 < block.number
        vm.roll(5000);
        vm.warp(60000);

        oracle1 = vm.addr(ORACLE_PK_1);
        oracle2 = vm.addr(ORACLE_PK_2);

        // 1. deploy OracleVerifier (dual node)
        address[] memory signers = new address[](2);
        signers[0] = oracle1;
        signers[1] = oracle2;
        verifier = new OracleVerifier(signers);

        // 2. pre-compute addresses
        uint256 nonce = vm.getNonce(address(this));
        address predictedProxy = vm.computeCreateAddress(address(this), nonce + 1);
        address predictedMint = vm.computeCreateAddress(address(this), nonce + 2);

        // 3. deploy Token (minter = predictedProxy)
        token = new CLAW_Token(predictedProxy);

        // 4. deploy MinterProxy (activeMinter = predictedMint)
        proxy = new MinterProxy(address(token), predictedMint, guardian);
        assertEq(address(proxy), predictedProxy);

        // 5. deploy PoAIWMint
        mint = new PoAIWMint(address(proxy), address(verifier), "grok-4.1-fast");
        assertEq(address(mint), predictedMint);

        // verify
        assertEq(token.minter(), address(proxy));
        assertEq(proxy.activeMinter(), address(mint));
        assertEq(address(mint.minterProxy()), address(proxy));
    }

    // ═══════════════════ helper functions ═══════════════════

    /// @dev sign with Oracle private key for mint parameters (includes chainId + verifier address)
    function _signMint(
        uint256 oraclePk,
        address minerAddr,
        bytes32 modelHash,
        uint256 totalTokens,
        uint256 seedEpoch,
        uint256 seed,
        uint256 claimIndex,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 dataHash = keccak256(abi.encode(
            block.chainid,
            address(verifier),
            minerAddr, modelHash, totalTokens, seedEpoch, seed, claimIndex, deadline
        ));
        bytes32 ethSignedHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            dataHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }

    function _advanceBlocks(uint256 n) internal {
        vm.roll(block.number + n);
        // sync timestamp: each block ≈ 12 seconds
        vm.warp(block.timestamp + n * 12);
    }

    /// @dev perform a valid mint (signed by oracle1)
    function _doMint(address miner, uint256 totalTokens) internal {
        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 claimIndex = mint.epochClaimCount(miner, gEpoch);
        uint256 deadline = block.number + 100;

        bytes memory sig = _signMint(
            ORACLE_PK_1, miner, ERA1_MODEL, totalTokens,
            gEpoch, seed, claimIndex, deadline
        );

        vm.prank(miner);
        mint.mint(ERA1_MODEL, totalTokens, gEpoch, seed, claimIndex, deadline, sig);
    }

    /// @dev shorthand version: defaults to 5000 tokens
    function _doMint(address miner) internal {
        _doMint(miner, 5000);
    }

    // ═══════════════════ constructor and initial state ═══════════════════

    function test_Constructor() public view {
        assertEq(address(mint.minterProxy()), address(proxy));
        assertEq(address(mint.verifier()), address(verifier));
        assertEq(mint.eraModel(1), ERA1_MODEL);
        assertTrue(mint.eraModelFinalized(1));
    }

    function test_InitialState() public view {
        assertEq(mint.currentEra(), 1);
        assertEq(mint.currentGlobalEpoch(), 1);
        assertEq(mint.totalClaims(), 0);
        assertEq(token.totalSupply(), 0);
        assertEq(token.totalMinted(), 0);
    }

    function test_OracleVerifier_MultiNode() public view {
        assertEq(verifier.oracleCount(), 2);
        assertTrue(verifier.isOracleSigner(oracle1));
        assertTrue(verifier.isOracleSigner(oracle2));
        assertFalse(verifier.isOracleSigner(miner1));
        assertEq(verifier.oracleSignerAt(0), oracle1);
        assertEq(verifier.oracleSignerAt(1), oracle2);
    }

    function test_MinterProxy_Setup() public view {
        assertEq(address(proxy.token()), address(token));
        assertEq(proxy.activeMinter(), address(mint));
        assertEq(proxy.guardian(), guardian);
    }

    // ═══════════════════ Era/Epoch calculations ═══════════════════

    function test_EraAndEpochCalculations() public {
        assertEq(mint.currentEra(), 1);
        assertEq(mint.currentGlobalEpoch(), 1);
        assertEq(mint.epochInEra(), 1);

        _advanceBlocks(50_000);
        assertEq(mint.currentGlobalEpoch(), 2);
        assertEq(mint.epochInEra(), 2);

        _advanceBlocks(50_000 * 19);
        assertEq(mint.currentGlobalEpoch(), 21);
        assertEq(mint.epochInEra(), 21);
        assertEq(mint.currentEra(), 1);

        _advanceBlocks(50_000);
        assertEq(mint.currentEra(), 2);
        assertEq(mint.currentGlobalEpoch(), 22);
        assertEq(mint.epochInEra(), 1);
    }

    function test_PerBlockHalving() public view {
        assertEq(mint.perBlockForEra(1), 100_000 * 1e18);
        assertEq(mint.perBlockForEra(2), 50_000 * 1e18);
        assertEq(mint.perBlockForEra(3), 25_000 * 1e18);
        assertEq(mint.perBlockForEra(24), 100_000 * 1e18 >> 23);
        assertEq(mint.perBlockForEra(25), 0);
    }

    function test_EpochCap() public view {
        uint256 expected = 100_000 * 1e18 * 50_000;
        assertEq(mint.epochCap(1), expected);
        assertEq(mint.epochCap(22), expected / 2);
    }

    // ═══════════════════ Seed tests ═══════════════════

    function test_UpdateSeed() public {
        assertEq(mint.seedEpoch(), 0);
        mint.updateSeed();
        assertEq(mint.seedEpoch(), 1);
        assertTrue(mint.currentSeed() != 0);
    }

    function test_UpdateSeed_RevertIfAlreadySet() public {
        mint.updateSeed();
        vm.expectRevert(PoAIWMint.SeedAlreadySet.selector);
        mint.updateSeed();
    }

    function test_UpdateSeed_NewEpoch() public {
        mint.updateSeed();
        uint256 seed1 = mint.currentSeed();

        _advanceBlocks(50_000);
        mint.updateSeed();
        uint256 seed2 = mint.currentSeed();

        assertEq(mint.seedEpoch(), 2);
        assertTrue(seed1 != seed2);
    }

    // ═══════════════════ core mint tests (Oracle) ═══════════════════

    function test_Mint_Success_Oracle1() public {
        mint.updateSeed();
        _doMint(miner1);

        assertEq(mint.totalClaims(), 1);
        assertTrue(token.balanceOf(miner1) > 0);
        assertEq(mint.epochClaimCount(miner1, 1), 1);
    }

    function test_Mint_Success_Oracle2() public {
        // sign with Oracle node 2
        mint.updateSeed();

        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;

        bytes memory sig = _signMint(
            ORACLE_PK_2, miner1, ERA1_MODEL, 5000,
            gEpoch, seed, 0, deadline
        );

        vm.prank(miner1);
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, 0, deadline, sig);

        assertEq(mint.totalClaims(), 1);
        assertTrue(token.balanceOf(miner1) > 0);
    }

    function test_Mint_RevertIfCooldownNotMet() public {
        mint.updateSeed();
        _doMint(miner1);

        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;
        bytes memory sig = _signMint(ORACLE_PK_1, miner1, ERA1_MODEL, 5000, gEpoch, seed, 1, deadline);

        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.CooldownNotMet.selector);
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, 1, deadline, sig);
    }

    function test_Mint_AfterCooldown() public {
        mint.updateSeed();
        _doMint(miner1);

        _advanceBlocks(3_500);

        _doMint(miner1);
        assertEq(mint.totalClaims(), 2);
        assertEq(mint.epochClaimCount(miner1, 1), 2);
    }

    function test_Mint_RevertIfWrongModel() public {
        mint.updateSeed();
        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;
        bytes32 wrongModel = keccak256("wrong-model");
        bytes memory sig = _signMint(ORACLE_PK_1, miner1, wrongModel, 5000, gEpoch, seed, 0, deadline);

        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.ModelNotApproved.selector);
        mint.mint(wrongModel, 5000, gEpoch, seed, 0, deadline, sig);
    }

    function test_Mint_RevertIfTokensOutOfRange_TooLow() public {
        mint.updateSeed();
        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;
        bytes memory sig = _signMint(ORACLE_PK_1, miner1, ERA1_MODEL, 50, gEpoch, seed, 0, deadline);

        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.TokensOutOfRange.selector);
        mint.mint(ERA1_MODEL, 50, gEpoch, seed, 0, deadline, sig);
    }

    function test_Mint_RevertIfTokensOutOfRange_TooHigh() public {
        mint.updateSeed();
        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;
        bytes memory sig = _signMint(ORACLE_PK_1, miner1, ERA1_MODEL, 200_000, gEpoch, seed, 0, deadline);

        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.TokensOutOfRange.selector);
        mint.mint(ERA1_MODEL, 200_000, gEpoch, seed, 0, deadline, sig);
    }

    function test_Mint_RevertIfInvalidSignature() public {
        mint.updateSeed();
        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;

        // sign with wrong private key
        uint256 fakePk = 0xDEAD;
        bytes memory sig = _signMint(fakePk, miner1, ERA1_MODEL, 5000, gEpoch, seed, 0, deadline);

        vm.prank(miner1);
        vm.expectRevert(OracleVerifier.InvalidSignature.selector);
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, 0, deadline, sig);
    }

    function test_Mint_RevertIfSignatureExpired() public {
        mint.updateSeed();
        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 1; // expires soon

        bytes memory sig = _signMint(ORACLE_PK_1, miner1, ERA1_MODEL, 5000, gEpoch, seed, 0, deadline);

        _advanceBlocks(10); // past deadline

        vm.prank(miner1);
        vm.expectRevert(OracleVerifier.SignatureExpired.selector);
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, 0, deadline, sig);
    }

    function test_Mint_RevertIfSignatureReplay() public {
        mint.updateSeed();
        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 200;

        bytes memory sig = _signMint(ORACLE_PK_1, miner1, ERA1_MODEL, 5000, gEpoch, seed, 0, deadline);

        // first time succeeds
        vm.prank(miner1);
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, 0, deadline, sig);

        // wait for cooldown
        _advanceBlocks(3_500);

        // attempt to mint again with the same signature (claimIndex differs, but the signature data is identical)
        // note: because claimIndex differs, the signature hash differs, so this tests a true replay
        // a true replay is resubmitting the claimIndex=0 signature
        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.AlreadyClaimed.selector);
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, 0, deadline, sig);
    }

    function test_Mint_MaxClaimsPerEpoch() public {
        mint.updateSeed();

        for (uint256 i = 0; i < 14; i++) {
            if (i > 0) _advanceBlocks(3_500);
            _doMint(miner1);
        }

        assertEq(mint.epochClaimCount(miner1, 1), 14);
        assertEq(mint.remainingClaims(miner1), 0);

        _advanceBlocks(3_500);
        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;
        bytes memory sig = _signMint(ORACLE_PK_1, miner1, ERA1_MODEL, 5000, gEpoch, seed, 14, deadline);

        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.EpochClaimLimitReached.selector);
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, 14, deadline, sig);
    }

    // ═══════════════════ reward calculation tests (ln(T) precision fix) ═══════════════════

    function test_RewardCalculation_MinTokens() public view {
        // T = 2100 → msb(2100) = 11 → R = base × (1000 + 11*693) / 1000 = base × 8623 / 1000
        uint256 expected = 100_000 * 1e18 * 8623 / 1000;
        assertEq(mint.estimateReward(2100), expected);
    }

    function test_RewardCalculation_MediumTokens() public view {
        // T = 10000 → msb(10000) = 13 → R = base × (1000 + 13*693) / 1000 = base × 10009 / 1000
        uint256 expected = 100_000 * 1e18 * 10009 / 1000;
        assertEq(mint.estimateReward(10000), expected);
    }

    function test_RewardCalculation_MaxTokens() public view {
        // T = 100,000 → msb(100000) = 16 → R = base × (1000 + 16*693) / 1000 = base × 12088 / 1000
        uint256 expected = 100_000 * 1e18 * 12088 / 1000;
        assertEq(mint.estimateReward(100_000), expected);
    }

    function test_RewardCalculation_BelowMin_ClampedToMin() public view {
        // estimateReward clamps to MIN_TOKENS=2100
        assertEq(mint.estimateReward(1), mint.estimateReward(2100));
        assertEq(mint.estimateReward(50), mint.estimateReward(2100));
    }

    function test_RewardCalculation_AboveMax_ClampedToMax() public view {
        assertEq(mint.estimateReward(200_000), mint.estimateReward(100_000));
    }

    // ═══════════════════ MinterProxy Timelock tests ═══════════════════

    function test_MinterProxy_ProposeMinter() public {
        // deploy a fake new PoAIWMint contract
        PoAIWMint newMint = new PoAIWMint(address(proxy), address(verifier), "grok-4.1-fast");

        vm.prank(guardian);
        proxy.proposeMinter(address(newMint));

        assertEq(proxy.pendingMinter(), address(newMint));
        assertTrue(proxy.timelockRemaining() > 0);
    }

    function test_MinterProxy_ExecuteAfterTimelock() public {
        PoAIWMint newMint = new PoAIWMint(address(proxy), address(verifier), "grok-4.1-fast");

        vm.prank(guardian);
        proxy.proposeMinter(address(newMint));

        // wait for timelock (7 days)
        vm.warp(block.timestamp + 7 days + 1);

        proxy.executeMinterChange();
        assertEq(proxy.activeMinter(), address(newMint));
        assertEq(proxy.pendingMinter(), address(0));
    }

    function test_MinterProxy_RevertBeforeTimelock() public {
        PoAIWMint newMint = new PoAIWMint(address(proxy), address(verifier), "grok-4.1-fast");

        vm.prank(guardian);
        proxy.proposeMinter(address(newMint));

        // only wait 3 days
        vm.warp(block.timestamp + 3 days);

        vm.expectRevert(MinterProxy.TimelockNotMet.selector);
        proxy.executeMinterChange();
    }

    function test_MinterProxy_CancelProposal() public {
        PoAIWMint newMint = new PoAIWMint(address(proxy), address(verifier), "grok-4.1-fast");

        vm.prank(guardian);
        proxy.proposeMinter(address(newMint));

        vm.prank(guardian);
        proxy.cancelMinterChange();

        assertEq(proxy.pendingMinter(), address(0));
    }

    function test_MinterProxy_RenounceGuardian() public {
        vm.prank(guardian);
        proxy.renounceGuardian();

        assertEq(proxy.guardian(), address(0));

        // can no longer propose
        PoAIWMint newMint = new PoAIWMint(address(proxy), address(verifier), "grok-4.1-fast");
        vm.prank(guardian);
        vm.expectRevert(MinterProxy.NotGuardian.selector);
        proxy.proposeMinter(address(newMint));
    }

    function test_MinterProxy_ProposalExpiry() public {
        PoAIWMint newMint = new PoAIWMint(address(proxy), address(verifier), "grok-4.1-fast");

        vm.prank(guardian);
        proxy.proposeMinter(address(newMint));

        // wait more than 14 days (expired)
        vm.warp(block.timestamp + 15 days);

        vm.expectRevert(MinterProxy.ProposalExpired.selector);
        proxy.executeMinterChange();

        assertTrue(proxy.isProposalExpired());
    }

    function test_MinterProxy_RevertIfNotContract() public {
        address eoa = address(0xABCD);

        vm.prank(guardian);
        vm.expectRevert(MinterProxy.NotContract.selector);
        proxy.proposeMinter(eoa);
    }

    // ═══════════════════ governance tests ═══════════════════

    function test_Governance_NominationWindow() public {
        assertFalse(mint.isNominationOpen());

        _advanceBlocks(50_000 * 10);
        assertTrue(mint.isNominationOpen());

        _advanceBlocks(50_000 * 5);
        assertFalse(mint.isNominationOpen());
        assertTrue(mint.isVotingOpen());
    }

    function test_Governance_ProposeModel() public {
        _advanceBlocks(50_000 * 10);
        assertTrue(mint.isNominationOpen());

        vm.prank(miner1);
        mint.proposeModel("claude-opus-5");

        assertEq(mint.candidateCount(1), 1);
        bytes32 modelHash = keccak256("claude-opus-5");
        assertTrue(mint.isCandidate(1, modelHash));
    }

    function test_Governance_ProposeModel_RevertOutsideWindow() public {
        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.NotInNominationWindow.selector);
        mint.proposeModel("claude-opus-5");
    }

    function test_Governance_Vote() public {
        // give miner1 some CLAW for voting
        mint.updateSeed();
        _doMint(miner1);
        uint256 balance = token.balanceOf(miner1);
        assertTrue(balance > 0);

        // advance to nomination window
        _advanceBlocks(50_000 * 10);
        mint.updateSeed();

        vm.prank(miner1);
        mint.proposeModel("claude-opus-5");

        // advance to voting window
        _advanceBlocks(50_000 * 5);
        mint.updateSeed();
        assertTrue(mint.isVotingOpen());

        bytes32 modelHash = keccak256("claude-opus-5");

        vm.startPrank(miner1);
        token.approve(address(mint), balance);
        mint.vote(modelHash, balance);
        vm.stopPrank();

        assertEq(mint.modelVotes(1, modelHash), balance);
        assertEq(mint.voterAmount(1, miner1), balance);
    }

    function test_Governance_FinalizeAndWithdraw() public {
        _advanceBlocks(50_000 * 20);
        assertTrue(mint.isAnnouncementPhase());

        mint.finalizeEraModel(1);
        assertTrue(mint.eraModelFinalized(2));
        assertEq(mint.eraModel(2), ERA1_MODEL);
    }

    function test_Governance_RevertFinalizeBeforeAnnouncement() public {
        _advanceBlocks(50_000 * 9);
        vm.expectRevert(PoAIWMint.EraNotEnded.selector);
        mint.finalizeEraModel(1);
    }

    // ═══════════════════ OracleVerifier standalone tests ═══════════════════

    function test_OracleVerifier_VerifyView() public {
        address miner = miner1;
        bytes32 model = ERA1_MODEL;
        uint256 tokens = 5000;
        uint256 epoch = 1;
        uint256 seed = 12345;
        uint256 index = 0;
        uint256 deadline = block.number + 100;

        bytes memory sig = _signMint(ORACLE_PK_1, miner, model, tokens, epoch, seed, index, deadline);

        bool valid = verifier.verifyView(miner, model, tokens, epoch, seed, index, deadline, sig);
        assertTrue(valid);
    }

    function test_OracleVerifier_RejectInvalidSigner() public view {
        uint256 fakePk = 0xF00;
        address miner = miner1;
        uint256 deadline = block.number + 100;

        bytes memory sig = _signMint(fakePk, miner, ERA1_MODEL, 5000, 1, 12345, 0, deadline);

        bool valid = verifier.verifyView(miner, ERA1_MODEL, 5000, 1, 12345, 0, deadline, sig);
        assertFalse(valid);
    }

    function test_OracleVerifier_Constructor_RevertNoSigners() public {
        address[] memory empty = new address[](0);
        vm.expectRevert(OracleVerifier.NoSigners.selector);
        new OracleVerifier(empty);
    }

    function test_OracleVerifier_Constructor_RevertTooMany() public {
        address[] memory tooMany = new address[](6);
        for (uint256 i = 0; i < 6; i++) {
            tooMany[i] = vm.addr(i + 100);
        }
        vm.expectRevert(OracleVerifier.TooManySigners.selector);
        new OracleVerifier(tooMany);
    }

    // ═══════════════════ view function tests ═══════════════════

    function test_ViewFunctions() public {
        assertFalse(mint.miningEnded());
        assertEq(mint.getCurrentPerBlock(), 100_000 * 1e18);
        assertTrue(mint.blocksUntilNextEpoch() > 0);
        assertEq(mint.miningProgress(), 0);
    }

    // ═══════════════════ edge cases ═══════════════════

    function test_MiningEnded_AfterAllEras() public {
        _advanceBlocks(1_050_000 * 24 + 1);
        assertTrue(mint.miningEnded());
        assertEq(mint.currentEra(), 25);
        assertEq(mint.perBlockForEra(25), 0);
    }

    function test_Mint_RevertIfMiningEnded() public {
        _advanceBlocks(1_050_000 * 24 + 1);

        uint256 deadline = block.number + 100;
        bytes memory sig = _signMint(ORACLE_PK_1, miner1, ERA1_MODEL, 5000, 1, 0, 0, deadline);

        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.MiningEnded.selector);
        mint.mint(ERA1_MODEL, 5000, 1, 0, 0, deadline, sig);
    }

    // ═══════════════════ end-to-end: full mining cycle ═══════════════════

    function test_E2E_FullMiningCycle() public {
        // 1. update Seed
        mint.updateSeed();

        // 2. sign with Oracle 1, miner1 mines
        _doMint(miner1, 3000);
        uint256 reward1 = token.balanceOf(miner1);
        assertTrue(reward1 > 0);

        // 3. wait for cooldown
        _advanceBlocks(3_500);

        // 4. sign with Oracle 2, miner2 mines
        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;
        bytes memory sig2 = _signMint(ORACLE_PK_2, miner2, ERA1_MODEL, 50000, gEpoch, seed, 0, deadline);

        vm.prank(miner2);
        mint.mint(ERA1_MODEL, 50000, gEpoch, seed, 0, deadline, sig2);

        uint256 reward2 = token.balanceOf(miner2);
        assertTrue(reward2 > 0);

        // 5. consuming more tokens should yield more rewards (logarithmic relationship)
        assertTrue(reward2 > reward1);

        // 6. verify total statistics
        assertEq(mint.totalClaims(), 2);
        assertEq(token.totalMinted(), reward1 + reward2);
    }

    // ═══════════════════ Fix #14: governance full cycle tests ═══════════════════

    /// @notice Full governance cycle: nomination -> voting -> tallying -> new Era mining
    function test_Governance_FullCycle() public {
        // give miner1 some CLAW
        mint.updateSeed();
        _doMint(miner1);
        uint256 balance = token.balanceOf(miner1);
        assertTrue(balance > 0);

        // advance to nomination window (Epoch 11)
        _advanceBlocks(50_000 * 10);
        mint.updateSeed();

        vm.prank(miner1);
        mint.proposeModel("claude-opus-5");

        bytes32 modelHash = keccak256("claude-opus-5");

        // advance to voting window (Epoch 16)
        _advanceBlocks(50_000 * 5);
        mint.updateSeed();

        vm.startPrank(miner1);
        token.approve(address(mint), balance);
        mint.vote(modelHash, balance);
        vm.stopPrank();

        // advance to announcement phase (Epoch 21)
        _advanceBlocks(50_000 * 5);
        mint.updateSeed();

        mint.finalizeEraModel(1);
        assertEq(mint.eraModel(2), modelHash);
        assertTrue(mint.eraModelFinalized(2));

        // advance to Era 2, mine with new model
        _advanceBlocks(50_000);
        mint.updateSeed();
        assertEq(mint.currentEra(), 2);

        uint256 balanceBeforeMint = token.balanceOf(miner1);
        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;
        bytes memory sig = _signMint(ORACLE_PK_1, miner1, modelHash, 5000, gEpoch, seed, 0, deadline);

        vm.prank(miner1);
        mint.mint(modelHash, 5000, gEpoch, seed, 0, deadline, sig);

        assertTrue(token.balanceOf(miner1) > balanceBeforeMint);
    }

    /// @notice Vote withdrawal: vote -> Era ends -> withdraw -> verify balance
    function test_Governance_VoteWithdrawal() public {
        // give miner1 some CLAW
        mint.updateSeed();
        _doMint(miner1);
        uint256 balanceBefore = token.balanceOf(miner1);

        // nomination
        _advanceBlocks(50_000 * 10);
        mint.updateSeed();
        vm.prank(miner1);
        mint.proposeModel("claude-opus-5");

        // voting
        _advanceBlocks(50_000 * 5);
        mint.updateSeed();
        bytes32 modelHash = keccak256("claude-opus-5");
        uint256 voteAmount = balanceBefore / 2;

        vm.startPrank(miner1);
        token.approve(address(mint), voteAmount);
        mint.vote(modelHash, voteAmount);
        vm.stopPrank();

        assertEq(token.balanceOf(miner1), balanceBefore - voteAmount);

        // advance to announcement phase then withdraw
        _advanceBlocks(50_000 * 5);
        mint.updateSeed();

        vm.prank(miner1);
        mint.withdrawVote(1);

        assertEq(token.balanceOf(miner1), balanceBefore);
    }

    /// @notice Multiple candidates: highest vote count wins
    function test_Governance_MultipleCandidates() public {
        // give miner1 and miner2 some CLAW
        mint.updateSeed();
        _doMint(miner1, 50000);
        _advanceBlocks(3_500);
        _doMint(miner2, 3000);

        uint256 balance1 = token.balanceOf(miner1);
        uint256 balance2 = token.balanceOf(miner2);
        assertTrue(balance1 > balance2);

        // nominate two models
        _advanceBlocks(50_000 * 10);
        mint.updateSeed();

        vm.prank(miner1);
        mint.proposeModel("model-a");
        vm.prank(miner2);
        mint.proposeModel("model-b");

        assertEq(mint.candidateCount(1), 2);

        // voting
        _advanceBlocks(50_000 * 5);
        mint.updateSeed();

        bytes32 modelA = keccak256("model-a");
        bytes32 modelB = keccak256("model-b");

        vm.startPrank(miner1);
        token.approve(address(mint), balance1);
        mint.vote(modelA, balance1);
        vm.stopPrank();

        vm.startPrank(miner2);
        token.approve(address(mint), balance2);
        mint.vote(modelB, balance2);
        vm.stopPrank();

        // tally votes
        _advanceBlocks(50_000 * 5);
        mint.updateSeed();
        mint.finalizeEraModel(1);

        // model-a should win (miner1 has a larger balance)
        assertEq(mint.eraModel(2), modelA);
    }

    /// @notice Guardian cancels then re-proposes and executes
    function test_Governance_GuardianCancelThenRepropose() public {
        PoAIWMint newMint1 = new PoAIWMint(address(proxy), address(verifier), "grok-4.1-fast");

        vm.prank(guardian);
        proxy.proposeMinter(address(newMint1));

        vm.prank(guardian);
        proxy.cancelMinterChange();
        assertEq(proxy.pendingMinter(), address(0));

        // re-propose
        PoAIWMint newMint2 = new PoAIWMint(address(proxy), address(verifier), "grok-4.1-fast");
        vm.prank(guardian);
        proxy.proposeMinter(address(newMint2));

        // execute
        vm.warp(block.timestamp + 7 days + 1);
        proxy.executeMinterChange();
        assertEq(proxy.activeMinter(), address(newMint2));
    }

    /// @notice Guardian maximum cancellation limit
    function test_Governance_MaxCancellationLimit() public {
        for (uint256 i = 0; i < 3; i++) {
            PoAIWMint newMint = new PoAIWMint(address(proxy), address(verifier), "grok-4.1-fast");
            vm.prank(guardian);
            proxy.proposeMinter(address(newMint));
            vm.prank(guardian);
            proxy.cancelMinterChange();
        }

        assertEq(proxy.cancellationCount(), 3);

        // the 4th cancellation should fail
        PoAIWMint newMint = new PoAIWMint(address(proxy), address(verifier), "grok-4.1-fast");
        vm.prank(guardian);
        proxy.proposeMinter(address(newMint));

        vm.prank(guardian);
        vm.expectRevert(MinterProxy.MaxCancellationsReached.selector);
        proxy.cancelMinterChange();
    }

    /// @notice Expired proposal auto-cleanup
    function test_Governance_ExpiredProposalAutoCleanup() public {
        PoAIWMint newMint1 = new PoAIWMint(address(proxy), address(verifier), "grok-4.1-fast");
        vm.prank(guardian);
        proxy.proposeMinter(address(newMint1));

        // wait more than 14 days (expired)
        vm.warp(block.timestamp + 15 days);
        assertTrue(proxy.isProposalExpired());

        // new proposal should auto-cleanup the expired one
        PoAIWMint newMint2 = new PoAIWMint(address(proxy), address(verifier), "grok-4.1-fast");
        vm.prank(guardian);
        proxy.proposeMinter(address(newMint2));

        assertEq(proxy.pendingMinter(), address(newMint2));
    }

    /// @notice executeMinterChange double-checks code.length
    function test_Governance_ExecuteCodeLengthCheck() public {
        PoAIWMint newMint = new PoAIWMint(address(proxy), address(verifier), "grok-4.1-fast");
        vm.prank(guardian);
        proxy.proposeMinter(address(newMint));

        vm.warp(block.timestamp + 7 days + 1);

        // normal execution should succeed (contract exists)
        proxy.executeMinterChange();
        assertEq(proxy.activeMinter(), address(newMint));
    }

    /// @notice Reject duplicate signers
    function test_OracleVerifier_RejectDuplicateSigners() public {
        address[] memory dupSigners = new address[](2);
        dupSigners[0] = oracle1;
        dupSigners[1] = oracle1; // duplicate

        vm.expectRevert(OracleVerifier.DuplicateSigner.selector);
        new OracleVerifier(dupSigners);
    }

    /// @notice Signature includes chainId verification (wrong chainId signature should fail)
    function test_ChainIdInSignature() public {
        mint.updateSeed();

        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;

        // manually construct signature with wrong chainId
        bytes32 wrongDataHash = keccak256(abi.encode(
            uint256(999), // wrong chainId
            address(verifier),
            miner1, ERA1_MODEL, uint256(1000), gEpoch, seed, uint256(0), deadline
        ));
        bytes32 wrongEthSignedHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            wrongDataHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ORACLE_PK_1, wrongEthSignedHash);
        bytes memory wrongSig = abi.encodePacked(r, s, v);

        vm.prank(miner1);
        vm.expectRevert(OracleVerifier.InvalidSignature.selector);
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, 0, deadline, wrongSig);
    }

    // ═══════════════════ V3.0 new tests ═══════════════════

    /// @notice [V3-I1] ERC-20 zero-value transfer should succeed and emit event
    function test_Token_ZeroTransfer() public {
        // first mint some tokens for miner1
        mint.updateSeed();
        _doMint(miner1, 5000);

        // zero-value transfer should succeed
        vm.prank(miner1);
        bool ok = token.transfer(miner2, 0);
        assertTrue(ok, "Zero transfer should succeed");
    }

    /// @notice [V3-I1] ERC-20 zero-value transferFrom should succeed
    function test_Token_ZeroTransferFrom() public {
        // first mint tokens for miner1 and approve miner2
        mint.updateSeed();
        _doMint(miner1, 5000);

        vm.prank(miner1);
        token.approve(miner2, type(uint256).max);

        // zero-value transferFrom should succeed
        vm.prank(miner2);
        bool ok = token.transferFrom(miner1, miner2, 0);
        assertTrue(ok, "Zero transferFrom should succeed");
    }

    /// @notice [V3-I4] Era 2 perBlock is indeed halved
    function test_Era2_HalvedReward() public {
        // Era 1 perBlock
        uint256 era1PerBlock = mint.perBlockForEra(1);
        assertEq(era1PerBlock, 100_000 * 1e18, "Era 1 perBlock should be 100,000 CLAW");

        // Era 2 perBlock should be half of Era 1
        uint256 era2PerBlock = mint.perBlockForEra(2);
        assertEq(era2PerBlock, 50_000 * 1e18, "Era 2 perBlock should be 50,000 CLAW (halved)");

        // advance to Era 1 announcement phase, and finalize Era 2 model (carry over Era 1)
        uint256 BLOCKS_PER_EPOCH = 50_000;
        _advanceBlocks(BLOCKS_PER_EPOCH * 20); // advance to Epoch 21 (announcement phase)
        mint.finalizeEraModel(1); // no candidates, carry over Era 1 model
        assertTrue(mint.eraModelFinalized(2), "Era 2 model should be finalized");

        // advance to Era 2
        uint256 BLOCKS_PER_ERA = 1_050_000;
        uint256 blocksAlreadyAdvanced = BLOCKS_PER_EPOCH * 20;
        _advanceBlocks(BLOCKS_PER_ERA - blocksAlreadyAdvanced);

        assertEq(mint.currentEra(), 2, "Should be Era 2");

        mint.updateSeed();

        uint256 balBefore = token.balanceOf(miner1);
        _doMint(miner1, 5000); // T=5000, msb=12, ln≈8.316, R≈base×9.316
        uint256 balAfter = token.balanceOf(miner1);
        uint256 reward = balAfter - balBefore;

        // Era 2 reward should be based on 50,000 CLAW perBlock (half of Era 1)
        // For T=5000: R = 50,000e18 * (1000 + 12*693) / 1000 = 50,000e18 * 9316 / 1000
        uint256 expectedReward = era2PerBlock * (1000 + 12 * 693) / 1000;
        assertEq(reward, expectedReward, "Era 2 reward should use halved perBlock");

        // confirm it is indeed half the reward of Era 1 for the same token count
        uint256 era1Reward = era1PerBlock * (1000 + 12 * 693) / 1000;
        assertEq(reward, era1Reward / 2, "Era 2 reward should be half of Era 1");
    }

    /// @notice [V3-I4] Era 24 (last Era) can mine normally
    function test_Era24_LastEra_Mining() public {
        // perBlockForEra(24) should be very small but non-zero
        uint256 era24PerBlock = mint.perBlockForEra(24);
        assertTrue(era24PerBlock > 0, "Era 24 perBlock should be > 0");

        // finalize model for each Era (carry over Era 1 model)
        // each Era needs to be finalized during or after the announcement phase
        uint256 BLOCKS_PER_ERA = 1_050_000;
        for (uint256 era = 1; era <= 23; era++) {
            // advance to current Era's Epoch 21 (announcement phase) or later
            uint256 targetBlock = 5000 + era * BLOCKS_PER_ERA; // After Era ends
            if (block.number < targetBlock) {
                _advanceBlocks(targetBlock - block.number);
            }
            if (!mint.eraModelFinalized(era + 1)) {
                mint.finalizeEraModel(era);
            }
        }

        assertEq(mint.currentEra(), 24, "Should be Era 24");
        assertFalse(mint.miningEnded(), "Mining should not have ended");

        // normal mining should succeed
        mint.updateSeed();
        _doMint(miner1, 5000);
        assertTrue(token.balanceOf(miner1) > 0, "Miner should have received reward");
    }

    // ═══════════════════ V4.0 new tests ═══════════════════

    /// @notice [V4-M1] deadline exceeding SIGNATURE_VALIDITY_BLOCKS upper limit should be rejected
    function test_OracleVerifier_RevertIfDeadlineTooFar() public {
        mint.updateSeed();
        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        // set deadline to block.number + 301 (exceeds SIGNATURE_VALIDITY_BLOCKS=300)
        uint256 farDeadline = block.number + 301;

        bytes memory sig = _signMint(ORACLE_PK_1, miner1, ERA1_MODEL, 5000, gEpoch, seed, 0, farDeadline);

        vm.prank(miner1);
        vm.expectRevert(OracleVerifier.DeadlineTooFar.selector);
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, 0, farDeadline, sig);
    }

    /// @notice [V4-M1] deadline exactly equal to block.number + SIGNATURE_VALIDITY_BLOCKS should succeed
    function test_OracleVerifier_DeadlineAtExactLimit() public {
        mint.updateSeed();
        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        // 300 blocks is exactly SIGNATURE_VALIDITY_BLOCKS, should pass
        uint256 exactDeadline = block.number + 300;

        bytes memory sig = _signMint(ORACLE_PK_1, miner1, ERA1_MODEL, 5000, gEpoch, seed, 0, exactDeadline);

        vm.prank(miner1);
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, 0, exactDeadline, sig);
        assertEq(mint.totalClaims(), 1);
    }

    /// @notice [V4-M2] finalizeEraModel beyond votingEra + 2 should be rejected
    function test_Governance_FinalizeExpired() public {
        // advance to Era 4 (grace period Era 3 for votingEra=1 has ended)
        _advanceBlocks(1_050_000 * 3);
        assertEq(mint.currentEra(), 4);

        vm.expectRevert(PoAIWMint.FinalizationWindowExpired.selector);
        mint.finalizeEraModel(1);
    }

    /// @notice [V4-I2] OracleVerifier rate limit integration test: minting again within cooldown after mint should trigger rate limit
    function test_OracleVerifier_RateLimitIntegration() public {
        mint.updateSeed();
        _doMint(miner1);

        // advance block.number so PoAIWMint cooldown passes (3500 blocks)
        // but only advance block.timestamp by a small amount, insufficient for OracleVerifier MIN_VERIFY_INTERVAL (41000s)
        vm.roll(block.number + 3_500);
        // only advance 30000 seconds (< 41000 seconds MIN_VERIFY_INTERVAL)
        vm.warp(block.timestamp + 30_000);

        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 claimIndex = mint.epochClaimCount(miner1, gEpoch);
        uint256 deadline = block.number + 100;
        bytes memory sig = _signMint(ORACLE_PK_1, miner1, ERA1_MODEL, 5000, gEpoch, seed, claimIndex, deadline);

        vm.prank(miner1);
        vm.expectRevert(OracleVerifier.RateLimitExceeded.selector);
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, claimIndex, deadline, sig);
    }

    /// @notice [V4-I2] OracleVerifier rate limit passed then successful mint
    function test_OracleVerifier_RateLimitPassed() public {
        mint.updateSeed();
        _doMint(miner1);

        // advance sufficient block.number and block.timestamp
        vm.roll(block.number + 3_500);
        vm.warp(block.timestamp + 42_000); // > MIN_VERIFY_INTERVAL (41000)

        _doMint(miner1);
        assertEq(mint.totalClaims(), 2);
    }

    /// @notice [V4-I3] withdrawVote reentrancy safety: two consecutive withdrawVote calls on the same era, the second should revert
    function test_Governance_WithdrawVote_DoubleWithdrawReverts() public {
        // give miner1 some CLAW
        mint.updateSeed();
        _doMint(miner1);
        uint256 balance = token.balanceOf(miner1);

        // nomination
        _advanceBlocks(50_000 * 10);
        mint.updateSeed();
        vm.prank(miner1);
        mint.proposeModel("claude-opus-5");

        // voting
        _advanceBlocks(50_000 * 5);
        mint.updateSeed();
        bytes32 modelHash = keccak256("claude-opus-5");

        vm.startPrank(miner1);
        token.approve(address(mint), balance);
        mint.vote(modelHash, balance);
        vm.stopPrank();

        // advance to announcement phase then withdraw
        _advanceBlocks(50_000 * 5);
        mint.updateSeed();

        vm.prank(miner1);
        mint.withdrawVote(1);
        assertEq(token.balanceOf(miner1), balance);

        // second withdrawal should revert (amount is already 0)
        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.NothingToWithdraw.selector);
        mint.withdrawVote(1);
    }

    /// @notice [V4-I3] withdrawVote: user who never voted attempting to withdraw should revert
    function test_Governance_WithdrawVote_NeverVotedReverts() public {
        // advance to announcement phase
        _advanceBlocks(50_000 * 20);

        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.NothingToWithdraw.selector);
        mint.withdrawVote(1);
    }

    /// @notice [V3-I4] Era 25 should be rejected with MiningEnded
    function test_Era25_Rejected() public {
        // perBlockForEra(25) should return 0
        assertEq(mint.perBlockForEra(25), 0, "Era 25 perBlock should be 0");

        // advance to Era 25 (no need to finalize because MiningEnded reverts before model check)
        uint256 BLOCKS_PER_ERA = 1_050_000;
        _advanceBlocks(BLOCKS_PER_ERA * 24);

        assertEq(mint.currentEra(), 25, "Should be Era 25");
        assertTrue(mint.miningEnded(), "Mining should have ended");

        // attempting to mine should fail
        mint.updateSeed();
        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;
        bytes memory sig = _signMint(ORACLE_PK_1, miner1, ERA1_MODEL, 5000, gEpoch, seed, 0, deadline);

        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.MiningEnded.selector);
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, 0, deadline, sig);
    }
}
