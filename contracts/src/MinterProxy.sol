// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CLAW_Token} from "./CLAW_Token.sol";

/**
 * @title MinterProxy — upgradeable minting proxy + key rotation support
 * @author Clawing Community
 * @notice CLAW_Token's immutable minter points to this contract.
 *         This contract maintains activeMinter (the contract address currently authorized to mint).
 *         Supports Phase 1 → Phase 2 upgrade and Oracle key rotation.
 *
 * @dev
 *   security design:
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │  CLAW_Token.minter (immutable) = MinterProxy                       │
 *   │                                                                      │
 *   │  MinterProxy.activeMinter = PoAIWMint (switchable)                   │
 *   │                                                                      │
 *   │  switching process (Timelock enforced):                               │
 *   │    1. Anyone calls proposeMinter(newMinter) to initiate proposal     │
 *   │    2. Wait for TIMELOCK_DELAY (7 days)                               │
 *   │    3. Anyone calls executeMinterChange() to take effect              │
 *   │    4. Anyone can call cancelMinterChange() to cancel in the meantime │
 *   │                                                                      │
 *   │  Key security guarantees:                                             │
 *   │  - guardian = deployer address, can propose/cancel (cannot bypass     │
 *   │    timelock)                                                         │
 *   │  - 7-day timelock gives community sufficient time to review new      │
 *   │    minter                                                            │
 *   │  - New minter must be a contract address (cannot be an EOA)          │
 *   │  - Proposal can be cancelled: if community finds issues with new     │
 *   │    minter                                                            │
 *   │  - Guardian can renounce authority (renounce) → full                 │
 *   │    decentralization                                                  │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 *   Use cases:
 *   - Phase 1 → Phase 2: switch activeMinter from PoAIWMint_Oracle to PoAIWMint_ZK
 *   - Oracle key compromise: deploy new PoAIWMint (pointing to new OracleVerifier), then switch
 *   - emergency fix: deploy fixed contract, switch via timelock
 */
contract MinterProxy {

    // ═══════════════════ core state ═══════════════════

    /// @notice token contract reference
    CLAW_Token public immutable token;

    /// @notice Contract address currently authorized to mint through this proxy
    address public activeMinter;

    /// @notice guardian address (authorized to initiate proposals and cancel)
    /// @dev Can renounce authority via renounceGuardian(), after which no one can propose switching
    address public guardian;

    // ═══════════════════ Timelock Parameters ═══════════════════

    /// @notice minimum waiting time from proposal to execution: 7 days (in seconds)
    uint256 public constant TIMELOCK_DELAY = 7 days;

    /// @notice proposal expiry time: expires if not executed within 14 days after proposal
    uint256 public constant PROPOSAL_EXPIRY = 14 days;

    // ═══════════════════ Guardian Cancellation Limits ═══════════════════

    /// @notice Maximum number of times the Guardian can cancel proposals
    uint256 public constant MAX_CANCELLATIONS = 3;

    /// @notice Cumulative number of cancelled proposals
    uint256 public cancellationCount;

    // ═══════════════════ proposal state ═══════════════════

    /// @notice pending new minter address
    address public pendingMinter;

    /// @notice proposal timestamp (used for timelock calculation)
    uint256 public proposalTimestamp;

    // ═══════════════════ Events ═══════════════════

    /// @dev [V4-L2] newMinter is indexed for off-chain monitoring tools to filter proposal events by address
    event MinterProposed(address indexed newMinter, uint256 executeAfter, address indexed proposer);
    event MinterChanged(address indexed oldMinter, address indexed newMinter);
    event ProposalCancelled(address indexed cancelledMinter);
    event GuardianRenounced(address indexed oldGuardian);

    // ═══════════════════ Errors ═══════════════════

    error NotActiveMinter();
    error NotGuardian();
    error GuardianRenounced_Error();
    error ZeroAddress();
    error NotContract();
    error NoProposal();
    error TimelockNotMet();
    error ProposalExpired();
    error ProposalAlreadyExists();
    error MaxCancellationsReached();

    // ═══════════════════ Modifiers ═══════════════════

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    // ═══════════════════ constructor ═══════════════════

    /**
     * @notice deploy MinterProxy
     * @param _token CLAW_Token address
     * @param _initialMinter Initial activeMinter (PoAIWMint contract)
     * @param _guardian guardian address (typically the deployer)
     */
    constructor(address _token, address _initialMinter, address _guardian) {
        if (_token == address(0)) revert ZeroAddress();
        if (_initialMinter == address(0)) revert ZeroAddress();
        if (_guardian == address(0)) revert ZeroAddress();

        token = CLAW_Token(_token);
        activeMinter = _initialMinter;
        guardian = _guardian;
    }

    // ═══════════════════ minting proxy ═══════════════════

    /**
     * @notice proxy minting — only activeMinter can call
     * @dev CLAW_Token sees msg.sender as MinterProxy.
     *      MinterProxy checks whether the original caller is the activeMinter.
     */
    function mint(address to, uint256 amount) external {
        if (msg.sender != activeMinter) revert NotActiveMinter();
        token.mint(to, amount);
    }

    // ═══════════════════ Minter Switching (Timelock) ═══════════════════

    /**
     * @notice propose switching activeMinter (starts 7-day timelock)
     * @param newMinter New minter contract address
     */
    function proposeMinter(address newMinter) external onlyGuardian {
        if (newMinter == address(0)) revert ZeroAddress();

        // Auto-cleanup expired proposals
        if (pendingMinter != address(0)) {
            if (block.timestamp > proposalTimestamp + PROPOSAL_EXPIRY) {
                // Expired — auto-clear
                pendingMinter = address(0);
                proposalTimestamp = 0;
            } else {
                revert ProposalAlreadyExists();
            }
        }

        // Note: extcodesize returns 0 for contracts during their constructor.
        // However, this is mitigated by the 7-day timelock — by execution time,
        // the contract will be fully deployed. The guardian should verify the
        // proposed address before calling execute.
        if (newMinter.code.length == 0) revert NotContract();

        pendingMinter = newMinter;
        proposalTimestamp = block.timestamp;

        emit MinterProposed(newMinter, block.timestamp + TIMELOCK_DELAY, msg.sender);
    }

    /**
     * @notice execute minter switch (anyone can call after timelock expires)
     * @dev Anyone can execute = trustless: guardian cooperation not required
     */
    function executeMinterChange() external {
        if (pendingMinter == address(0)) revert NoProposal();
        if (block.timestamp < proposalTimestamp + TIMELOCK_DELAY) revert TimelockNotMet();
        if (block.timestamp > proposalTimestamp + PROPOSAL_EXPIRY) revert ProposalExpired();

        // Double-check contract exists at execution time (mitigates constructor-time bypass)
        if (pendingMinter.code.length == 0) revert NotContract();

        address oldMinter = activeMinter;
        address newMinter = pendingMinter;

        activeMinter = newMinter;
        pendingMinter = address(0);
        proposalTimestamp = 0;

        emit MinterChanged(oldMinter, newMinter);
    }

    /**
     * @notice cancel current proposal (only guardian can call)
     * @dev If the community review finds issues with the new minter, guardian can cancel
     */
    function cancelMinterChange() external onlyGuardian {
        if (pendingMinter == address(0)) revert NoProposal();
        if (cancellationCount >= MAX_CANCELLATIONS) revert MaxCancellationsReached();

        address cancelled = pendingMinter;
        pendingMinter = address(0);
        proposalTimestamp = 0;
        cancellationCount++;

        emit ProposalCancelled(cancelled);
    }

    /**
     * @notice Guardian renounce authority (irreversible)
     * @dev After this, no one can propose switching minter → activeMinter is permanently locked.
     *      Suitable after Phase 2 stabilizes for full decentralization.
     */
    function renounceGuardian() external onlyGuardian {
        address old = guardian;
        guardian = address(0);
        emit GuardianRenounced(old);
    }

    // ═══════════════════ view functions ═══════════════════

    /// @notice query remaining timelock time (seconds)
    function timelockRemaining() external view returns (uint256) {
        if (pendingMinter == address(0)) return 0;
        uint256 executeAfter = proposalTimestamp + TIMELOCK_DELAY;
        if (block.timestamp >= executeAfter) return 0;
        return executeAfter - block.timestamp;
    }

    /// @notice query whether proposal has expired
    function isProposalExpired() external view returns (bool) {
        if (pendingMinter == address(0)) return false;
        return block.timestamp > proposalTimestamp + PROPOSAL_EXPIRY;
    }
}
