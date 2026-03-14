// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {CLAW_Token} from "../src/CLAW_Token.sol";
import {OracleVerifier} from "../src/OracleVerifier.sol";
import {MinterProxy} from "../src/MinterProxy.sol";
import {PoAIWMint} from "../src/PoAIWMint.sol";

/**
 * @title Clawing deployment script v5.3 (Oracle Phase 1)
 * @notice One-click deployment of 4-contract architecture: Token + OracleVerifier + MinterProxy + PoAIWMint
 *
 * @dev Deployment order (resolving circular dependencies):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  CLAW_Token needs minter address (MinterProxy)                │
 *   │  MinterProxy needs token address + PoAIWMint address          │
 *   │  PoAIWMint needs MinterProxy + OracleVerifier address         │
 *   │  -> Circular dependency: Token <- MinterProxy <- PoAIWMint    │
 *   │                                                              │
 *   │  Solution: Nonce-Based pre-compute                           │
 *   │                                                              │
 *   │  1. Deploy OracleVerifier (standalone, no dependencies)      │
 *   │  2. Pre-compute MinterProxy address (nonce+1)                │
 *   │  3. Deploy CLAW_Token(predictedMinterProxy)                   │
 *   │  4. Deploy MinterProxy(token, predictedPoAIWMint, guardian)  │
 *   │     -> Verify address match                                  │
 *   │  5. Pre-compute PoAIWMint address known (nonce+3)            │
 *   │  6. Deploy PoAIWMint(minterProxy, verifier, era1Model)       │
 *   │  7. Verify all contracts cross-reference correctly            │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Usage:
 *   # Testnet (Sepolia)
 *   ORACLE_SIGNER_1=0x... ORACLE_SIGNER_2=0x... \
 *   forge script script/Deploy.s.sol:DeployClawing \
 *     --rpc-url $SEPOLIA_RPC_URL \
 *     --broadcast --verify -vvvv
 *
 *   # Mainnet
 *   ORACLE_SIGNER_1=0x... ORACLE_SIGNER_2=0x... \
 *   forge script script/Deploy.s.sol:DeployClawing \
 *     --rpc-url $ETH_RPC_URL \
 *     --broadcast --verify --slow -vvvv
 *
 * WARNING: Mainnet deployment notes [V3-I3]:
 *   1. Must use --slow flag to ensure serial transactions (prevent nonce misalignment)
 *   2. Before deployment, confirm the deployer address nonce (no other pending transactions)
 *   3. If deployment is interrupted, nonce offsets must be recalculated
 *   4. Currently uses nonce-based address pre-compute; can be upgraded to CREATE2 (Foundry create2 deployer)
 *      for deterministic addresses independent of nonce
 */
contract DeployClawing is Script {

    /// @dev Read Oracle signer array from environment variables (1-5 signers)
    function _readSigners() internal view returns (address[] memory) {
        address signer1 = vm.envAddress("ORACLE_SIGNER_1");
        address signer2 = vm.envOr("ORACLE_SIGNER_2", address(0));
        address signer3 = vm.envOr("ORACLE_SIGNER_3", address(0));
        address signer4 = vm.envOr("ORACLE_SIGNER_4", address(0));
        address signer5 = vm.envOr("ORACLE_SIGNER_5", address(0));

        // Count valid signers
        uint256 count = 1;
        if (signer2 != address(0)) count++;
        if (signer3 != address(0)) count++;
        if (signer4 != address(0)) count++;
        if (signer5 != address(0)) count++;

        address[] memory signers = new address[](count);
        signers[0] = signer1;
        uint256 idx = 1;
        if (signer2 != address(0)) signers[idx++] = signer2;
        if (signer3 != address(0)) signers[idx++] = signer3;
        if (signer4 != address(0)) signers[idx++] = signer4;
        if (signer5 != address(0)) signers[idx++] = signer5;

        return signers;
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address[] memory signers = _readSigners();
        string memory era1Model = vm.envOr("ERA1_MODEL", string("grok-4.1-fast"));
        address guardian = vm.envOr("GUARDIAN_ADDRESS", deployer);

        console.log("=== Clawing Phase 1 (Oracle) Deployment ===");
        console.log("Deployer:", deployer);
        console.log("Guardian:", guardian);
        console.log("Chain ID:", block.chainid);
        console.log("Oracle Signers:", signers.length);
        for (uint256 i = 0; i < signers.length; i++) {
            console.log("  Signer", i + 1, ":", signers[i]);
        }
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        uint256 currentNonce = vm.getNonce(deployer);

        // ═══ Nonce pre-compute ═══
        // nonce+0 → OracleVerifier
        // nonce+1 → CLAW_Token
        // nonce+2 → MinterProxy
        // nonce+3 → PoAIWMint

        address predictedMinterProxy = vm.computeCreateAddress(deployer, currentNonce + 2);
        address predictedPoAIWMint = vm.computeCreateAddress(deployer, currentNonce + 3);

        console.log("Predicted MinterProxy:", predictedMinterProxy);
        console.log("Predicted PoAIWMint:", predictedPoAIWMint);

        // ═══ Step 1: Deploy OracleVerifier (nonce+0) ═══
        OracleVerifier verifier = new OracleVerifier(signers);
        console.log("OracleVerifier deployed at:", address(verifier));
        console.log("  Oracle count:", verifier.oracleCount());

        // ═══ Step 2: Deploy CLAW_Token (nonce+1) ═══
        // Token's minter = MinterProxy (pre-computed address)
        CLAW_Token token = new CLAW_Token(predictedMinterProxy);
        console.log("CLAW_Token deployed at:", address(token));
        console.log("  minter (immutable):", token.minter());

        // ═══ Step 3: Deploy MinterProxy (nonce+2) ═══
        // initialMinter = predictedPoAIWMint, guardian = deployer
        MinterProxy proxy = new MinterProxy(
            address(token),
            predictedPoAIWMint,
            guardian
        );
        console.log("MinterProxy deployed at:", address(proxy));
        require(address(proxy) == predictedMinterProxy, "MinterProxy address mismatch!");
        console.log("  Address match: PASSED");

        // ═══ Step 4: Deploy PoAIWMint (nonce+3) ═══
        PoAIWMint mint = new PoAIWMint(address(proxy), address(verifier), era1Model);
        console.log("PoAIWMint deployed at:", address(mint));
        require(address(mint) == predictedPoAIWMint, "PoAIWMint address mismatch!");
        console.log("  Address match: PASSED");

        // ═══ Step 5: Cross-contract verification ═══
        _verifyDeployment(token, verifier, proxy, mint, guardian, era1Model);

        vm.stopBroadcast();
    }

    function _verifyDeployment(
        CLAW_Token token,
        OracleVerifier verifier,
        MinterProxy proxy,
        PoAIWMint mint,
        address guardian,
        string memory era1Model
    ) internal view {
        // Token → MinterProxy
        assert(token.minter() == address(proxy));
        // MinterProxy → Token
        assert(address(proxy.token()) == address(token));
        // MinterProxy → PoAIWMint (activeMinter)
        assert(proxy.activeMinter() == address(mint));
        // MinterProxy → Guardian
        assert(proxy.guardian() == guardian);
        // [V4-L3] MinterProxy initial state verification: ensure no active proposals at deployment
        assert(proxy.pendingMinter() == address(0));
        assert(proxy.proposalTimestamp() == 0);
        assert(proxy.cancellationCount() == 0);
        // PoAIWMint → MinterProxy
        assert(address(mint.minterProxy()) == address(proxy));
        // PoAIWMint → OracleVerifier
        assert(address(mint.verifier()) == address(verifier));
        // PoAIWMint → Era 1 Model
        assert(mint.eraModel(1) == keccak256(bytes(era1Model)));

        console.log("");
        console.log("=== All Cross-Reference Verifications PASSED ===");

        // ═══ Output summary ═══
        console.log("");
        console.log("========================================");
        console.log("  DEPLOYMENT SUMMARY (Phase 1 - Oracle)");
        console.log("========================================");
        console.log("CLAW_Token:       ", address(token));
        console.log("OracleVerifier:   ", address(verifier));
        console.log("MinterProxy:      ", address(proxy));
        console.log("PoAIWMint:        ", address(mint));
        console.log("Guardian:          ", guardian);
        console.log("Start Block:       ", mint.startBlock());
        console.log("Max Supply:        210,000,000,000 CLAW");
        console.log("Timelock:          7 days");
        console.log("========================================");
    }
}
