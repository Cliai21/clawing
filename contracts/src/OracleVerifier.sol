// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title OracleVerifier v2.1 — multi-node Oracle ECDSA signature verifier
 * @author Clawing Community
 * @notice Phase 1: multi-Oracle node signature verification + replay protection + rate limiting + time window
 *         Phase 2: upgrade to TLSNotary + SP1 ZK verification (switch via MinterProxy)
 *
 * @dev
 *   Architecture position (Phase 1):
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │  PoAIWMint → OracleVerifier → ecrecover (EVM native, multi-signer) │
 *   │  (mining logic) (Oracle address binding) (ECDSA signature recovery) │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 *   Multi-node scheme:
 *   - Up to 5 Oracle signers (any valid one passes)
 *   - Signer list is determined at construction, immutable
 *   - Any Oracle node can sign independently, no multi-sig coordination needed
 *   - Nodes are mutually redundant: one going down does not affect mining
 *
 *   Anti-cheat:
 *   - Signature replay protection: usedSignatures mapping
 *   - Rate limiting: at least MIN_VERIFY_INTERVAL seconds between two verify calls for the same miner address
 *   - Time window: signature contains deadline, rejected if expired
 *
 *   Signature message format (EIP-191):
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  messageHash = keccak256(abi.encodePacked(               │
 *   │      "\x19Ethereum Signed Message:\n32",                  │
 *   │      keccak256(abi.encode(                                │
 *   │          block.chainid,  // chain ID (cross-chain replay protection)        │
 *   │          address(this),  // verifier address (contract replay protection)   │
 *   │          minerAddress,   // miner address                                   │
 *   │          modelHash,      // keccak256(model ID)                             │
 *   │          totalTokens,    // LLM token consumption                           │
 *   │          seedEpoch,      // Epoch number                                    │
 *   │          seed,           // Epoch Seed                                      │
 *   │          claimIndex,     // claim index                                     │
 *   │          deadline        // signature expiry block number                   │
 *   │      ))                                                    │
 *   │  ))                                                        │
 *   └────────────────────────────────────────────────────────────┘
 *
 *   Gas budget: ~10,000 (ecrecover 3000 + SSTORE 5000 + logic 2000)
 */
contract OracleVerifier {

    // ═══════════════════ Oracle signers (multi-node) ═══════════════════

    /// @notice Oracle signer address array (up to 5, immutable semantics)
    /// @dev Written at construction, immutable afterwards. Uses array + count to simulate immutable array
    address[5] internal _oracleSigners;
    uint256 public immutable oracleCount;

    /// @notice Quick lookup: whether an address is a valid Oracle signer
    mapping(address => bool) public isOracleSigner;

    // ═══════════════════ Replay protection ═══════════════════

    /// @notice Used signature hash -> cannot be reused
    mapping(bytes32 => bool) public usedSignatures;

    // ═══════════════════ Rate limiting ═══════════════════

    /// @notice Last successful verification timestamp per miner
    mapping(address => uint256) public lastVerifyTimestamp;

    /// @notice Minimum interval between verifications (seconds)
    /// @dev Paired with PoAIWMint.COOLDOWN_BLOCKS (3,500 blocks), both approximately 11.67 hours.
    ///      This value serves as an on-chain "secondary safeguard" — even if PoAIWMint's block.number
    ///      cooldown is satisfied, it will still reject if the block.timestamp interval is insufficient.
    ///      Provides dual protection.
    ///      3500 blocks x 12 sec/block = 42000 sec, set to 41000 with margin. [V3-I5]
    uint256 public constant MIN_VERIFY_INTERVAL = 41_000;

    // ═══════════════════ Time window ═══════════════════

    /// @notice Maximum signature validity period (in blocks)
    /// @dev Set to 300 blocks ≈ 1 hour, to prevent signature hoarding
    uint256 public constant SIGNATURE_VALIDITY_BLOCKS = 300;

    // ═══════════════════ Events ═══════════════════

    /// @dev V3-I2: Added claimIndex parameter with indexing for off-chain querying of a specific miner's
    ///      verification history in a specific Epoch. Solidity events allow up to 3 indexed parameters,
    ///      keeping miner + modelHash + claimIndex. seedEpoch is unindexed (can be indirectly associated via claimIndex).
    event OracleVerified(
        address indexed miner,
        bytes32 indexed modelHash,
        uint256 totalTokens,
        uint256 seedEpoch,
        uint256 indexed claimIndex,
        address oracleSigner
    );

    // ═══════════════════ Errors ═══════════════════

    error InvalidSignature();
    error SignatureAlreadyUsed();
    error RateLimitExceeded();
    error SignatureExpired();
    error ZeroAddress();
    error TooManySigners();
    error NoSigners();
    error DuplicateSigner();
    error DeadlineTooFar();

    // ═══════════════════ Constructor ═══════════════════

    /**
     * @notice Deploy Oracle verifier (multi-node)
     * @param signers Oracle signer address array (1-5)
     * @dev Signer array is immutable after deployment.
     *      To add/remove signers, deploy a new contract and switch via MinterProxy.
     */
    constructor(address[] memory signers) {
        uint256 n = signers.length;
        if (n == 0) revert NoSigners();
        if (n > 5) revert TooManySigners();

        for (uint256 i = 0; i < n; i++) {
            if (signers[i] == address(0)) revert ZeroAddress();
            if (isOracleSigner[signers[i]]) revert DuplicateSigner();
            _oracleSigners[i] = signers[i];
            isOracleSigner[signers[i]] = true;
        }

        oracleCount = n;
    }

    // ═══════════════════ Core verification function ═══════════════════

    /**
     * @notice Verify Oracle signature (with replay protection + rate limiting + time window)
     * @param minerAddress Miner address
     * @param modelHash keccak256(model ID)
     * @param totalTokens Token consumption returned by AI API
     * @param seedEpoch Epoch number
     * @param seed Epoch Seed
     * @param claimIndex The miner's claim index in this Epoch
     * @param deadline Signature expiry block number
     * @param signature Oracle's ECDSA signature (65 bytes: r + s + v)
     * @return valid Whether the signature is valid
     */
    function verify(
        address minerAddress,
        bytes32 modelHash,
        uint256 totalTokens,
        uint256 seedEpoch,
        uint256 seed,
        uint256 claimIndex,
        uint256 deadline,
        bytes calldata signature
    ) external returns (bool valid) {
        // 1. Time window check: has the signature expired?
        if (block.number > deadline) revert SignatureExpired();

        // 1b. Deadline upper bound check: prevent Oracle from issuing signatures far into the future [V4-M1]
        if (deadline > block.number + SIGNATURE_VALIDITY_BLOCKS) revert DeadlineTooFar();

        // 2. Rate limiting check (on-chain secondary safeguard)
        {
            uint256 lastTs = lastVerifyTimestamp[minerAddress];
            if (lastTs != 0 && block.timestamp - lastTs < MIN_VERIFY_INTERVAL) {
                revert RateLimitExceeded();
            }
        }

        // 3. Construct EIP-191 signature hash (includes chainId + verifier address + deadline)
        bytes32 ethSignedHash = _computeEthSignedHash(
            minerAddress, modelHash, totalTokens, seedEpoch, seed, claimIndex, deadline
        );

        // 4. Replay protection check
        if (usedSignatures[ethSignedHash]) revert SignatureAlreadyUsed();

        // 5. Recover signer address from signature
        address recovered = _recover(ethSignedHash, signature);

        // 6. Verify it is a valid Oracle signer (reverts if invalid)
        if (!isOracleSigner[recovered]) revert InvalidSignature();

        // 7. Mark signature as used (replay protection)
        usedSignatures[ethSignedHash] = true;

        // 8. Update rate limiting timestamp
        lastVerifyTimestamp[minerAddress] = block.timestamp;

        emit OracleVerified(minerAddress, modelHash, totalTokens, seedEpoch, claimIndex, recovered);
        return true;
    }

    /**
     * @notice Pure view version — verify only without marking (for frontend pre-check)
     */
    function verifyView(
        address minerAddress,
        bytes32 modelHash,
        uint256 totalTokens,
        uint256 seedEpoch,
        uint256 seed,
        uint256 claimIndex,
        uint256 deadline,
        bytes calldata signature
    ) external view returns (bool valid) {
        if (block.number > deadline) return false;

        bytes32 ethSignedHash = _computeEthSignedHash(
            minerAddress, modelHash, totalTokens, seedEpoch, seed, claimIndex, deadline
        );

        if (usedSignatures[ethSignedHash]) return false;

        address recovered = _recover(ethSignedHash, signature);
        valid = isOracleSigner[recovered];
    }

    // ═══════════════════ Query functions ═══════════════════

    /// @notice Query the i-th Oracle signer address
    function oracleSignerAt(uint256 index) external view returns (address) {
        require(index < oracleCount, "Index out of bounds");
        return _oracleSigners[index];
    }

    // ═══════════════════ Internal functions ═══════════════════

    /**
     * @dev Construct EIP-191 signature hash (includes chainId + verifier address)
     */
    function _computeEthSignedHash(
        address minerAddress,
        bytes32 modelHash,
        uint256 totalTokens,
        uint256 seedEpoch,
        uint256 seed,
        uint256 claimIndex,
        uint256 deadline
    ) internal view returns (bytes32) {
        bytes32 dataHash = keccak256(abi.encode(
            block.chainid,    // cross-chain replay protection
            address(this),    // bound to this verifier contract
            minerAddress,
            modelHash,
            totalTokens,
            seedEpoch,
            seed,
            claimIndex,
            deadline
        ));
        return keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n32",
            dataHash
        ));
    }

    /**
     * @dev ECDSA signature recovery (extract r, s, v from 65-byte signature)
     */
    function _recover(
        bytes32 hash,
        bytes calldata signature
    ) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        // EIP-2: s value must be in the lower half order (signature malleability protection)
        require(
            uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0,
            "Invalid s value"
        );

        // v must be 27 or 28
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Invalid v value");

        address recovered = ecrecover(hash, v, r, s);
        require(recovered != address(0), "Invalid signature");

        return recovered;
    }
}
