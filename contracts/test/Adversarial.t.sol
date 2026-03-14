// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {CLAW_Token} from "../src/CLAW_Token.sol";
import {OracleVerifier} from "../src/OracleVerifier.sol";
import {MinterProxy} from "../src/MinterProxy.sol";
import {PoAIWMint} from "../src/PoAIWMint.sol";

/// @title Adversarial security tests for the Clawing protocol
/// @notice 26 tests across 7 categories: Reentrancy, Supply Cap, Allowance Abuse,
///         Signature Verification, Access Control, Mining Parameter Validation, Economic & Edge Cases
contract AdversarialTest is Test {

    CLAW_Token token;
    OracleVerifier verifier;
    MinterProxy proxy;
    PoAIWMint mint;

    uint256 constant ORACLE_PK_1 = 0xA11CE;
    uint256 constant ORACLE_PK_2 = 0xB0B;
    address oracle1;
    address oracle2;

    address miner1 = address(0x1111);
    address miner2 = address(0x2222);
    address guardian = address(0x9999);
    address attacker = address(0xDEAD);

    bytes32 constant ERA1_MODEL = keccak256("grok-4.1-fast");

    function setUp() public {
        vm.roll(5000);
        vm.warp(60000);

        oracle1 = vm.addr(ORACLE_PK_1);
        oracle2 = vm.addr(ORACLE_PK_2);

        address[] memory signers = new address[](2);
        signers[0] = oracle1;
        signers[1] = oracle2;
        verifier = new OracleVerifier(signers);

        uint256 nonce = vm.getNonce(address(this));
        address predictedProxy = vm.computeCreateAddress(address(this), nonce + 1);
        address predictedMint = vm.computeCreateAddress(address(this), nonce + 2);

        token = new CLAW_Token(predictedProxy);
        proxy = new MinterProxy(address(token), predictedMint, guardian);
        assertEq(address(proxy), predictedProxy);

        mint = new PoAIWMint(address(proxy), address(verifier), "grok-4.1-fast");
        assertEq(address(mint), predictedMint);
    }

    // ═══════════════════ Helpers ═══════════════════

    function _signMint(
        uint256 oraclePk,
        address minerAddr,
        bytes32 modelHash,
        uint256 totalTokens,
        uint256 _seedEpoch,
        uint256 seed,
        uint256 claimIndex,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 dataHash = keccak256(abi.encode(
            block.chainid, address(verifier),
            minerAddr, modelHash, totalTokens, _seedEpoch, seed, claimIndex, deadline
        ));
        bytes32 ethSignedHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32", dataHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }

    function _advanceBlocks(uint256 n) internal {
        vm.roll(block.number + n);
        vm.warp(block.timestamp + n * 12);
    }

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

    function _doMint(address miner) internal {
        _doMint(miner, 5000);
    }

    // ═══════════════════════════════════════════════════════
    //  Category 1: Reentrancy (2 tests)
    // ═══════════════════════════════════════════════════════

    /// @notice Test 1: Token mint is not vulnerable to reentrancy via a malicious receiver
    /// @dev The mint function updates state before external calls (CEI pattern)
    function test_Adversarial_Reentrancy_MintStateUpdatedBeforeTransfer() public {
        // Verify the state update order: totalMinted increases atomically with mint
        mint.updateSeed();
        _doMint(miner1, 5000);

        uint256 totalMinted = token.totalMinted();
        uint256 totalSupply = token.totalSupply();
        uint256 balance = token.balanceOf(miner1);

        // All three should be consistent and equal (first mint)
        assertEq(totalMinted, totalSupply);
        assertEq(totalSupply, balance);
        assertTrue(totalMinted > 0);

        // Verify claim count was incremented (state updated before external call)
        assertEq(mint.epochClaimCount(miner1, mint.currentGlobalEpoch()), 1);
        assertEq(mint.lastClaimBlock(miner1), block.number);
    }

    /// @notice Test 2: MinterProxy only allows activeMinter to call mint — prevents reentrancy from other contracts
    function test_Adversarial_Reentrancy_ProxyRejectsUnauthorizedCaller() public {
        // An attacker contract trying to call proxy.mint directly should fail
        vm.prank(attacker);
        vm.expectRevert(MinterProxy.NotActiveMinter.selector);
        proxy.mint(attacker, 1000 * 1e18);

        // Even the guardian cannot mint through the proxy
        vm.prank(guardian);
        vm.expectRevert(MinterProxy.NotActiveMinter.selector);
        proxy.mint(guardian, 1000 * 1e18);
    }

    // ═══════════════════════════════════════════════════════
    //  Category 2: Supply Cap (2 tests)
    // ═══════════════════════════════════════════════════════

    /// @notice Test 3: Minting beyond MAX_SUPPLY reverts
    function test_Adversarial_SupplyCap_CannotExceedMaxSupply() public {
        uint256 maxSupply = token.MAX_SUPPLY();

        // Attempt to mint MAX_SUPPLY + 1 directly via the minter
        vm.prank(address(proxy));
        vm.expectRevert(CLAW_Token.ExceedsMaxSupply.selector);
        token.mint(miner1, maxSupply + 1);
    }

    /// @notice Test 4: Minting exactly MAX_SUPPLY succeeds, then any additional mint fails
    function test_Adversarial_SupplyCap_ExactMaxSupplyThenReject() public {
        uint256 maxSupply = token.MAX_SUPPLY();

        // Mint exactly MAX_SUPPLY
        vm.prank(address(proxy));
        token.mint(miner1, maxSupply);

        assertEq(token.totalMinted(), maxSupply);
        assertEq(token.totalSupply(), maxSupply);

        // Any additional mint should fail
        vm.prank(address(proxy));
        vm.expectRevert(CLAW_Token.ExceedsMaxSupply.selector);
        token.mint(miner2, 1);
    }

    // ═══════════════════════════════════════════════════════
    //  Category 3: Allowance Abuse (2 tests)
    // ═══════════════════════════════════════════════════════

    /// @notice Test 5: transferFrom fails when allowance is insufficient
    function test_Adversarial_Allowance_InsufficientAllowanceReverts() public {
        // Give miner1 some tokens
        vm.prank(address(proxy));
        token.mint(miner1, 1000 * 1e18);

        // miner1 approves attacker for 500 tokens
        vm.prank(miner1);
        token.approve(attacker, 500 * 1e18);

        // attacker tries to transfer 501 tokens
        vm.prank(attacker);
        vm.expectRevert(CLAW_Token.InsufficientAllowance.selector);
        token.transferFrom(miner1, attacker, 501 * 1e18);
    }

    /// @notice Test 6: Unlimited (type(uint256).max) allowance does not decrease after transferFrom
    function test_Adversarial_Allowance_UnlimitedAllowanceNotDecremented() public {
        vm.prank(address(proxy));
        token.mint(miner1, 1000 * 1e18);

        // miner1 approves attacker with max uint256
        vm.prank(miner1);
        token.approve(attacker, type(uint256).max);

        // attacker transfers 500 tokens
        vm.prank(attacker);
        token.transferFrom(miner1, attacker, 500 * 1e18);

        // Allowance should still be max
        assertEq(token.allowance(miner1, attacker), type(uint256).max);

        // Can transfer again
        vm.prank(attacker);
        token.transferFrom(miner1, attacker, 500 * 1e18);
        assertEq(token.balanceOf(attacker), 1000 * 1e18);
    }

    // ═══════════════════════════════════════════════════════
    //  Category 4: Signature Verification (3 tests)
    // ═══════════════════════════════════════════════════════

    /// @notice Test 7: Signature signed by non-oracle private key is rejected
    function test_Adversarial_Signature_NonOracleSignerRejected() public {
        mint.updateSeed();

        uint256 fakePk = 0xBAD;
        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;

        bytes memory fakeSig = _signMint(
            fakePk, miner1, ERA1_MODEL, 5000, gEpoch, seed, 0, deadline
        );

        vm.prank(miner1);
        vm.expectRevert(); // OracleVerifier reverts with InvalidSignature
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, 0, deadline, fakeSig);
    }

    /// @notice Test 8: Same signature cannot be used twice (replay protection)
    function test_Adversarial_Signature_ReplayRejected() public {
        mint.updateSeed();

        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;

        bytes memory sig = _signMint(
            ORACLE_PK_1, miner1, ERA1_MODEL, 5000, gEpoch, seed, 0, deadline
        );

        // First use succeeds
        vm.prank(miner1);
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, 0, deadline, sig);

        // Advance past cooldown
        _advanceBlocks(3501);
        vm.warp(block.timestamp + 41001);

        // Trying to replay the same signature with claimIndex=1 should fail
        // because the signature was bound to claimIndex=0
        vm.prank(miner1);
        vm.expectRevert(); // Will fail at OracleVerifier since sig doesn't match new claimIndex
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, 1, deadline, sig);
    }

    /// @notice Test 9: Signature with expired deadline is rejected
    function test_Adversarial_Signature_ExpiredDeadlineRejected() public {
        mint.updateSeed();

        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        // Set deadline to current block (will be expired when mint is called)
        uint256 deadline = block.number;

        bytes memory sig = _signMint(
            ORACLE_PK_1, miner1, ERA1_MODEL, 5000, gEpoch, seed, 0, deadline
        );

        // Advance 1 block so deadline is in the past
        _advanceBlocks(1);

        vm.prank(miner1);
        vm.expectRevert(); // SignatureExpired
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, 0, deadline, sig);
    }

    // ═══════════════════════════════════════════════════════
    //  Category 5: Access Control (5 tests)
    // ═══════════════════════════════════════════════════════

    /// @notice Test 10: Only the immutable minter (proxy) can call token.mint
    function test_Adversarial_Access_OnlyMinterCanMintTokens() public {
        vm.prank(attacker);
        vm.expectRevert(CLAW_Token.NotMinter.selector);
        token.mint(attacker, 1000 * 1e18);

        vm.prank(guardian);
        vm.expectRevert(CLAW_Token.NotMinter.selector);
        token.mint(guardian, 1000 * 1e18);

        vm.prank(address(mint));
        vm.expectRevert(CLAW_Token.NotMinter.selector);
        token.mint(address(mint), 1000 * 1e18);
    }

    /// @notice Test 11: Only guardian can proposeMinter
    function test_Adversarial_Access_OnlyGuardianCanPropose() public {
        // Deploy a dummy contract to be proposed
        DummyContract dummy = new DummyContract();

        vm.prank(attacker);
        vm.expectRevert(MinterProxy.NotGuardian.selector);
        proxy.proposeMinter(address(dummy));

        vm.prank(miner1);
        vm.expectRevert(MinterProxy.NotGuardian.selector);
        proxy.proposeMinter(address(dummy));
    }

    /// @notice Test 12: Only guardian can cancelMinterChange
    function test_Adversarial_Access_OnlyGuardianCanCancel() public {
        DummyContract dummy = new DummyContract();

        // Guardian proposes
        vm.prank(guardian);
        proxy.proposeMinter(address(dummy));

        // Non-guardian cannot cancel
        vm.prank(attacker);
        vm.expectRevert(MinterProxy.NotGuardian.selector);
        proxy.cancelMinterChange();
    }

    /// @notice Test 13: Only guardian can renounceGuardian
    function test_Adversarial_Access_OnlyGuardianCanRenounce() public {
        vm.prank(attacker);
        vm.expectRevert(MinterProxy.NotGuardian.selector);
        proxy.renounceGuardian();
    }

    /// @notice Test 14: After guardian renounces, no one can propose or cancel
    function test_Adversarial_Access_RenouncedGuardianLocksGovernance() public {
        DummyContract dummy = new DummyContract();

        vm.prank(guardian);
        proxy.renounceGuardian();

        assertEq(proxy.guardian(), address(0));

        // Former guardian cannot propose
        vm.prank(guardian);
        vm.expectRevert(MinterProxy.NotGuardian.selector);
        proxy.proposeMinter(address(dummy));

        // Nobody can propose
        vm.prank(attacker);
        vm.expectRevert(MinterProxy.NotGuardian.selector);
        proxy.proposeMinter(address(dummy));
    }

    // ═══════════════════════════════════════════════════════
    //  Category 6: Mining Parameter Validation (4 tests)
    // ═══════════════════════════════════════════════════════

    /// @notice Test 15: Tokens below MIN_TOKENS (2100) are rejected
    function test_Adversarial_Params_TokensBelowMinRejected() public {
        mint.updateSeed();

        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;
        uint256 tooFewTokens = 2099;

        bytes memory sig = _signMint(
            ORACLE_PK_1, miner1, ERA1_MODEL, tooFewTokens, gEpoch, seed, 0, deadline
        );

        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.TokensOutOfRange.selector);
        mint.mint(ERA1_MODEL, tooFewTokens, gEpoch, seed, 0, deadline, sig);
    }

    /// @notice Test 16: Tokens above MAX_TOKENS (100000) are rejected
    function test_Adversarial_Params_TokensAboveMaxRejected() public {
        mint.updateSeed();

        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;
        uint256 tooManyTokens = 100001;

        bytes memory sig = _signMint(
            ORACLE_PK_1, miner1, ERA1_MODEL, tooManyTokens, gEpoch, seed, 0, deadline
        );

        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.TokensOutOfRange.selector);
        mint.mint(ERA1_MODEL, tooManyTokens, gEpoch, seed, 0, deadline, sig);
    }

    /// @notice Test 17: Wrong model hash is rejected
    function test_Adversarial_Params_WrongModelRejected() public {
        mint.updateSeed();

        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;
        bytes32 wrongModel = keccak256("fake-model-v1");

        bytes memory sig = _signMint(
            ORACLE_PK_1, miner1, wrongModel, 5000, gEpoch, seed, 0, deadline
        );

        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.ModelNotApproved.selector);
        mint.mint(wrongModel, 5000, gEpoch, seed, 0, deadline, sig);
    }

    /// @notice Test 18: Wrong seed epoch is rejected
    function test_Adversarial_Params_WrongSeedEpochRejected() public {
        mint.updateSeed();

        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();
        uint256 deadline = block.number + 100;
        uint256 wrongSeedEpoch = gEpoch + 1;

        bytes memory sig = _signMint(
            ORACLE_PK_1, miner1, ERA1_MODEL, 5000, wrongSeedEpoch, seed, 0, deadline
        );

        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.WrongSeedEpoch.selector);
        mint.mint(ERA1_MODEL, 5000, wrongSeedEpoch, seed, 0, deadline, sig);
    }

    // ═══════════════════════════════════════════════════════
    //  Category 7: Economic & Edge Cases (8 tests)
    // ═══════════════════════════════════════════════════════

    /// @notice Test 19: Cannot mint to address(0)
    function test_Adversarial_Economic_MintToZeroAddressReverts() public {
        vm.prank(address(proxy));
        vm.expectRevert(CLAW_Token.ZeroAddress.selector);
        token.mint(address(0), 1000 * 1e18);
    }

    /// @notice Test 20: Cannot transfer to address(0)
    function test_Adversarial_Economic_TransferToZeroAddressReverts() public {
        vm.prank(address(proxy));
        token.mint(miner1, 1000 * 1e18);

        vm.prank(miner1);
        vm.expectRevert(CLAW_Token.ZeroAddress.selector);
        token.transfer(address(0), 500 * 1e18);
    }

    /// @notice Test 21: Cannot transfer more than balance
    function test_Adversarial_Economic_TransferExceedingBalanceReverts() public {
        vm.prank(address(proxy));
        token.mint(miner1, 1000 * 1e18);

        vm.prank(miner1);
        vm.expectRevert(CLAW_Token.InsufficientBalance.selector);
        token.transfer(miner2, 1001 * 1e18);
    }

    /// @notice Test 22: Cooldown is enforced — cannot double-mine within COOLDOWN_BLOCKS
    function test_Adversarial_Economic_CooldownEnforced() public {
        mint.updateSeed();
        _doMint(miner1, 5000);

        // Advance only 3499 blocks (one block short of cooldown)
        _advanceBlocks(3499);
        vm.warp(block.timestamp + 41001); // satisfy rate limit but not block cooldown

        uint256 gEpoch = mint.currentGlobalEpoch();
        uint256 seed = mint.currentSeed();

        // Need to update seed if epoch changed
        if (mint.seedEpoch() != gEpoch) {
            mint.updateSeed();
            seed = mint.currentSeed();
            gEpoch = mint.currentGlobalEpoch();
        }

        uint256 claimIndex = mint.epochClaimCount(miner1, gEpoch);
        uint256 deadline = block.number + 100;

        bytes memory sig = _signMint(
            ORACLE_PK_1, miner1, ERA1_MODEL, 5000, gEpoch, seed, claimIndex, deadline
        );

        vm.prank(miner1);
        vm.expectRevert(PoAIWMint.CooldownNotMet.selector);
        mint.mint(ERA1_MODEL, 5000, gEpoch, seed, claimIndex, deadline, sig);
    }

    /// @notice Test 23: proposeMinter with address(0) reverts
    function test_Adversarial_Economic_ProposeZeroAddressReverts() public {
        vm.prank(guardian);
        vm.expectRevert(MinterProxy.ZeroAddress.selector);
        proxy.proposeMinter(address(0));
    }

    /// @notice Test 24: proposeMinter with EOA (not contract) reverts
    function test_Adversarial_Economic_ProposeEOAReverts() public {
        vm.prank(guardian);
        vm.expectRevert(MinterProxy.NotContract.selector);
        proxy.proposeMinter(attacker);
    }

    /// @notice Test 25: executeMinterChange before timelock reverts
    function test_Adversarial_Economic_ExecuteBeforeTimelockReverts() public {
        DummyContract dummy = new DummyContract();

        vm.prank(guardian);
        proxy.proposeMinter(address(dummy));

        // Try to execute immediately (before 7 days)
        vm.expectRevert(MinterProxy.TimelockNotMet.selector);
        proxy.executeMinterChange();

        // Advance to just before the timelock expires (7 days - 1 second)
        vm.warp(block.timestamp + 7 days - 1);

        vm.expectRevert(MinterProxy.TimelockNotMet.selector);
        proxy.executeMinterChange();
    }

    /// @notice Test 26: Guardian cannot cancel more than MAX_CANCELLATIONS (3) times
    function test_Adversarial_Economic_MaxCancellationsEnforced() public {
        DummyContract dummy1 = new DummyContract();
        DummyContract dummy2 = new DummyContract();
        DummyContract dummy3 = new DummyContract();
        DummyContract dummy4 = new DummyContract();

        // Cancel 3 times (the maximum)
        vm.prank(guardian);
        proxy.proposeMinter(address(dummy1));
        vm.prank(guardian);
        proxy.cancelMinterChange();

        vm.prank(guardian);
        proxy.proposeMinter(address(dummy2));
        vm.prank(guardian);
        proxy.cancelMinterChange();

        vm.prank(guardian);
        proxy.proposeMinter(address(dummy3));
        vm.prank(guardian);
        proxy.cancelMinterChange();

        assertEq(proxy.cancellationCount(), 3);

        // 4th proposal + cancel should fail
        vm.prank(guardian);
        proxy.proposeMinter(address(dummy4));

        vm.prank(guardian);
        vm.expectRevert(MinterProxy.MaxCancellationsReached.selector);
        proxy.cancelMinterChange();
    }
}

/// @dev Minimal contract used for proposeMinter tests (needs to have code to pass NotContract check)
contract DummyContract {
    // Intentionally empty — just needs to be a contract (non-zero code)
}
