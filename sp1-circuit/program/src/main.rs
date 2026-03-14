//! OpenClaw SP1 Guest Program — ZK Circuit
//!
//! Function: Verifies TLSNotary evidence inside the SP1 zkVM, extracts and commits public inputs.
//!
//! Architecture overview:
//! ┌─────────────────────────────────────────────────────────────────┐
//! │  TLSNotary Prover (client-side)                                 │
//! │    1. Performs MPC-TLS connection to AI API with Notary Server  │
//! │    2. Obtains API response (containing model + total_tokens)    │
//! │    3. Notary signs attestation (plaintext not visible)          │
//! │    4. Prover selectively discloses: model + total_tokens fields │
//! │    5. Output: Attestation + SelectiveDisclosure                 │
//! └──────────────────────────┬──────────────────────────────────────┘
//!                            │
//!                            ▼
//! ┌─────────────────────────────────────────────────────────────────┐
//! │  SP1 Guest Program (this file, executed inside zkVM)            │
//! │    Inputs (passed from Host via io::read, not public):          │
//! │      - TLSNotary Attestation (Notary signature + commitments)  │
//! │      - SelectiveDisclosure (proof of model + total_tokens)     │
//! │      - Notary public key (for signature verification)          │
//! │      - Epoch Seed, Miner Address, Claim Index                  │
//! │                                                                 │
//! │    Logic:                                                       │
//! │      1. Verify Notary signature (ensure attestation untampered)│
//! │      2. Verify selective disclosure (model + total_tokens are  │
//! │         actually in the TLS response)                          │
//! │      3. Verify server identity (TLS cert chain points to the  │
//! │         expected API domain)                                   │
//! │      4. Extract model string -> compute keccak256 -> modelHash│
//! │      5. Extract total_tokens value -> totalTokens              │
//! │      6. Commit public outputs                                  │
//! │                                                                 │
//! │    Outputs (committed via io::commit, verifiable on-chain):    │
//! │      - modelHash:    bytes32  keccak256(model string)          │
//! │      - totalTokens:  uint256  tokens consumed by the LLM      │
//! │      - seedEpoch:    uint256  epoch number                     │
//! │      - seed:         uint256  Epoch Seed                       │
//! │      - minerAddress: address  miner address                    │
//! │      - claimIndex:   uint256  claim index within the epoch     │
//! └──────────────────────────┬──────────────────────────────────────┘
//!                            │
//!                            ▼
//! ┌─────────────────────────────────────────────────────────────────┐
//! │  SP1 Host (off-chain)                                           │
//! │    Generates Groth16 proof -> submits to on-chain               │
//! │    PoAIWMint.mint()                                             │
//! └─────────────────────────────────────────────────────────────────┘

#![no_main]
sp1_zkvm::entrypoint!(main);

use alloy_primitives::{Address, B256, U256};
use alloy_sol_types::SolValue;
use tiny_keccak::{Hasher, Keccak};

// ═══════════════════════════════════════════════════════════════
//  Data structures — private inputs from Host to Guest
// ═══════════════════════════════════════════════════════════════

/// TLSNotary evidence bundle (private input from Host)
/// Must be replaced with actual tlsn-core types for production deployment
#[derive(serde::Deserialize)]
struct TlsNotaryEvidence {
    /// Notary signature (secp256k1 or ed25519, signature over attestation_body)
    notary_signature: Vec<u8>,

    /// Attestation body (raw data signed by the Notary)
    /// Contains: Merkle root commitment of the TLS session
    attestation_body: Vec<u8>,

    /// Selectively disclosed transcript fragment
    /// In the OpenClaw scenario, this is the HTTP response JSON body
    disclosed_response_body: Vec<u8>,

    /// Selective disclosure proof (Merkle proof or hash commitment proof)
    /// Proves that disclosed_response_body is indeed in the transcript committed by attestation_body
    disclosure_proof: Vec<u8>,

    /// TLS server certificate chain (DER-encoded)
    /// Used to verify that the connection was made to the expected API server
    server_cert_chain: Vec<Vec<u8>>,

    /// Server domain name (Server Name Indication)
    server_name: String,
}

/// Mining parameters (passed from Host)
#[derive(serde::Deserialize)]
struct MiningParams {
    seed_epoch: u64,
    seed: [u8; 32],
    miner_address: [u8; 20],
    claim_index: u64,
}

/// Notary public key (passed from Host, used for signature verification)
#[derive(serde::Deserialize)]
struct NotaryPublicKey {
    /// Public key bytes (secp256k1 compressed: 33 bytes, or ed25519: 32 bytes)
    key_bytes: Vec<u8>,
    /// Signature algorithm type
    algorithm: String,
}

// ═══════════════════════════════════════════════════════════════
//  Helper functions
// ═══════════════════════════════════════════════════════════════

/// Compute keccak256 hash
fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak::v256();
    let mut output = [0u8; 32];
    hasher.update(data);
    hasher.finalize(&mut output);
    output
}

/// Extract the "model" field value from a JSON response
/// Input: `{"id":"chatcmpl-...","model":"grok-4.1-fast","choices":[...],"usage":{"total_tokens":1523}}`
/// Output: Some("grok-4.1-fast")
fn extract_model_from_json(json_bytes: &[u8]) -> Option<String> {
    let json_str = core::str::from_utf8(json_bytes).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(json_str).ok()?;
    parsed.get("model")?.as_str().map(|s| s.to_string())
}

/// Extract the "usage.total_tokens" field value from a JSON response
fn extract_total_tokens_from_json(json_bytes: &[u8]) -> Option<u64> {
    let json_str = core::str::from_utf8(json_bytes).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(json_str).ok()?;
    parsed.get("usage")?.get("total_tokens")?.as_u64()
}

/// Verify Notary signature
/// Must be replaced with real cryptographic verification for production deployment
fn verify_notary_signature(
    _public_key: &NotaryPublicKey,
    _attestation_body: &[u8],
    _signature: &[u8],
) -> bool {
    // ═══════════════════════════════════════════════════════════════
    // TODO: Replace with real implementation for production deployment
    //
    // For secp256k1:
    //   use k256::ecdsa::{VerifyingKey, Signature, signature::Verifier};
    //   let vk = VerifyingKey::from_sec1_bytes(&public_key.key_bytes)?;
    //   let sig = Signature::from_bytes(signature)?;
    //   vk.verify(attestation_body, &sig).is_ok()
    //
    // For ed25519:
    //   use ed25519_dalek::{VerifyingKey, Signature, Verifier};
    //   let vk = VerifyingKey::from_bytes(&public_key.key_bytes)?;
    //   let sig = Signature::from_bytes(signature)?;
    //   vk.verify(attestation_body, &sig).is_ok()
    //
    // SP1 zkVM supports precompile acceleration for both algorithms
    // ═══════════════════════════════════════════════════════════════
    true // PLACEHOLDER
}

/// Verify selective disclosure (disclosed_response_body is indeed in the attestation commitment)
fn verify_selective_disclosure(
    _attestation_body: &[u8],
    _disclosed_data: &[u8],
    _proof: &[u8],
) -> bool {
    // ═══════════════════════════════════════════════════════════════
    // TODO: Replace with real implementation for production deployment
    //
    // TLSNotary's selective disclosure is based on Merkle commitment:
    //   1. Attestation body contains the Merkle root of the transcript
    //   2. disclosed_data is a subset of the transcript
    //   3. proof is a Merkle inclusion proof
    //
    // Verification logic:
    //   - Combine disclosed_data with sibling hashes from the proof
    //   - Compute the Merkle root layer by layer
    //   - Check that the computed root matches the root stored in attestation_body
    //
    // The specific implementation depends on the TLSNotary version's commitment structure
    // Reference: tlsn-core::proof::TranscriptProof::verify()
    // ═══════════════════════════════════════════════════════════════
    true // PLACEHOLDER
}

/// Verify TLS server certificate chain
fn verify_server_identity(
    _cert_chain: &[Vec<u8>],
    _expected_server_name: &str,
) -> bool {
    // ═══════════════════════════════════════════════════════════════
    // TODO: Replace with real implementation for production deployment
    //
    // Verification steps:
    //   1. Parse DER-encoded X.509 certificate chain
    //   2. Verify certificate signature chain (leaf -> intermediate -> root CA)
    //   3. Check that the leaf certificate's SAN (Subject Alternative Name) matches the domain
    //   4. Check certificate validity period (optional, since TLSNotary attestation binds a timestamp)
    //
    // Reference: webpki::EndEntityCert, rustls-webpki
    // Note: SP1 guest cannot check OCSP/CRL over the network; relies on attestation-time checks
    // ═══════════════════════════════════════════════════════════════
    true // PLACEHOLDER
}

// ═══════════════════════════════════════════════════════════════
//  Main function — zkVM entry point
// ═══════════════════════════════════════════════════════════════

pub fn main() {
    // ═══ 1. Read private inputs (Host -> Guest, will not appear in the proof) ═══
    let evidence: TlsNotaryEvidence = sp1_zkvm::io::read();
    let params: MiningParams = sp1_zkvm::io::read();
    let notary_pubkey: NotaryPublicKey = sp1_zkvm::io::read();

    // ═══ 2. Verify Notary signature ═══
    // Ensure the attestation was indeed signed by a trusted Notary
    assert!(
        verify_notary_signature(
            &notary_pubkey,
            &evidence.attestation_body,
            &evidence.notary_signature,
        ),
        "Notary signature verification failed"
    );

    // ═══ 3. Verify selective disclosure ═══
    // Ensure the disclosed response body is indeed in the Notary-signed attestation
    assert!(
        verify_selective_disclosure(
            &evidence.attestation_body,
            &evidence.disclosed_response_body,
            &evidence.disclosure_proof,
        ),
        "Selective disclosure verification failed"
    );

    // ═══ 4. Verify server identity ═══
    // Ensure the TLS connection was to a legitimate API server (not a man-in-the-middle)
    assert!(
        verify_server_identity(
            &evidence.server_cert_chain,
            &evidence.server_name,
        ),
        "Server identity verification failed"
    );

    // ═══ 5. Extract key data ═══

    // 5a. Extract the model field from the JSON response
    let model_string = extract_model_from_json(&evidence.disclosed_response_body)
        .expect("Failed to extract 'model' from response JSON");

    // 5b. Extract the total_tokens field from the JSON response
    let total_tokens = extract_total_tokens_from_json(&evidence.disclosed_response_body)
        .expect("Failed to extract 'usage.total_tokens' from response JSON");

    // 5c. Verify total_tokens > 0
    assert!(total_tokens > 0, "total_tokens must be positive");

    // ═══ 6. Compute derived values ═══

    // 6a. modelHash = keccak256(UTF-8 bytes of the model string)
    //     Identical to Solidity's keccak256(bytes(modelId))
    let model_hash = keccak256(model_string.as_bytes());

    // ═══ 7. Commit public outputs (these values appear in the proof's publicValues) ═══
    //
    // Output encoding format: abi.encode(bytes32, uint256, uint256, uint256, address, uint256)
    // Corresponds to PoAIWMint.sol's abi.decode
    //
    // Field mapping:
    //   model_hash     -> PoAIWMint checks == eraModel[era]
    //   total_tokens   -> PoAIWMint computes reward = base * (1 + ln(T))
    //   seed_epoch     -> PoAIWMint checks == seedEpoch
    //   seed           -> PoAIWMint checks == currentSeed
    //   miner_address  -> PoAIWMint checks == msg.sender
    //   claim_index    -> PoAIWMint checks == epochClaimCount[sender][epoch]

    let model_hash_b256 = B256::from(model_hash);
    let total_tokens_u256 = U256::from(total_tokens);
    let seed_epoch_u256 = U256::from(params.seed_epoch);
    let seed_u256 = U256::from_be_bytes(params.seed);
    let miner_address = Address::from(params.miner_address);
    let claim_index_u256 = U256::from(params.claim_index);

    // ABI encode — matches Solidity abi.encode(bytes32, uint256, uint256, uint256, address, uint256)
    let public_values = (
        model_hash_b256,
        total_tokens_u256,
        seed_epoch_u256,
        seed_u256,
        miner_address,
        claim_index_u256,
    )
        .abi_encode();

    // Submit public outputs
    sp1_zkvm::io::commit_slice(&public_values);
}
