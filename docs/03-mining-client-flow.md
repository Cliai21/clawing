# Miner Client Complete Mining Flow

> This document describes the complete end-to-end flow from the miner starting the client to CLAW tokens arriving in their account.

---

## 1. Mining Flow Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                  Clawing Miner Client — Single Claim Flow                │
│                                                                          │
│  ① Query on-chain state                                                  │
│     ├─ currentEra() → era                                                │
│     ├─ eraModel[era] → modelHash → reverse lookup event → modelId string │
│     ├─ currentGlobalEpoch() → gEpoch                                     │
│     ├─ epochMinted[gEpoch] vs epochCap(gEpoch) → any balance remaining   │
│     ├─ currentSeed / seedEpoch → current Epoch Seed                      │
│     ├─ cooldownRemaining(miner) → whether cooldown has elapsed           │
│     └─ remainingClaims(miner) → claims remaining in Epoch                │
│                                                                          │
│  ② Construct deterministic prompt                                        │
│     ├─ EpochSeed = currentSeed (uint256)                                 │
│     ├─ MinerAddr = msg.sender (address)                                  │
│     ├─ ClaimIndex = epochClaimCount[miner][gEpoch] (uint256)             │
│     └─ Prompt = DeterministicPrompt(EpochSeed, MinerAddr, ClaimIndex)    │
│                                                                          │
│  ③ Call AI API (via TLSNotary MPC-TLS)                                   │
│     ├─ Connect to Notary Server                                          │
│     ├─ MPC-TLS handshake                                                 │
│     ├─ POST /v1/chat/completions { model: modelId, messages: [prompt] }  │
│     ├─ Receive JSON response (containing model + usage.total_tokens)     │
│     └─ Obtain TLSNotary Attestation + selective disclosure               │
│                                                                          │
│  ④ Generate SP1 ZK proof                                                 │
│     ├─ Input: TLSNotary Evidence + MiningParams + NotaryPubKey           │
│     ├─ SP1 Guest Program verifies everything                             │
│     └─ Output: (publicValues, proofBytes) — Groth16                      │
│                                                                          │
│  ⑤ Submit to chain                                                       │
│     ├─ PoAIWMint.mint(publicValues, proofBytes)                          │
│     ├─ Contract verifies ZK proof → calculates reward → mints CLAW        │
│     └─ Miner balance increases                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

## 2. Deterministic Prompt Construction

### 2.1 Design Principles

The prompt must satisfy two conditions:
1. **Deterministic**: Given (EpochSeed, MinerAddr, ClaimIndex), anyone can derive the exact same prompt
2. **Unique**: Different (MinerAddr, ClaimIndex) combinations produce different prompts

### 2.2 Prompt Construction Algorithm

```python
def construct_prompt(epoch_seed: int, miner_address: str, claim_index: int) -> str:
    """
    Deterministic prompt generator

    Parameters:
        epoch_seed: Current Epoch's on-chain Seed (uint256)
        miner_address: Miner's Ethereum address (0x prefix)
        claim_index: The miner's claim number in the current Epoch (0-based)

    Returns:
        Prompt string to send to the AI API
    """
    import hashlib

    # 1. Concatenate inputs and hash to generate a deterministic random seed
    raw = f"{epoch_seed}:{miner_address.lower()}:{claim_index}"
    seed_hash = hashlib.sha256(raw.encode()).hexdigest()

    # 2. Use the first 8 characters of the seed as the topic index
    topic_index = int(seed_hash[:8], 16)

    # 3. Select a topic from the predefined topic pool
    topics = [
        "quantum computing",
        "artificial photosynthesis",
        "ocean exploration",
        "space colonization",
        "mathematical paradoxes",
        "ancient civilizations",
        "neuroscience breakthroughs",
        "renewable energy storage",
        "cryptographic puzzles",
        "evolutionary biology",
        "climate modeling",
        "philosophical thought experiments",
        "materials science innovations",
        "linguistic diversity",
        "astronomical discoveries",
        "game theory applications",
    ]
    topic = topics[topic_index % len(topics)]

    # 4. Use more bits of the seed to generate a specific subtopic
    subtopic_index = int(seed_hash[8:16], 16)
    angles = [
        "Explain the latest breakthrough in",
        "What are the unsolved problems in",
        "Describe a surprising connection between mathematics and",
        "How might future technology transform",
        "What is the most counterintuitive fact about",
        "Compare Eastern and Western approaches to",
        "What would a beginner need to know about",
        "Describe the history and future of",
    ]
    angle = angles[subtopic_index % len(angles)]

    # 5. Construct the final prompt
    prompt = f"{angle} {topic}. Provide a detailed, thoughtful response."

    return prompt
```

### 2.3 Why Is a Deterministic Prompt Needed?

| If the prompt is not deterministic | Consequence |
|-------------------|------|
| Miner chooses their own prompt | Can choose an extremely short prompt to get the fewest total_tokens, reducing API cost |
| Miner reuses the same prompt | Some APIs may cache responses, producing no real computation |
| Cannot be audited | The community cannot verify that miners actually performed meaningful AI inference |

Deterministic prompts ensure:
- All miners face the same Epoch Seed → fairness
- Each claim's prompt is different (ClaimIndex increments) → no caching
- Anyone can reconstruct the prompt and verify → auditable

## 3. API Call Format (OpenAI Compatible)

### 3.1 HTTP Request

```http
POST /v1/chat/completions HTTP/1.1
Host: api.x.ai
Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "model": "grok-4.1-fast",
  "messages": [
    {
      "role": "user",
      "content": "Explain the latest breakthrough in quantum computing. Provide a detailed, thoughtful response."
    }
  ],
  "max_tokens": 2048,
  "temperature": 0.7
}
```

### 3.2 HTTP Response (Expected Format)

```json
{
  "id": "chatcmpl-abc123def456",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "grok-4.1-fast",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Recent breakthroughs in quantum computing..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 42,
    "completion_tokens": 1481,
    "total_tokens": 1523
  }
}
```

### 3.3 Key Fields

| Field | Purpose | Role in ZK Proof |
|------|------|----------------|
| `model` | Model identifier | keccak256(model) == eraModel[era] |
| `usage.total_tokens` | Token consumption | R = base × (1 + ln(T)) |

## 4. Client State Machine

```
                        ┌──────────┐
                        │  IDLE    │
                        │ (waiting) │
                        └────┬─────┘
                             │ Cooldown complete / Epoch starts
                             ▼
                        ┌──────────┐
                        │  CHECK   │──── Epoch exhausted ──► WAIT_EPOCH
                        │ (check)  │──── Cooling down ─────► WAIT_COOL
                        └────┬─────┘──── Claim limit hit ──► WAIT_EPOCH
                             │ Conditions met
                             ▼
                        ┌──────────┐
                        │  PROMPT  │
                        │(construct)│
                        └────┬─────┘
                             │
                             ▼
                        ┌──────────┐
                        │  CALL    │──── API failed ───────► RETRY
                        │(call API)│
                        └────┬─────┘
                             │ Response success
                             ▼
                        ┌──────────┐
                        │  PROVE   │──── Proof failed ─────► ERROR
                        │(gen proof)│
                        └────┬─────┘
                             │ Proof complete
                             ▼
                        ┌──────────┐
                        │  SUBMIT  │──── TX failed ────────► RETRY_TX
                        │(submit TX)│
                        └────┬─────┘
                             │ TX confirmed
                             ▼
                        ┌──────────┐
                        │  DONE    │──── Cooldown timer starts
                        │(complete) │──── → Return to IDLE
                        └──────────┘
```

## 5. Epoch Seed Management

### 5.1 Seed Update Timing

```
Epoch N ends                        Epoch N+1 starts
      │                              │
      ▼                              ▼
... Block 49,999 ─── Block 50,000 ─── Block 50,001 ...
                         │
                         └─ Anyone calls PoAIWMint.updateSeed()
                            currentSeed = keccak256(
                                blockhash(block.number - 1),
                                blockhash(block.number - 2),
                                blockhash(block.number - 3),
                                block.prevrandao
                            )
```

### 5.2 Miner-Side Seed Listener

```typescript
// Listen for SeedUpdated events
contract.on("SeedUpdated", (globalEpoch, seed) => {
    console.log(`New Epoch ${globalEpoch} Seed: ${seed}`);
    // Start the next mining round with the new Seed
    startMiningLoop(globalEpoch, seed);
});

// If you are the first to discover a new Epoch, proactively call updateSeed()
// Benefit: You can be the first to start mining in the new Epoch
async function checkAndUpdateSeed() {
    const currentEpoch = await contract.currentGlobalEpoch();
    const seedEpoch = await contract.seedEpoch();
    if (currentEpoch > seedEpoch) {
        const tx = await contract.updateSeed();
        await tx.wait();
        console.log("Seed updated!");
    }
}
```

## 6. Gas Cost Estimation

### 6.1 Single mint() Call

| Operation | Gas Estimate | Proportion |
|------|----------|------|
| SP1 Groth16 verification | ~280,000 | 82% |
| State writes (5 SSTOREs) | ~40,000 | 12% |
| ABI decode + logic | ~10,000 | 3% |
| Token mint (ERC-20) | ~10,000 | 3% |
| **Total** | **~340,000** | 100% |

### 6.2 Cost Estimation (Ethereum Mainnet)

| Gas Price | Single mint cost | Per Epoch (14 times) |
|-----------|---------------|-----------------|
| 10 gwei | ~0.0034 ETH | ~0.048 ETH |
| 30 gwei | ~0.0102 ETH | ~0.143 ETH |
| 50 gwei | ~0.0170 ETH | ~0.238 ETH |
| 100 gwei | ~0.0340 ETH | ~0.476 ETH |

### 6.3 Additional Costs

| Operation | Gas Estimate | Frequency |
|------|----------|------|
| updateSeed() | ~45,000 | Once per Epoch (shared by community) |
| proposeModel() | ~70,000 | Once per Era (optional) |
| vote() | ~90,000 | Once per Era (optional) |
| withdrawVote() | ~50,000 | Once per Era (after voting) |
| finalizeEraModel() | ~100,000 | Once per Era (shared by community) |

## 7. Client Configuration Reference

```toml
# openclaw-miner.toml

[chain]
# Ethereum Mainnet RPC
rpc_url = "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
# Or wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# Contract addresses (fill in after deployment)
poaiw_mint = "0x..."
aioc_token = "0x..."

[wallet]
# Miner private key (recommended to use environment variable: MINER_PRIVATE_KEY)
# private_key = "0x..."

[api]
# AI API configuration (model for the current Era)
endpoint = "https://api.x.ai"
api_key_env = "OPENAI_API_KEY"   # Read from environment variable
# model is automatically fetched from on-chain eraModel[era], no configuration needed

[notary]
# TLSNotary Notary Server
url = "wss://notary.openclaw.xyz"
# Backup: "wss://notary2.openclaw.xyz"

[prover]
# SP1 proof generation configuration
# Use Succinct Network (recommended, no local GPU required)
mode = "network"
sp1_private_key_env = "SP1_PRIVATE_KEY"  # Succinct Network API Key

# Or generate locally (requires significant memory and CPU)
# mode = "local"

[mining]
# Auto-mining configuration
auto_mine = true
auto_update_seed = true
max_gas_price_gwei = 50        # Pause when Gas Price exceeds this value
min_epoch_remaining_pct = 5    # Skip when Epoch remaining is below 5%
```

## 8. Error Handling

| Error | Cause | Resolution |
|------|------|----------|
| `CooldownNotMet` | Fewer than 3,500 blocks since last claim | Wait for cooldown to complete and retry |
| `EpochClaimLimitReached` | Already claimed 14 times this Epoch | Wait for the next Epoch |
| `EpochExhausted` | This Epoch's hard cap is full | Wait for the next Epoch |
| `WrongSeedEpoch` / `WrongSeed` | Epoch has changed, Seed is stale | Re-fetch Seed, regenerate prompt and proof |
| `ModelNotApproved` | Wrong model used | Check eraModel[era], update API configuration |
| `InvalidProof` | ZK proof is invalid | Check proof generation flow; TLSNotary data may be corrupted |
| `AddressMismatch` | tx.sender != publicValues.minerAddress | Ensure the correct wallet is used for signing |
| `MiningEnded` | Era 24 has ended | Mining is over, cannot continue |
| `EraModelNotSet` | New Era started but finalize was not called | Proactively call finalizeEraModel() |

---

## 9. Security Practices

### 9.1 Wallet Security

- **Use a dedicated mining wallet**: Do not use a primary wallet holding significant assets
- **Minimum balance**: Only keep enough ETH to cover Gas fees
- **Regular transfers**: Periodically transfer mined CLAW to a cold wallet

### 9.2 API Key Security

- **Environment variables**: Do not hardcode API keys in configuration files
- **TLSNotary does not leak keys**: API keys are in HTTP Headers; selective disclosure does not expose Headers
- **Cost monitoring**: Set API cost limits to prevent abnormal consumption

### 9.3 Notary Selection

- **Diversity**: Do not rely on a single Notary
- **Verification**: Confirm the Notary's public key is in the trusted list
- **Latency**: Choose a low-latency Notary for better efficiency
