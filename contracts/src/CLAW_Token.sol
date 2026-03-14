// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CLAW_Token — CLAW ERC-20 Token
 * @author Clawing Community
 * @notice Zero premine · Immutable Minter · Minimal ERC-20
 *
 * @dev
 *   Design principles:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  MAX_SUPPLY   = 210,000,000,000 × 10^18 (210 billion)   │
 *   │  minter       = immutable (set at construction, cannot   │
 *   │                  be changed)                             │
 *   │  premine      = 0 (no tokens minted at construction)    │
 *   │  admin/owner  = none (zero governance backdoor)         │
 *   │  permit/EIP2612 = not integrated (minimal attack        │
 *   │                    surface)                              │
 *   └──────────────────────────────────────────────────────────┘
 *
 *   Security guarantees:
 *   - totalMinted only increases, checked against MAX_SUPPLY before mint
 *   - minter is immutable, no one can modify it after deployment
 *   - no pause / blacklist / freeze functionality
 *   - no owner / admin / upgradeability
 *
 *   Standard compliance: ERC-20 (EIP-20)
 *   Reference implementation: OpenZeppelin 5.x (manually inlined to reduce external dependencies)
 */
contract CLAW_Token {

    // ═══════════════════ Token Metadata ═══════════════════

    string public constant name = "CLAWING";
    string public constant symbol = "CLAW";
    uint8 public constant decimals = 18;

    // ═══════════════════ Supply ═══════════════════

    /// @notice Maximum supply: 210 billion CLAW (with 18 decimals)
    uint256 public constant MAX_SUPPLY = 210_000_000_000 * 1e18;

    /// @notice Current total supply
    uint256 public totalSupply;

    /// @notice Cumulative minted amount (only increases, never decreases)
    uint256 public totalMinted;

    // ═══════════════════ Sole Minter ═══════════════════

    /// @notice The sole address authorized to call mint() (PoAIWMint contract)
    /// @dev immutable — cannot be changed after construction, no function can alter this value
    address public immutable minter;

    // ═══════════════════ Balances and Allowances ═══════════════════

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ═══════════════════ Events (ERC-20) ═══════════════════

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // ═══════════════════ Errors ═══════════════════

    error NotMinter();
    error ExceedsMaxSupply();
    error InsufficientBalance();
    error InsufficientAllowance();
    error ZeroAddress();

    // ═══════════════════ Constructor ═══════════════════

    /**
     * @notice Deploy the CLAW token
     * @param _minter PoAIWMint contract address — the sole address authorized to mint
     * @dev No tokens are minted at construction (zero premine), minter is set as immutable
     */
    constructor(address _minter) {
        if (_minter == address(0)) revert ZeroAddress();
        minter = _minter;
    }

    // ═══════════════════ Minting ═══════════════════

    /**
     * @notice Mint new tokens — only callable by the minter
     * @param to Recipient address
     * @param amount Minting amount (with 18 decimals)
     * @dev Checks totalMinted + amount <= MAX_SUPPLY before minting
     */
    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        if (to == address(0)) revert ZeroAddress();
        if (totalMinted + amount > MAX_SUPPLY) revert ExceedsMaxSupply();

        // Safety note: totalMinted and totalSupply cannot overflow because:
        //   totalMinted <= MAX_SUPPLY = 210B × 1e18 = ~2.1e29 << 2^256 ≈ 1.16e77
        // balanceOf[to] likewise: any address balance <= totalSupply <= MAX_SUPPLY
        // However, for defense-in-depth, balanceOf uses checked arithmetic
        unchecked {
            totalMinted += amount;
            totalSupply += amount;
        }
        balanceOf[to] += amount; // checked: reverts on overflow

        emit Transfer(address(0), to, amount);
    }

    // ═══════════════════ ERC-20 Standard Functions ═══════════════════

    /**
     * @notice Transfer
     */
    function transfer(address to, uint256 amount) external returns (bool) {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();

        unchecked {
            balanceOf[msg.sender] -= amount; // safe: checked above
        }
        balanceOf[to] += amount; // checked: defense-in-depth

        emit Transfer(msg.sender, to, amount);
        return true;
    }

    /**
     * @notice Approve third-party transfer
     */
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /**
     * @notice Delegated transfer (transferFrom)
     */
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[from] < amount) revert InsufficientBalance();

        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            unchecked {
                allowance[from][msg.sender] = allowed - amount;
            }
        }

        unchecked {
            balanceOf[from] -= amount; // safe: checked above
        }
        balanceOf[to] += amount; // checked: defense-in-depth

        emit Transfer(from, to, amount);
        return true;
    }
}
