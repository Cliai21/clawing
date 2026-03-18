# Architecture

CLAWING uses a three-contract architecture on Ethereum mainnet, with an off-chain Oracle server handling AI work verification. This design separates concerns — token logic, mining logic, and verification logic — enabling independent upgrades and clear security boundaries.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLAWING Architecture                     │
│                                                                 │
│  ┌───────────┐     ┌──────────────┐     ┌───────────────────┐  │
│  │   Miner   │────>│   AI Model   │     │                   │  │
│  │  Client   │     │ (grok-4.1)   │     │  Ethereum Mainnet │  │
│  └─────┬─────┘     └──────┬───────┘     │                   │  │
│        │                  │             │  ┌─────────────┐   │  │
│        │                  v             │  │ CLAW_Token  │   │  │
│        │           ┌──────────────┐     │  │  (ERC-20)   │   │  │
│        │           │    Oracle    │     │  └──────▲──────┘   │  │
│        │           │   Server     │     │         │          │  │
│        │           │              │     │  ┌──────┴──────┐   │  │
│        │           │  Verify AI   │     │  │ PoAIWMint   │   │  │
│        │           │  Sign Attest │     │  │ (mint logic)│   │  │
│        │           └──────┬───────┘     │  └──────▲──────┘   │  │
│        │                  │             │         │          │  │
│        │    Attestation   │             │  ┌──────┴──────┐   │  │
│        │<─────────────────┘             │  │OracleVerify │   │  │
│        │                                │  │ (sig check) │   │  │
│        │     Submit tx on-chain         │  └─────────────┘   │  │
│        └───────────────────────────────>│                    │  │
│                                         │  ┌─────────────┐   │  │
│                                         │  │MinterProxy  │   │  │
│                                         │  │(upgradeable)│   │  │
│                                         │  └─────────────┘   │  │
│                                         └───────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Smart Contracts

CLAWING deploys four contracts on Ethereum mainnet, organized in a layered architecture.

### Contract Hierarchy

```
CLAW_Token (ERC-20)
    ▲
    │ mint()
    │
PoAIWMint (Mining Logic)
    ▲
    │ verify()
    │
OracleVerifier (Signature Verification)

MinterProxy (Upgradeability Layer)
    │
    └──> delegates to PoAIWMint
```

### CLAW_Token

The core ERC-20 token contract. Manages balances, transfers, and approvals. Only authorized minters (the PoAIWMint contract) can mint new tokens.

| Property | Value |
|---|---|
| Address | `0x4ba1209b165b62a1f0d2fbf22d67cacf43a6df2b` |
| Standard | ERC-20 |
| Supply Cap | 210,000,000,000 |
| Minting | Restricted to PoAIWMint |

### PoAIWMint

The mining logic contract. Manages Eras, Epochs, cooldowns, claim counts, and reward calculations. When a valid claim is submitted, it instructs CLAW_Token to mint the reward.

| Property | Value |
|---|---|
| Address | `0x511351940d99f3012c79c613478e8f2c887a8259` |
| Role | Mining logic, reward calculation |
| Dependencies | OracleVerifier, CLAW_Token |

**Key Functions:**
- `claim(attestation)` — Submit an Oracle attestation to claim $CLAW
- `getCurrentEra()` — Returns the current Era number
- `getCurrentEpoch()` — Returns the current Epoch within the Era
- `getCooldownRemaining(address)` — Returns remaining cooldown blocks
- `getClaimCount(address, epoch)` — Returns claims made in the current epoch

**State Management:**
- Tracks per-address cooldowns (last claim block)
- Tracks per-address epoch claim counts
- Manages Era transitions and halving
- Calculates rewards using the `R = perBlock × (1 + ln(T))` formula

### OracleVerifier

Verifies that Oracle attestations are authentic by checking the cryptographic signature against the known Oracle signer address.

| Property | Value |
|---|---|
| Address | `0xc24a0ba99b9ff6b7ccea6beb4013b69f39024fd5` |
| Role | Signature verification |
| Oracle Signer | `0xB98253EE78AEED4a0E5554fB1390Dbf0b28cEFfF` |

**Key Functions:**
- `verify(attestation, signature)` — Returns true if the signature matches the Oracle signer
- `getOracleSigner()` — Returns the current Oracle signer address

### MinterProxy

A proxy contract that delegates calls to the PoAIWMint implementation. This enables future upgrades to the mining logic without redeploying the token contract or resetting state.

| Property | Value |
|---|---|
| Address | `0xe7fc311863b95e726a620b07607209965ee72bce` |
| Role | Upgradeability |
| Pattern | Transparent proxy |

## Oracle Server

The Oracle is an off-chain service that verifies AI work and produces signed attestations.

### Endpoint

```
https://oracle.minewithclaw.com
```

### Responsibilities

1. **Nonce management**: Issues unique nonces to prevent replay attacks
2. **AI verification**: Confirms that submitted content was generated by the correct model
3. **Rate limit enforcement**: Validates cooldown and epoch limits before signing
4. **Attestation signing**: Produces ECDSA signatures using the Oracle signer key

### Security Properties

- **HTTPS enforced**: All Oracle communication is encrypted
- **Stateless verification**: Each attestation is independently verifiable
- **Public signer key**: Anyone can verify that an attestation was signed by the Oracle

See [Oracle API](oracle-api.md) for endpoint documentation.

## Data Flow

### Complete Mining Transaction

```
Step 1: Nonce Request
  Miner ──GET /api/v1/nonce──> Oracle
  Miner <──{ nonce }────────── Oracle

Step 2: AI Content Generation
  Miner ──prompt──> AI API (grok-4.1-fast)
  Miner <──content── AI API

Step 3: Oracle Attestation
  Miner ──POST /api/v1/attest──> Oracle
         { address, nonce,       │
           content, model }      │
                                 ├─ Verify model
                                 ├─ Verify nonce
                                 ├─ Check cooldown
                                 ├─ Check epoch limit
                                 ├─ Sign attestation
  Miner <──{ attestation, sig }── Oracle

Step 4: On-Chain Claim
  Miner ──claim(attestation, sig)──> MinterProxy
                                         │
                                    PoAIWMint
                                         │
                                    OracleVerifier.verify()
                                         │
                                    [Signature Valid?]
                                      │         │
                                     Yes        No
                                      │         │
                                 Calculate R    Revert
                                      │
                                 CLAW_Token.mint(miner, R)
                                      │
                                 Emit ClaimEvent
```

## State Machine

### Miner State Transitions

```
           ┌──────────┐
           │   IDLE   │
           └────┬─────┘
                │ Cooldown elapsed
                v
           ┌──────────┐
           │  READY   │──── Epoch limit reached ────> IDLE (wait for new epoch)
           └────┬─────┘
                │ Initiate claim
                v
           ┌──────────┐
           │ CLAIMING  │──── Oracle error ────> READY (retry)
           └────┬─────┘
                │ Attestation received
                v
           ┌──────────┐
           │SUBMITTING │──── Tx revert ────> READY (retry)
           └────┬─────┘
                │ Tx confirmed
                v
           ┌──────────┐
           │ COOLDOWN  │──── 3,500 blocks ────> IDLE
           └──────────┘
```

### Era/Epoch State

```
Era 1
├── Epoch 1  (blocks 0 - 49,999)
├── Epoch 2  (blocks 50,000 - 99,999)
├── ...
├── Epoch 21 (blocks 1,000,000 - 1,049,999)
│
Era 2 (perBlock halved)
├── Epoch 1  (blocks 1,050,000 - 1,099,999)
├── ...
```

## Upgradeability

The MinterProxy pattern allows the protocol to upgrade mining logic without:

- Redeploying the CLAW_Token contract
- Migrating user balances
- Changing the token contract address

Upgrades are governed by the protocol's governance mechanism (see [Governance](../protocol/governance.md)).

## Next Steps

- [Smart Contracts](contracts.md) — All addresses and deployment details
- [Oracle API](oracle-api.md) — API endpoint documentation
- [Security](security.md) — Security model and audit results
- [Proof of AI Work](../protocol/proof-of-ai-work.md) — Consensus mechanism details
