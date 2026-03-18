# Smart Contracts

All CLAWING smart contracts are deployed on Ethereum mainnet. This page lists all contract addresses, their roles, and key interface details.

---

## Contract Addresses (Mainnet v2)

| Contract | Address | Role |
|---|---|---|
| **CLAW_Token** | `0x4ba1209b165b62a1f0d2fbf22d67cacf43a6df2b` | ERC-20 token |
| **PoAIWMint** | `0x511351940d99f3012c79c613478e8f2c887a8259` | Mining logic |
| **MinterProxy** | `0xe7fc311863b95e726a620b07607209965ee72bce` | Proxy / upgradeability |
| **OracleVerifier** | `0xc24a0ba99b9ff6b7ccea6beb4013b69f39024fd5` | Signature verification |

### Oracle Signer

| Property | Value |
|---|---|
| **Signer Address** | `0xB98253EE78AEED4a0E5554fB1390Dbf0b28cEFfF` |
| **Oracle URL** | `https://oracle.minewithclaw.com` |

## Etherscan Links

- [CLAW_Token on Etherscan](https://etherscan.io/address/0x4ba1209b165b62a1f0d2fbf22d67cacf43a6df2b)
- [PoAIWMint on Etherscan](https://etherscan.io/address/0x511351940d99f3012c79c613478e8f2c887a8259)
- [MinterProxy on Etherscan](https://etherscan.io/address/0xe7fc311863b95e726a620b07607209965ee72bce)
- [OracleVerifier on Etherscan](https://etherscan.io/address/0xc24a0ba99b9ff6b7ccea6beb4013b69f39024fd5)

---

## CLAW_Token

The core ERC-20 token contract implementing the $CLAW token.

### Properties

| Property | Value |
|---|---|
| Name | CLAWING |
| Symbol | CLAW |
| Decimals | 18 |
| Total Supply Cap | 210,000,000,000 (210B) |
| Standard | ERC-20 |

### Key Functions

```solidity
// Standard ERC-20
function name() external view returns (string memory);
function symbol() external view returns (string memory);
function decimals() external view returns (uint8);
function totalSupply() external view returns (uint256);
function balanceOf(address account) external view returns (uint256);
function transfer(address to, uint256 amount) external returns (bool);
function approve(address spender, uint256 amount) external returns (bool);
function transferFrom(address from, address to, uint256 amount) external returns (bool);
function allowance(address owner, address spender) external view returns (uint256);

// Minting (restricted to authorized minters)
function mint(address to, uint256 amount) external;
```

### Events

```solidity
event Transfer(address indexed from, address indexed to, uint256 value);
event Approval(address indexed owner, address indexed spender, uint256 value);
```

### Access Control

Only the PoAIWMint contract (via MinterProxy) can call `mint()`. Direct minting by external accounts is not permitted.

---

## PoAIWMint

The mining logic contract. Manages the entire mining lifecycle: eras, epochs, cooldowns, claim limits, and reward calculation.

### Key Functions

```solidity
// Mining
function claim(
    bytes calldata attestation,
    bytes calldata signature
) external returns (uint256 reward);

// Read State
function getCurrentEra() external view returns (uint256);
function getCurrentEpoch() external view returns (uint256);
function getPerBlock() external view returns (uint256);
function getCooldownRemaining(address miner) external view returns (uint256);
function getClaimCount(address miner, uint256 epoch) external view returns (uint256);
function getLastClaimBlock(address miner) external view returns (uint256);

// Constants
function COOLDOWN_BLOCKS() external view returns (uint256);  // 3,500
function MAX_CLAIMS_PER_EPOCH() external view returns (uint256);  // 14
function BLOCKS_PER_EPOCH() external view returns (uint256);  // 50,000
function EPOCHS_PER_ERA() external view returns (uint256);  // 21
function TOTAL_ERAS() external view returns (uint256);  // 24
```

### Events

```solidity
event Claim(
    address indexed miner,
    uint256 indexed era,
    uint256 indexed epoch,
    uint256 reward,
    uint256 blockNumber
);

event EraTransition(uint256 indexed newEra, uint256 newPerBlock);
event EpochTransition(uint256 indexed era, uint256 indexed newEpoch);
```

### Reward Calculation

```solidity
// Pseudocode for reward calculation
function calculateReward(address miner) internal view returns (uint256) {
    uint256 T = block.number - lastClaimBlock[miner];
    require(T >= COOLDOWN_BLOCKS, "Cooldown not met");

    uint256 reward = perBlock * (1e18 + ln(T * 1e18)) / 1e18;
    return reward;
}
```

The formula `R = perBlock * (1 + ln(T))` is implemented using fixed-point arithmetic with 18 decimal precision.

---

## OracleVerifier

Verifies Oracle attestation signatures. Confirms that the submitted attestation was signed by the authorized Oracle signer.

### Key Functions

```solidity
// Verification
function verify(
    bytes calldata attestation,
    bytes calldata signature
) external view returns (bool);

// Configuration
function getOracleSigner() external view returns (address);
```

### Verification Process

1. Extracts the message hash from the attestation data
2. Recovers the signer address from the ECDSA signature
3. Compares the recovered address to the stored Oracle signer
4. Returns `true` if they match, `false` otherwise

### Attestation Format

The attestation contains:

| Field | Type | Description |
|---|---|---|
| `miner` | `address` | The miner's Ethereum address |
| `nonce` | `bytes32` | Unique nonce from the Oracle |
| `blockRef` | `uint256` | Reference block number |
| `contentHash` | `bytes32` | Hash of the AI-generated content |
| `model` | `string` | AI model identifier |
| `timestamp` | `uint256` | Oracle signing timestamp |

---

## MinterProxy

A transparent proxy contract enabling upgradeable mining logic.

### Purpose

The MinterProxy sits between miners and the PoAIWMint implementation:

```
Miner ──> MinterProxy ──delegatecall──> PoAIWMint (implementation)
```

This allows the mining logic to be upgraded without:
- Changing the proxy address
- Redeploying the token contract
- Migrating any user state

### Key Functions

```solidity
// Admin (restricted)
function upgradeTo(address newImplementation) external;
function upgradeToAndCall(address newImplementation, bytes calldata data) external;

// Transparency
function implementation() external view returns (address);
function admin() external view returns (address);
```

### Upgrade Process

1. New implementation contract is deployed
2. Governance approves the upgrade
3. `upgradeTo()` is called on the proxy
4. All subsequent calls are delegated to the new implementation

---

## Interacting with Contracts

### Using ethers.js

```javascript
const { ethers } = require('ethers');

// Connect to Ethereum
const provider = new ethers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY');

// CLAW Token
const clawToken = new ethers.Contract(
    '0x4ba1209b165b62a1f0d2fbf22d67cacf43a6df2b',
    ['function balanceOf(address) view returns (uint256)',
     'function totalSupply() view returns (uint256)'],
    provider
);

// Check balance
const balance = await clawToken.balanceOf('0xYourAddress');
console.log('CLAW Balance:', ethers.formatUnits(balance, 18));

// PoAIWMint
const mint = new ethers.Contract(
    '0x511351940d99f3012c79c613478e8f2c887a8259',
    ['function getCurrentEra() view returns (uint256)',
     'function getCurrentEpoch() view returns (uint256)',
     'function getCooldownRemaining(address) view returns (uint256)'],
    provider
);

const era = await mint.getCurrentEra();
const epoch = await mint.getCurrentEpoch();
console.log(`Era: ${era}, Epoch: ${epoch}`);
```

### Using cast (Foundry)

```bash
# Check CLAW balance
cast call 0x4ba1209b165b62a1f0d2fbf22d67cacf43a6df2b \
    "balanceOf(address)(uint256)" \
    0xYourAddress

# Check current Era
cast call 0x511351940d99f3012c79c613478e8f2c887a8259 \
    "getCurrentEra()(uint256)"

# Check cooldown remaining
cast call 0x511351940d99f3012c79c613478e8f2c887a8259 \
    "getCooldownRemaining(address)(uint256)" \
    0xYourAddress
```

---

## Source Code

All contracts are open-source and available at:

- **GitHub**: [github.com/Cliai21/clawing](https://github.com/Cliai21/clawing)
- **Etherscan**: Verified source code on each contract's Etherscan page

## Next Steps

- [Architecture](architecture.md) — How the contracts interact
- [Oracle API](oracle-api.md) — Oracle server endpoint documentation
- [Security](security.md) — Security audit and threat model
- [CLI Reference](cli-reference.md) — Command-line interface for interacting with contracts
