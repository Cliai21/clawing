//! OpenClaw SP1 Host — Proof Generator
//!
//! Function: Receives TLSNotary evidence + mining parameters, drives SP1 zkVM to execute
//!           the Guest Program, generates a Groth16 proof, and outputs (publicValues, proofBytes)
//!           for on-chain verification.
//!
//! Usage:
//!   cargo run --release -- \
//!     --evidence /path/to/tlsnotary_evidence.json \
//!     --seed-epoch 42 \
//!     --seed 0xabcdef... \
//!     --miner 0x1234...5678 \
//!     --claim-index 3 \
//!     --output /path/to/proof_output.json

use clap::Parser;
use sp1_sdk::{ProverClient, SP1Stdin};
use std::path::PathBuf;

/// Guest Program ELF binary (auto-generated after compilation)
/// Path: target/elf-compilation/riscv32im-succinct-zkvm-elf/release/openclaw-circuit
const GUEST_ELF: &[u8] = include_bytes!(
    "../../target/elf-compilation/riscv32im-succinct-zkvm-elf/release/openclaw-circuit"
);

#[derive(Parser, Debug)]
#[command(name = "openclaw-host", about = "OpenClaw SP1 Proof Generator")]
struct Args {
    /// TLSNotary evidence file path (JSON)
    #[arg(long)]
    evidence: PathBuf,

    /// Global epoch number corresponding to the Epoch Seed
    #[arg(long)]
    seed_epoch: u64,

    /// Epoch Seed (hex, 32 bytes)
    #[arg(long)]
    seed: String,

    /// Miner address (hex, 20 bytes)
    #[arg(long)]
    miner: String,

    /// Claim index for this address in this epoch (0-based)
    #[arg(long)]
    claim_index: u64,

    /// Proof output file path
    #[arg(long, default_value = "proof_output.json")]
    output: PathBuf,

    /// Use mock prover (local testing, does not generate a real proof)
    #[arg(long, default_value_t = false)]
    mock: bool,
}

/// Proof output structure (JSON serialized, for client submission to on-chain)
#[derive(serde::Serialize)]
struct ProofOutput {
    /// ABI-encoded publicValues (hex)
    public_values: String,
    /// SP1 proof bytes (hex, includes 4-byte verifier selector prefix)
    proof_bytes: String,
    /// Proof type
    proof_type: String,
}

#[tokio::main]
async fn main() -> eyre::Result<()> {
    let args = Args::parse();

    // ═══ 1. Load TLSNotary evidence ═══
    let evidence_json = std::fs::read_to_string(&args.evidence)?;
    println!("[+] Loaded TLSNotary evidence: {}", args.evidence.display());

    // ═══ 2. Construct mining parameters ═══
    let seed_bytes = hex::decode(args.seed.trim_start_matches("0x"))?;
    let miner_bytes = hex::decode(args.miner.trim_start_matches("0x"))?;

    assert_eq!(seed_bytes.len(), 32, "Seed must be 32 bytes");
    assert_eq!(miner_bytes.len(), 20, "Miner address must be 20 bytes");

    let mut seed_arr = [0u8; 32];
    seed_arr.copy_from_slice(&seed_bytes);

    let mut miner_arr = [0u8; 20];
    miner_arr.copy_from_slice(&miner_bytes);

    // ═══ 3. Prepare SP1 inputs ═══
    let mut stdin = SP1Stdin::new();

    // Write TLSNotary evidence (private input — will not appear in the proof)
    stdin.write(&evidence_json);

    // Write mining parameters
    let mining_params = serde_json::json!({
        "seed_epoch": args.seed_epoch,
        "seed": seed_arr,
        "miner_address": miner_arr,
        "claim_index": args.claim_index,
    });
    stdin.write(&serde_json::to_string(&mining_params)?);

    // Write Notary public key (in production, read from trusted configuration)
    let notary_pubkey = serde_json::json!({
        "key_bytes": [],
        "algorithm": "secp256k1",
    });
    stdin.write(&serde_json::to_string(&notary_pubkey)?);

    // ═══ 4. Initialize SP1 Prover ═══
    let client = ProverClient::from_env();
    let (pk, _vk) = client.setup(GUEST_ELF);

    println!("[+] SP1 Prover initialization complete");
    println!("[+] Program VKey: 0x{}", hex::encode(_vk.bytes32()));

    // ═══ 5. Generate proof ═══
    if args.mock {
        // Mock mode: fast execution, does not generate a real ZK proof
        println!("[+] Mock mode — executing Guest Program (no ZK proof generated)");
        let (public_values, _) = client.execute(GUEST_ELF, &stdin).run()?;

        let output = ProofOutput {
            public_values: format!("0x{}", hex::encode(public_values.as_slice())),
            proof_bytes: "0x".to_string(), // Mock — no proof
            proof_type: "mock".to_string(),
        };

        let output_json = serde_json::to_string_pretty(&output)?;
        std::fs::write(&args.output, &output_json)?;
        println!("[+] Mock output written to: {}", args.output.display());
    } else {
        // Production mode: generate Groth16 proof (~5-15 minutes, depending on hardware)
        println!("[+] Generating Groth16 proof... (this may take several minutes)");
        let proof = client.prove(&pk, &stdin).groth16().run()?;

        let public_values_hex =
            format!("0x{}", hex::encode(proof.public_values.as_slice()));
        let proof_bytes_hex = format!("0x{}", hex::encode(proof.bytes()));

        let output = ProofOutput {
            public_values: public_values_hex,
            proof_bytes: proof_bytes_hex,
            proof_type: "groth16".to_string(),
        };

        let output_json = serde_json::to_string_pretty(&output)?;
        std::fs::write(&args.output, &output_json)?;
        println!("[+] Groth16 proof written to: {}", args.output.display());

        // Local verification
        println!("[+] Verifying proof locally...");
        client.verify(&proof, &_vk)?;
        println!("[+] Proof verification passed ✓");
    }

    Ok(())
}
