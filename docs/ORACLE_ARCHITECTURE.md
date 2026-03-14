# Clawing Phase 1 — Oracle Verification Architecture Design v1.0

> **Architecture decision**: Phase 1 adopts the Oracle signature verification scheme, replacing the original SP1 ZK scheme
> **Upgrade path**: Phase 1 Oracle → Phase 2 TLSNotary + SP1 ZK
> **Design principles**: Fair, transparent, auditable, deployable in 5 days

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Clawing Phase 1 Architecture                     │
│                                                                      │
│   ┌──────────┐       ┌──────────────┐       ┌────────────────┐      │
│   │ Miner CLI│──①──→│ Oracle Server│──④──→│  Miner CLI     │      │
│   │          │       │              │       │  (submit on-chain)│   │
│   └──────────┘       └──────────────┘       └────────────────┘      │
│        │                    │                       │                │
│        ② Call AI API       ③ Verify+Sign            ⑤ mint()        │
│        ↓                    ↓                       ↓                │
│   ┌──────────┐       ┌──────────────┐       ┌────────────────┐      │
│   │ AI Model │       │ Oracle Key   │       │  Ethereum      │      │
│   │ (GPT etc)│       │ (ECDSA)      │       │  PoAIWMint     │      │
│   └──────────┘       └──────────────┘       └────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
```

### Complete Data Flow (10 Steps)

```
Step 1: Miner CLI reads current Epoch Seed and Era Model from chain
Step 2: Miner CLI calls AI API (e.g. GPT-5.4), sending prompt containing Seed
Step 3: Miner CLI receives AI response (including usage.total_tokens)
Step 4: Miner CLI sends complete API response to Oracle Server
Step 5: Oracle Server verifies authenticity and format of the API response
Step 6: Oracle Server extracts key data (model, total_tokens, etc.)
Step 7: Oracle Server signs the attestation with its private key
Step 8: Oracle returns the signature to the Miner CLI
Step 9: Miner CLI assembles the transaction and calls PoAIWMint.mint()
Step 10: On-chain contract uses ecrecover to verify signature and mints CLI
```

---

## 2. On-chain Contract Architecture

### 2.1 Contract Deployment Relationships

```
Deployment order:
  1. Deploy OracleVerifier (pass in oracleAddress)
  2. Deploy PoAIWMint (pass in tokenAddress, verifierAddress)
  3. Deploy CLAW_Token (pass in PoAIWMint address as minter)

Contract relationships:
  ┌───────────────┐
  │  CLAW_Token   │ ← immutable minter = PoAIWMint
  └───────┬───────┘
          │ mint()
  ┌───────┴───────┐
  │  PoAIWMint    │ ← references OracleVerifier
  └───────┬───────┘
          │ verify()
  ┌───────┴───────┐
  │ OracleVerifier│ ← immutable oracleAddress
  └───────────────┘
```

**Note**: There is a circular dependency in deployment (CLAW_Token needs the PoAIWMint address, PoAIWMint needs the CLAW_Token address).
Solution: Use CREATE2 to precompute the PoAIWMint address, deploy CLAW_Token first, then deploy PoAIWMint.
Or more simply: deploy PoAIWMint first (passing a temporary token address)... no, we adopt the standard approach:

```
Actual deployment order (resolving circular dependency):
  1. Deploy OracleVerifier(oracleAddress)
  2. Use CREATE2 to precompute the deployment address of PoAIWMint
  3. Deploy CLAW_Token(predictedPoAIWMintAddress)
  4. Deploy PoAIWMint(aiocTokenAddress, oracleVerifierAddress) — must deploy to the precomputed address
```

### 2.2 OracleVerifier.sol v2.1 (Multi-node + Rate Limiting + Time Window + Deadline Cap)

**Implemented** — see `contracts/src/OracleVerifier.sol`

Core upgrades (compared to v1.0):
- **Multi-node**: Supports 1-5 Oracle signers, any valid one passes
- **Rate limiting**: At least 41,000 seconds between two verify calls from the same miner (~3500 blocks)
- **Time window**: Signature includes a deadline field, automatically expires after 300 blocks
- **Signature format adds chainId + verifierAddress + deadline**: Prevent cross-chain replay / prevent cross-contract replay + prevent signature hoarding
- **Deadline cap check**: deadline must not exceed current block + SIGNATURE_VALIDITY_BLOCKS [V4-M1]

```
Signature message format (EIP-191, v2.1):  [V4-I1 update]
  dataHash = keccak256(abi.encode(
      block.chainid,    // Chain ID (prevent cross-chain replay)
      address(this),    // Verifier address (prevent cross-contract replay)
      minerAddress, modelHash, totalTokens,
      seedEpoch, seed, claimIndex, deadline
  ))
  ethSignedHash = keccak256("\x19Ethereum Signed Message:\n32" + dataHash)
```

### 2.3 MinterProxy.sol (New Contract — Key Rotation + Upgrade Support)

**Implemented** — see `contracts/src/MinterProxy.sol`

```
Architecture:
  CLAW_Token.minter (immutable) = MinterProxy
  MinterProxy.activeMinter = PoAIWMint (switchable via timelock)

Timelock security:
  - Propose switch: initiated by guardian
  - Waiting period: 7 days (mandatory)
  - Execution: anyone can execute (trustless)
  - Expiry: automatically expires if not executed within 14 days
  - Guardian can renounce authority → fully decentralized
```

### 2.4 PoAIWMint.sol v5.3 (Complete Rewrite)

**Implemented** — see `contracts/src/PoAIWMint.sol`

Major changes:
- mint() function rewritten from ZK parameters to Oracle parameters (+ deadline)
- Mints tokens through MinterProxy (instead of directly calling token.mint)
- Added totalTokens range check (MIN_TOKENS=100, MAX_TOKENS=100,000)
- Fixed ln(T) edge cases (T=0 protection, overflow protection)

```
Old (ZK):  mint(bytes publicValues, bytes proofBytes)
New (Oracle): mint(bytes32 modelHash, uint256 totalTokens,
                  uint256 seedEpoch, uint256 seed,
                  uint256 claimIndex, uint256 deadline,
                  bytes signature)
```

Comparison:

| Dimension | ZK Version | Oracle v5.0 Version |
|------|---------|------------------|
| Input parameters | publicValues + proofBytes | 7 explicit parameters + signature |
| Verification method | SP1VerifierGateway | ecrecover (multi-node) |
| Minting method | Direct token.mint() | MinterProxy.mint() |
| Gas consumption | ~340,000 | ~100,000 |
| Security model | Zero trust (ZK) | Oracle + MinterProxy |
| Upgrade capability | None | 7-day Timelock switch |

### 2.4 CLAW_Token.sol

**Completely unchanged**. The Token contract is independent of the verification method; it only cares about `msg.sender == minter`.

---

## 3. Oracle Server Design

### 3.1 Tech Stack

```
┌────────────────────────────────────────────────┐
│  Oracle Server                                  │
│                                                  │
│  Language: Node.js (TypeScript)                 │
│  Framework: Express.js                          │
│  Signing: ethers.js (ECDSA)                     │
│  Chain interaction: ethers.js (read on-chain state) │
│  Database: SQLite (local, lightweight logging)  │
│  Deployment: Single-node VPS (sufficient for Phase 1) │
│                                                  │
│  Endpoint: POST /api/v1/attest                  │
│  Port: 3000                                     │
│  Protocol: HTTPS (Let's Encrypt)                │
└────────────────────────────────────────────────┘
```

### 3.2 API Interface

#### POST /api/v1/attest

**Request body (sent by miner)**:
```json
{
  "miner_address": "0x1234...abcd",
  "api_response": {
    "id": "chatcmpl-xxx",
    "object": "chat.completion",
    "created": 1710000000,
    "model": "grok-4.1-fast",
    "choices": [
      {
        "index": 0,
        "message": {
          "role": "assistant",
          "content": "..."
        },
        "finish_reason": "stop"
      }
    ],
    "usage": {
      "prompt_tokens": 150,
      "completion_tokens": 800,
      "total_tokens": 950
    }
  },
  "api_request": {
    "model": "grok-4.1-fast",
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant."
      },
      {
        "role": "user",
        "content": "Clawing Mining | Seed: 0xabc123... | Epoch: 42 | Miner: 0x1234... | ClaimIndex: 3 | Task: Explain quantum computing in 500 words."
      }
    ]
  },
  "seed_epoch": 42,
  "seed": "0xabc123...",
  "claim_index": 3
}
```

**Success response**:
```json
{
  "success": true,
  "attestation": {
    "miner_address": "0x1234...abcd",
    "model_hash": "0x...(keccak256 of 'grok-4.1-fast')",
    "total_tokens": 950,
    "seed_epoch": 42,
    "seed": "0xabc123...",
    "claim_index": 3,
    "signature": "0x...(65 bytes ECDSA signature)"
  },
  "estimated_reward": "1693100000000000000000000"
}
```

**Error response**:
```json
{
  "success": false,
  "error": "INVALID_MODEL",
  "message": "Model 'gpt-4' is not the approved model for current Era (expected: grok-4.1-fast)"
}
```

### 3.3 Oracle Verification Logic (7 Steps)

```
After receiving a request, the Oracle performs the following verifications:

┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Format validation                                       │
│   - api_response must conform to OpenAI Chat Completion format  │
│   - Must contain id, model, choices, usage fields               │
│   - usage.total_tokens must be > 0                              │
│   - miner_address must be a valid Ethereum address              │
├─────────────────────────────────────────────────────────────────┤
│ Step 2: Model validation                                        │
│   - Read on-chain eraModel[currentEra] to get the designated    │
│     model hash for the current Era                              │
│   - Compute keccak256(api_response.model)                       │
│   - Verify the two match                                        │
├─────────────────────────────────────────────────────────────────┤
│ Step 3: Seed validation                                         │
│   - Read on-chain currentSeed and seedEpoch                     │
│   - Verify seed_epoch in the request == on-chain seedEpoch      │
│   - Verify seed in the request == on-chain currentSeed          │
│   - Verify api_request.messages contains the correct Seed string│
├─────────────────────────────────────────────────────────────────┤
│ Step 4: Prompt format validation                                │
│   - Verify the user message contains:                           │
│     "Clawing Mining | Seed: {seed} | Epoch: {epoch} |          │
│      Miner: {address} | ClaimIndex: {claimIndex} | Task: ..."   │
│   - Ensure Seed, Epoch, Miner address match on-chain state      │
├─────────────────────────────────────────────────────────────────┤
│ Step 5: Cooldown pre-check (optional, reduces invalid signatures)│
│   - Read on-chain lastClaimBlock[miner] and COOLDOWN_BLOCKS     │
│   - If miner is still in cooldown period, reject signing        │
│   - Read on-chain epochClaimCount[miner][epoch]                 │
│   - If MAX_CLAIMS_PER_EPOCH reached, reject                     │
├─────────────────────────────────────────────────────────────────┤
│ Step 6: Anti-cheat checks                                       │
│   - Check if api_response.id format is valid                    │
│   - (Optional Phase 1.1) Send callback to AI API to verify     │
│     response ID                                                  │
│   - Check if total_tokens is within reasonable range            │
│     (e.g. 100-100,000)                                          │
│   - Rate limiting: same address can request at most once per    │
│     N seconds                                                    │
├─────────────────────────────────────────────────────────────────┤
│ Step 7: Sign and return                                         │
│   - Construct dataHash = keccak256(abi.encode(                  │
│       minerAddress, modelHash, totalTokens,                      │
│       seedEpoch, seed, claimIndex                                │
│     ))                                                            │
│   - Sign with Oracle private key (EIP-191 prefix)               │
│   - Return signature and attestation data                        │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 Oracle Private Key Management

```
Phase 1 (Simple and Secure):
┌─────────────────────────────────────────────────────┐
│  Key storage: Environment variable ORACLE_PRIVATE_KEY │
│  Deployment: Self-controlled VPS (e.g. AWS EC2,      │
│              DigitalOcean)                            │
│  Access control: SSH Key + Firewall + HTTPS          │
│  Backup: Encrypted offline storage                    │
│                                                       │
│  ⚠️ Security notes:                                  │
│  - Oracle private key can only sign, holds no assets  │
│  - Even if private key is leaked, attacker can only   │
│    forge mint signatures                              │
│  - On-chain cooldown and Epoch limits still apply     │
│  - Worst case: quickly generate a new Oracle key pair,│
│    deploy new OracleVerifier contract                 │
└─────────────────────────────────────────────────────┘

Phase 2 (Enhanced):
  - Hardware Security Module (HSM) or AWS KMS
  - Multi-sig Oracle (2-of-3 threshold signatures)
```

### 3.5 Oracle Server Anti-Cheat Strategy

```
┌──────────────────────────────────────────────────────────┐
│ Anti-cheat layer                   Effect                │
├──────────────────────────────────────────────────────────┤
│ 1. Seed embedded in Prompt        Miner must use current │
│                                   Seed                   │
│ 2. Oracle verifies API response   Cannot forge response  │
│    format                         format                 │
│ 3. On-chain cooldown (3500 blocks)Cannot mine at high    │
│                                   frequency              │
│ 4. Epoch Claim limit (14 times)   Per-Epoch cap          │
│ 5. Oracle rate limiting           Anti-DoS               │
│ 6. total_tokens range check       Prevent extreme value  │
│                                   manipulation           │
│ 7. Signature anti-replay          Same signature cannot  │
│    (on-chain mapping)             be reused              │
│ 8. (Phase 1.1) API callback       Verify response        │
│    verification                   authenticity           │
└──────────────────────────────────────────────────────────┘

Remaining risks (known and accepted in Phase 1):
  - Oracle operator could theoretically sign for themselves → but code is open source, auditable
  - Oracle downtime = nobody can mine → Phase 2 decentralization resolves this
  - AI API could be bypassed → Phase 1.1 can add callback verification
```

---

## 4. Miner CLI Design

### 4.1 Tech Stack

```
┌────────────────────────────────────────────────┐
│  Miner CLI                                      │
│                                                  │
│  Language: Node.js (TypeScript)                 │
│  Chain interaction: ethers.js v6               │
│  AI API: OpenAI SDK (or fetch)                  │
│  Config: .env file                              │
│                                                  │
│  Command: npx openclaw-mine                     │
│  Or:      node mine.js                          │
└────────────────────────────────────────────────┘
```

### 4.2 Miner Configuration File (.env)

```env
# === Wallet configuration ===
PRIVATE_KEY=0x...           # Miner Ethereum private key (for sending mint transactions)

# === AI API configuration ===
AI_API_KEY=sk-...           # OpenAI (or compatible) API Key
AI_API_URL=https://api.x.ai/v1/chat/completions  # API endpoint (xAI recommended)
AI_MODEL=grok-4.1-fast            # Model name

# === Oracle configuration ===
ORACLE_URL=https://oracle.minewithclaw.com/api/v1/attest

# === Chain configuration ===
RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
POAIW_MINT_ADDRESS=0x...    # PoAIWMint contract address

# === Mining configuration (optional) ===
AUTO_MINE=true              # Auto-loop mining
GAS_LIMIT_GWEI=2            # Gas cap (wait if exceeded)
```

### 4.3 CLAW Mining Flow (Pseudocode)

```
function mineOnce():
    // Step 1: Read on-chain state
    era = contract.currentEra()
    epoch = contract.currentGlobalEpoch()
    seed = contract.currentSeed()
    seedEpoch = contract.seedEpoch()
    modelHash = contract.eraModel(era)

    // If Seed has not been updated to the current Epoch, call updateSeed() first
    if seedEpoch != epoch:
        tx = contract.updateSeed()
        await tx.wait()
        seed = contract.currentSeed()
        seedEpoch = contract.seedEpoch()

    // Step 2: Read miner state
    cooldown = contract.cooldownRemaining(myAddress)
    if cooldown > 0:
        print("In cooldown, need to wait {cooldown} blocks (~{cooldown*12} seconds)")
        sleep(cooldown * 12)

    claimCount = contract.epochClaimCount(myAddress, epoch)
    if claimCount >= 14:
        print("Max claims reached for this Epoch")
        return

    claimIndex = claimCount  // 0-based

    // Step 3: Construct and send AI API request
    prompt = `Clawing Mining | Seed: ${seed} | Epoch: ${epoch} | ` +
             `Miner: ${myAddress} | ClaimIndex: ${claimIndex} | ` +
             `Task: Explain quantum computing in detail.`

    apiResponse = await callAI({
        model: "grok-4.1-fast",
        messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: prompt }
        ]
    })

    // Step 4: Send to Oracle to get signature
    attestation = await fetch(ORACLE_URL, {
        method: "POST",
        body: {
            miner_address: myAddress,
            api_response: apiResponse,
            api_request: { model: "grok-4.1-fast", messages: [...] },
            seed_epoch: seedEpoch,
            seed: seed,
            claim_index: claimIndex
        }
    })

    if (!attestation.success):
        print("Oracle rejected: " + attestation.error)
        return

    // Step 5: Submit on-chain
    tx = contract.mint(
        attestation.model_hash,
        attestation.total_tokens,
        attestation.seed_epoch,
        attestation.seed,
        attestation.claim_index,
        attestation.signature
    )

    receipt = await tx.wait()
    print("Mining successful! Reward: " + parseReward(receipt))

function autoMine():
    while true:
        try:
            mineOnce()
        catch error:
            print("Error: " + error.message)

        // Wait for cooldown period to end
        sleep(COOLDOWN_BLOCKS * 12 + 60)  // 3500 * 12 + 60 = ~42060 seconds ≈ 11.7 hours
```

---

## 5. Signature Format Details

### 5.1 Signature Data Structure

```
Signature content (data signed by Oracle private key):  [V4-I1 update]

dataHash = keccak256(abi.encode(
    block.chainid,   // uint256  — 32 bytes (Chain ID, prevent cross-chain replay)
    verifierAddress, // address  — 20 bytes (OracleVerifier contract address, prevent cross-contract replay)
    minerAddress,    // address  — 20 bytes (Miner address)
    modelHash,       // bytes32  — 32 bytes (keccak256("grok-4.1-fast"))
    totalTokens,     // uint256  — 32 bytes (total_tokens returned by API)
    seedEpoch,       // uint256  — 32 bytes (Current global Epoch)
    seed,            // uint256  — 32 bytes (Current Epoch Seed)
    claimIndex,      // uint256  — 32 bytes (This miner's nth claim in this Epoch)
    deadline         // uint256  — 32 bytes (Signature expiration block number)
))

Signature format (EIP-191 personal_sign):

ethSignedHash = keccak256(
    "\x19Ethereum Signed Message:\n32" + dataHash
)

signature = sign(ethSignedHash, oraclePrivateKey)
         = r (32 bytes) + s (32 bytes) + v (1 byte)
         = 65 bytes total
```

### 5.2 Why EIP-191 Instead of EIP-712?

| Dimension | EIP-191 (personal_sign) | EIP-712 (typed data) |
|------|------------------------|---------------------|
| Complexity | Very low | Medium (requires defining domain + types) |
| On-chain verification | ecrecover (3000 gas) | ecrecover (3000 gas) |
| Off-chain signing | ethers.signMessage() | ethers.signTypedData() |
| Readability | See hash when signing | See structured data when signing |
| Reason for choice | **Phase 1 simplicity first** | Can upgrade in Phase 2 |

The Oracle server signs automatically (not a human signing manually in a wallet), so readability is not important. EIP-191 is the simplest.

### 5.3 Anti-Replay Mechanism

```
Triple anti-replay:

1. On-chain OracleVerifier.usedSignatures[ethSignedHash]
   → Same signature can only be used once

2. On-chain PoAIWMint.epochClaimCount[miner][epoch]
   → claimIndex must == currentCount (strictly incremental)

3. Signature content includes (address, seedEpoch, claimIndex) triple
   → Signatures for different miners/different Epochs/different claimIndex are all different
   → Even if Oracle signs the same data twice, the second use is blocked by usedSignatures
```

---

## 6. Gas Cost Comparison

### 6.1 Single mint Cost (Oracle Version)

```
┌───────────────────────────────────────────────┐
│  Operation                     Gas consumption │
├───────────────────────────────────────────────┤
│  Function call base overhead    ~21,000        │
│  Calldata (6 params + 65-byte   ~3,000        │
│    signature)                                  │
│  ecrecover (EVM precompile)     ~3,000        │
│  keccak256 (2 times)            ~60           │
│  SSTORE (usedSignatures)        ~20,000       │
│  SSTORE (epochMinted)           ~5,000        │
│  SSTORE (lastClaimBlock)        ~5,000        │
│  SSTORE (epochClaimCount)       ~5,000        │
│  SLOAD (various reads, ~8 times)~16,000       │
│  Token.mint (SSTORE * 3)        ~15,000       │
│  Event emit                     ~1,500        │
│  Other logic                    ~3,000        │
├───────────────────────────────────────────────┤
│  Total                          ~97,560       │
│  Conservative estimate          ~100,000      │
└───────────────────────────────────────────────┘

At current market price (ETH $2,018, Gas 0.5 gwei):
  100,000 × 0.5 gwei = 50,000 gwei = 0.00005 ETH ≈ $0.10

Compared to ZK version:
  340,000 × 0.5 gwei = 170,000 gwei = 0.00017 ETH ≈ $0.34

Savings: ~$0.24/time, approximately 70%
```

### 6.2 Total Mining Cost Estimate

```
Assuming miner claims 14 times per Epoch (maximum):
  - Gas cost: 14 × $0.10 = $1.40/Epoch
  - API cost: 14 × $0.03 = $0.42/Epoch
  - Total: $1.82/Epoch ≈ $0.26/day

Compared to ZK: $5.18/Epoch → Oracle saves 65%
```

---

## 7. Upgrade Path (Oracle → ZK)

### 7.1 Phase 2 Migration Strategy

```
Phase 1 (Current):
  PoAIWMint → OracleVerifier → ecrecover

Phase 2 (Future):
  PoAIWMint_v2 → ZKVerifier → SP1VerifierGateway → Groth16

Migration method:
  1. Deploy new ZKVerifier contract
  2. Deploy new PoAIWMint_v2 contract (pointing to ZKVerifier)
  3. Deploy new CLAW_Token_v2 (minter = PoAIWMint_v2)

  ⚠️ Problem: Token's minter is immutable, cannot be changed

  Solution (two options):

  Option A: Token Proxy (recommended)
    - CLAW_Token's minter = MinterProxy contract
    - MinterProxy maintains a switchable activeMinter
    - Phase 1: activeMinter = PoAIWMint (Oracle)
    - Phase 2: activeMinter = PoAIWMint_v2 (ZK)
    - MinterProxy upgrade requires timelock (e.g. 7 days)

  Option B: Token Migration
    - Phase 2 deploys entirely new CLAW_Token_v2
    - Original CLAW_Token holders can exchange 1:1
    - More complex, but the Token itself is more pure
```

### 7.2 Interfaces Reserved for Phase 2

```
OracleVerifier and future ZKVerifier share the same verification semantics:

  Verify: (minerAddress, modelHash, totalTokens, seedEpoch, seed, claimIndex) → bool

How PoAIWMint calls the verifier:
  Phase 1: verifier.verify(miner, model, tokens, epoch, seed, index, signature)
  Phase 2: verifier.verify(publicValues, proofBytes)

Parameters differ, but semantics are the same — this is why PoAIWMint needs to be upgraded together with the Verifier.
```

---

## 8. Security Analysis

### 8.1 Threat Model

```
┌──────────────────────────────────────────────────────────────────┐
│ Attack scenario                    Oracle scheme defense         │
├──────────────────────────────────────────────────────────────────┤
│ Forge API response                Oracle validates format +      │
│                                   (optional callback)            │
│ Replay old signature              On-chain usedSignatures mapping│
│ Steal others' signatures          Signature binds minerAddress   │
│ High-frequency abuse              3500 block cooldown +          │
│                                   14 times/Epoch                 │
│ Cross-Epoch reuse                 Signature binds seedEpoch +    │
│                                   seed                           │
│ Oracle private key leak           Deploy new OracleVerifier      │
│ Oracle downtime                   Everyone pauses mining         │
│                                   (Phase 1 risk)                 │
│ Oracle mines for itself           Code is open source, auditable │
│                                   (Phase 1 risk)                 │
│ Flash loan governance attack      Voting lockup mechanism        │
│                                   unchanged                      │
│ Token overflow                    immutable MAX_SUPPLY unchanged │
│ Miner calls API for free          Oracle checks total_tokens > 0 │
│ Man-in-the-middle intercepts      HTTPS + signature binds address│
│ signature                                                        │
└──────────────────────────────────────────────────────────────────┘
```

### 8.2 Known Risks and Mitigation

```
Risk 1: Oracle Centralization
  Severity: Medium
  Mitigation:
    - Code is fully open source, community can audit
    - Phase 2 migrates to ZK
    - Oracle cannot steal anyone's assets
    - Oracle can only sign, cannot modify contract logic

Risk 2: Oracle Downtime
  Severity: High (affects all miners)
  Mitigation:
    - Phase 1: Deploy to high-availability VPS + monitoring alerts
    - Phase 1.1: Multi-node deployment (same private key)
    - Phase 2: ZK decentralization, no single point of failure

Risk 3: Oracle Self-interest
  Severity: Low (detectable)
  Mitigation:
    - All signatures are publicly recorded (on-chain events)
    - Anyone can analyze Oracle signing frequency
    - Community monitors for anomalous patterns
```

---

## 9. API Callback Verification Scheme [V3-M1]

> **Severity**: MEDIUM | **Status**: Must be implemented before mainnet launch | **Blocks launch**: Yes

### 9.1 Problem Description

The on-chain contract assumes the data signed by the Oracle is a genuine AI API call result. However, if the Oracle server only relies on checking the API response JSON format to verify authenticity, an attacker can construct a completely forged but format-compliant API response JSON, containing the correct model field and any arbitrary total_tokens value.

**Attack scenario**: A miner writes a script to construct a fake OpenAI response JSON with model="grok-4.1-fast" and total_tokens=99999, submits it to the Oracle to obtain a signature, and mints the maximum reward at zero cost.

### 9.2 Solution (Three-Layer Defense)

#### Layer 1: Response ID Callback Verification (Required)

```
After Oracle receives the API response submitted by a miner:
1. Extract api_response.id (e.g. "chatcmpl-xxx")
2. Use Oracle's own OpenAI API Key to call:
   GET https://api.openai.com/v1/chat/completions/{response_id}
   or check OpenAI's usage log API
3. Confirm that the response_id actually exists and total_tokens matches
4. If OpenAI does not provide a response lookup API, use Layer 2 instead
```

#### Layer 2: One-Time Nonce Embedding (Required)

```
Flow:
1. Miner requests nonce from Oracle: GET /api/v1/nonce?miner=0x...
2. Oracle generates a one-time nonce (e.g. "CLI-a3f8b2c1-1710000000"), stores in database
3. Miner must embed the nonce in the prompt:
   "Clawing Mining | Seed: ... | Nonce: CLI-a3f8b2c1-1710000000 | ..."
4. After Oracle receives the API response, it checks whether the response contains the nonce
5. Nonce is marked as consumed after use, cannot be reused
6. Nonce validity: 5 minutes

Security: Attacker cannot predict the nonce value, and the AI model's response necessarily
contains the nonce from the prompt (since the prompt is part of the input). A forged response
cannot contain an unknown nonce.
```

#### Layer 3: Cross-Validation (Recommended)

```
Oracle performs reasonableness checks on the following fields:
- api_response.created must be within the last 5 minutes
- api_response.usage.total_tokens must equal
  (prompt_tokens + completion_tokens)
- api_response.model must exactly match the on-chain Era model
- api_response.choices[0].finish_reason must be "stop" or "length"
```

---

## 10. Seed Security Analysis [V3-M2]

### 10.1 Purpose of Seed

Seed is the on-chain random number for each Epoch, generated by `updateSeed()`, using `blockhash(block.number - 1/2/3)` + `block.prevrandao` as the entropy source.

**The sole purpose of the Seed is to bind Oracle signatures to a specific Epoch, preventing cross-Epoch signature replay.**

Seed does not participate in reward calculation. The reward formula `R = perBlock × (1 + ln(T))` depends only on:
- `perBlock`: Determined by Era (halved each Era)
- `T` (totalTokens): The miner's AI API consumption

### 10.2 MEV Manipulation Risk Analysis

```
An attacker (Ethereum validator/MEV searcher) can:
- Choose to call updateSeed() at a specific block to get a "favorable" Seed value
- Manipulate blockhash to influence Seed

However, since Seed does not affect reward amounts, the economic benefit of manipulating Seed is zero.
Therefore this risk is acceptable under the current design.

ℹ️ If a future version introduces Seed into the reward calculation, it must be upgraded to a commit-reveal scheme.
```

---

## 11. Key Leak Emergency Plan [V3-L1]

### 11.1 Oracle Key Leak

```
Emergency response procedure:

1️⃣ Immediately: Stop the Oracle node service with the leaked key
   - If multi-node, other nodes continue running, mining is not interrupted

2️⃣ Within hours: Deploy new OracleVerifier (excluding leaked key) + new PoAIWMint
   - New contract uses a new Oracle key pair
   - Ensure new contract code is consistent with old contract (only key changed)

3️⃣ Within hours: Guardian calls proposeMinter() to propose switching to new PoAIWMint

4️⃣ Wait 7-day Timelock:
   - Leaked key can still sign valid attestations
   - But on-chain cooldown (3500 blocks/time) + Epoch cap (14 times) limits damage scope
   - Worst case: Attacker mines at maximum rate for 7 days (output of 1 address)

5️⃣ After 7 days: Anyone calls executeMinterChange() to complete the switch
   - Signatures from old OracleVerifier are no longer accepted by new PoAIWMint
   - Attack ends
```

### 11.2 Guardian Key Leak

```
Emergency response procedure:

1️⃣ Immediately: Monitor on-chain MinterProposed events
   - If a proposal not initiated by yourself is detected, respond immediately

2️⃣ Within 7 days: If Guardian has not been renounced, use backup key to call cancelMinterChange()
   - Guardian can cancel proposals up to 3 times (MAX_CANCELLATIONS=3)

3️⃣ If Guardian has lost control:
   - Within 7 days, alert the community to warn miners not to participate in new minter
   - If attacker's proposal is executed, new minter must be a contract address (NotContract check)
   - Attacker needs to deploy malicious contract + wait 7 days, community has ample time to detect

Mitigation measures:
- Guardian uses a Ledger cold wallet to manage private keys, greatly reducing remote leak risk
- Set up MinterProposed event monitoring alerts after deployment
- Phase 2 considers upgrading Guardian to multi-sig wallet or DAO governance
```

---

## 12. File List and Change Summary (formerly Section 9)

```
Completed modifications/new files:

contracts/src/
├── CLAW_Token.sol           ← Minor fix (balanceOf checked arithmetic + mint rejects address(0))
├── OracleVerifier.sol       ← New v2.0 (multi-node + rate limiting + deadline)
├── MinterProxy.sol          ← New (key rotation + 7-day Timelock)
├── PoAIWMint.sol            ← Complete rewrite v5.0 (Oracle + MinterProxy)
└── legacy/ClawingVerifier_ZK.sol  ← Retained (reserved for Phase 2)

contracts/test/
└── PoAIWMint.t.sol          ← Complete rewrite (Oracle + MinterProxy + multi-node + edge cases)

contracts/script/
└── Deploy.s.sol             ← Rewritten (four-contract architecture + environment variable Oracle signers)

oracle/                      ← Entirely new directory
├── src/
│   ├── server.ts            ← Express server entry point
│   ├── verifier.ts          ← API response verification logic
│   ├── signer.ts            ← ECDSA signing logic
│   ├── chain.ts             ← On-chain state reading
│   └── types.ts             ← TypeScript type definitions
├── .env.example
├── package.json
└── tsconfig.json

miner/                       ← Entirely new directory
├── src/
│   ├── mine.ts              ← Mining main loop
│   ├── api.ts               ← AI API calls
│   ├── oracle.ts            ← Oracle communication
│   ├── chain.ts             ← On-chain interaction
│   └── types.ts
├── .env.example
├── package.json
└── tsconfig.json

sp1-circuit/                 ← Retained, not used in Phase 1
```

---

## 13. 5-Day Implementation Plan (Detailed) (formerly Section 10)

```
Day 1 (Today):
  ✅ Oracle architecture design document (this document)
  □  Write OracleVerifier.sol
  □  Modify PoAIWMint.sol (mint function)
  □  Write contract tests

Day 2:
  □  Oracle server skeleton (Express + ethers.js)
  □  Implement /api/v1/attest endpoint
  □  Implement verification logic (7 steps)
  □  Implement signing logic

Day 3:
  □  Miner CLI (Node.js)
  □  Implement complete mining loop
  □  Local end-to-end test (Hardhat/Anvil)

Day 4:
  □  Sepolia testnet deployment
  □  Oracle deployment to VPS
  □  Complete end-to-end test
  □  Fix bugs

Day 5:
  □  Mainnet deployment
  □  GitHub open source
  □  README + mining tutorial
  □  Community launch
```
