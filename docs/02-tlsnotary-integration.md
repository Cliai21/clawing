# TLSNotary Integration Guide

> This document describes how Clawing uses TLSNotary to prove that miners actually called AI APIs and consumed tokens.

---

## 1. Role of TLSNotary in Clawing

```
┌─────────────┐       MPC-TLS        ┌──────────────┐
│ Miner Client │◄────────────────────►│  Notary Node  │
│  (Prover)    │                      │  (Verifier)   │
└──────┬───────┘                      └───────────────┘
       │ HTTPS (TLS 1.2/1.3)
       ▼
┌──────────────┐
│ AI API Service│
│ (e.g. OpenAI) │
└──────────────┘

Notary participates in TLS handshake key negotiation (MPC-TLS):
- Notary holds half of the TLS key (key share)
- Miner (Prover) holds the other half
- Both sides use 2PC (two-party computation) to cooperatively perform encryption/decryption
- Notary never sees plaintext data
- After the TLS session ends, Notary signs the attestation
- Miner selectively discloses partial response content
```

## 2. Core Workflow

### 2.1 Phase 1: MPC-TLS Session

```rust
// Conceptual code — based on the tlsn crate

use tlsn::prover::{Prover, ProverConfig};
use tlsn::connection::ServerName;

// 1. Configure Prover
let config = ProverConfig::builder()
    .server_name(ServerName::try_from("api.openai.com")?)
    .max_sent_data(4096)     // Send data upper limit
    .max_recv_data(16384)    // Receive data upper limit
    .build()?;

// 2. Connect to Notary Server (WebSocket or TCP)
let notary_socket = connect_to_notary("wss://notary.openclaw.xyz").await?;

// 3. Create Prover Session
let prover = Prover::new(config);
let session = prover.setup(notary_socket).await?;

// 4. Connect to AI API via MPC-TLS
let (tls_conn, prover_future) = session.connect(
    tcp_connect("api.openai.com:443").await?
).await?;

// 5. Send HTTP request (identical to a normal HTTPS request)
let request = format!(
    "POST /v1/chat/completions HTTP/1.1\r\n\
     Host: api.openai.com\r\n\
     Authorization: Bearer {api_key}\r\n\
     Content-Type: application/json\r\n\
     \r\n\
     {request_body}"
);
tls_conn.write_all(request.as_bytes()).await?;

// 6. Read HTTP response
let response = read_response(&mut tls_conn).await?;

// 7. Close TLS connection, complete MPC-TLS protocol
let prover_result = prover_future.await?;
```

### 2.2 Phase 2: Generate Attestation

```rust
// After MPC-TLS completes, Notary has signed the commitment to the session transcript

// Get transcript commitment
let mut prover = prover_result.start_notarize();

// Notary signs → produces Attestation
let attestation = prover.finalize().await?;
// attestation contains:
//   - header: version, uid, signature
//   - body: server_name, merkle_root(transcript), timestamp
```

### 2.3 Phase 3: Selective Disclosure

```rust
// Miner only needs to disclose two fields from the HTTP response:
//   1. "model": "grok-4.1-fast"       → Proves the correct model was used
//   2. "usage.total_tokens": N   → Proves N tokens were consumed

use tlsn::transcript::{TranscriptCommitBuilder, Direction};

// Mark the response fields to disclose
let mut builder = TranscriptCommitBuilder::new(&transcript);

// Find the position of JSON response body in the transcript
let response_body_range = find_json_body_range(&transcript)?;

// Selectively disclose the entire JSON body (containing model and usage.total_tokens)
// Note: More granular field-level disclosure is possible, but JSON body-level is sufficient
builder.commit_recv(response_body_range)?;

// Generate TranscriptProof
let selective_disclosure = builder.build()?;

// Also prove TLS server identity
let server_identity_proof = attestation.prove_server_identity()?;

// Final packaging: Attestation + SelectiveDisclosure + ServerIdentityProof
let evidence = ClawingEvidence {
    attestation,
    selective_disclosure,
    server_identity_proof,
};
```

## 3. Security-Critical Fields

### 3.1 Model Field Verification

```json
// Standard response format for OpenAI-compatible APIs:
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "model": "grok-4.1-fast",          // ← Critical field 1
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "..." },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 523,
    "completion_tokens": 1000,
    "total_tokens": 1523        // ← Critical field 2
  }
}
```

**Why verify the model instead of the domain name?**

| Approach | Security | Flexibility |
|----------|----------|-------------|
| Domain name verification | Medium — same domain may serve multiple models | Low — domain changes require redeployment |
| Model field verification | High — precise down to model version | High — works as long as the API format is compatible |

The model field is returned by the API server, transmitted via TLS encryption, and TLSNotary guarantees it is unforgeable.

### 3.2 total_tokens Field Verification

`total_tokens` = `prompt_tokens` + `completion_tokens`

This value determines the logarithmic bonus for mining rewards: `R = base × (1 + ln(total_tokens))`.

**Anti-cheating**: total_tokens is returned by the API server and cannot be tampered with by miners (protected by TLS + Notary signature).

## 4. Notary Server Requirements

### 4.1 Decentralized Notary

Clawing does not run a single Notary server. Miners can choose:

| Option | Description |
|--------|-------------|
| Public Notary | Community-operated public Notary servers |
| Self-hosted Notary | Miners deploy their own Notary (no incentive to cheat themselves) |
| TEE Notary | Notary running in a trusted execution environment such as SGX/TDX |

### 4.2 Notary Public Key Management

```
Question: How to verify the Notary signature in the ZK proof?
  → Requires the Notary's public key

Solution: Hardcode a trusted Notary public key list (similar to CA root certificates)

In the SP1 Guest Program:
  1. Host passes in the Notary public key
  2. Guest verifies: Is the public key in the trusted list?
  3. Guest verifies: Is the attestation signature valid?

Trusted list updates: Publish a new Guest Program → new programVKey
  → On-chain ClawingVerifier's programVKey needs to be updated (redeploy or proxy)
```

### 4.3 Notary Trust Model

```
                     Trust Assumptions
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   Honest Notary     Honest Miner     Both Colluding
  (Standard case)  (Self-proof case)  (Attack scenario)

   Honest Notary:
     Miner actually called the API → attestation valid → ZK proof valid
     √ Secure

   Honest Miner (self-hosted Notary):
     Miner has no incentive to cheat themselves (spending own money to call API)
     √ Secure (guaranteed by economics)

   Both Colluding:
     Notary forges attestation for miner → no need to actually call the API
     ✗ Theoretically possible

   Collusion Mitigation:
     a. TEE Notary — hardware-level guarantee that Notary code is untampered
     b. Notary Staking — slashing upon reported malicious behavior (optional future feature)
     c. Multi-Notary — require k-of-n Notary signatures (higher cost)
     d. Economic backstop — forgery is unprofitable when forgery cost > mining revenue
```

## 5. Cryptographic Details of Selective Disclosure

### 5.1 TLSNotary Commitment Structure

```
TLS Session Transcript:
  ┌──────────────────────────────────┐
  │  Request  (sent by Prover)       │
  │    POST /v1/chat/completions ... │
  │    Authorization: Bearer sk-...  │  ← Hidden (not disclosed)
  │    Body: {"model":"grok-4.1-fast",...} │
  ├──────────────────────────────────┤
  │  Response (received by Prover)   │
  │    HTTP/1.1 200 OK               │
  │    Content-Type: application/json│
  │    Body: {"model":"grok-4.1-fast",    │  ← Selective disclosure
  │           "usage":{"total_tokens │
  │           ":1523},...}            │
  └──────────────────────────────────┘
         │
         ▼
  Commitment: Merkle Tree over transcript chunks
         │
         ▼
  Attestation = Notary.sign(merkle_root + server_name + ...)
```

### 5.2 Selective Disclosure Process

```
Prover (Miner):
  1. Mark disclosure scope: JSON data in the response body
  2. Generate Merkle inclusion proof:
     - Leaves: transcript chunks to be disclosed
     - Path: sibling nodes from leaf to merkle_root
  3. Package: (disclosed_data, merkle_proof)

Verifier (SP1 Guest Program):
  1. Read disclosed_data + merkle_proof
  2. Recompute: hash(disclosed_data) → leaf hash
  3. Compute root layer by layer along the Merkle path
  4. Check: computed_root == attestation.merkle_root
  5. Check: attestation.signature is valid (Notary public key)
  6. Parse JSON from disclosed_data → extract model + total_tokens
```

## 6. Interface with SP1 Guest Program

### 6.1 Data Flow

```
TLSNotary Output                  SP1 Guest Input
─────────────                    ─────────────
Attestation ──────┐
  .signature      │
  .body           │──────────► io::read::<TlsNotaryEvidence>()
  .merkle_root    │              .notary_signature
                  │              .attestation_body
SelectiveDiscl. ──┤              .disclosed_response_body
  .disclosed_data │              .disclosure_proof
  .merkle_proof   │              .server_cert_chain
                  │              .server_name
ServerIdentity ───┘

Mining Params ───────────────────► io::read::<MiningParams>()
  .seed_epoch                    .seed_epoch
  .seed                          .seed
  .miner_address                 .miner_address
  .claim_index                   .claim_index

Notary Public Key ───────────────► io::read::<NotaryPublicKey>()
```

### 6.2 Guest Output → On-chain

```
SP1 Guest commit                  Solidity abi.decode
────────────────                  ───────────────────
io::commit_slice(&abi.encode(     (bytes32 modelHash,
  model_hash,       ────────────►  uint256 totalTokens,
  total_tokens,     ────────────►  uint256 seedEpoch,
  seed_epoch,       ────────────►  uint256 seed,
  seed,             ────────────►  address minerAddress,
  miner_address,    ────────────►  uint256 claimIndex)
  claim_index       ────────────►  = abi.decode(publicValues, ...)
))
```

## 7. Summary of Key Security Properties

| Property | Guarantee Method |
|----------|-----------------|
| Miner actually called the API | TLSNotary MPC-TLS (Notary participates in handshake) |
| Model field returned by API is unforgeable | TLS encryption + Notary signature + Merkle commitment |
| total_tokens cannot be tampered with | Same as above |
| API key is not leaked | Selective disclosure (only response body is disclosed, not request headers) |
| Notary cannot see plaintext | MPC-TLS (Notary only holds half of the key) |
| Proof is unforgeable | SP1 ZK proof (Guest Program verifies all above properties inside zkVM) |
| On-chain verification is efficient | SP1 Groth16 (~280k gas) |

---

## 8. Development Phase Considerations

### 8.1 TLSNotary Version Selection

Recommended to use TLSNotary v0.1.x series (latest stable version). Key features:
- Attestation Extensions (customizable extensions)
- keccak256 hash commitment (Solidity-compatible)
- secp256k1 signature (Ethereum ecosystem-compatible)
- Improved selective disclosure API

### 8.2 SP1 Precompile Acceleration

SP1 zkVM provides precompile acceleration for the following operations (no additional cycles consumed):
- SHA-256
- keccak256
- secp256k1 signature verification
- ed25519 signature verification

This means Notary signature verification and Merkle path computation in the Guest Program can be executed efficiently.

### 8.3 TODOs in Guest Program

The Guest Program (`sp1-circuit/program/src/main.rs`) has 3 `TODO` placeholders marked:
1. `verify_notary_signature()` — needs to integrate secp256k1/ed25519 signature verification
2. `verify_selective_disclosure()` — needs to integrate TLSNotary's Merkle verification
3. `verify_server_identity()` — needs to integrate X.509 certificate chain verification

These placeholder functions currently return `true`. They must be replaced with real implementations before deployment.

The specific implementation needs to be based on the officially released `tlsn-core` crate API from TLSNotary, deserializing the evidence structures and calling the corresponding verification functions.
