import { ethers } from 'ethers';

/**
 * ECDSA signing logic that MUST match OracleVerifier.sol._computeEthSignedHash() exactly.
 *
 * Solidity:
 *   bytes32 dataHash = keccak256(abi.encode(
 *       block.chainid,    // uint256
 *       address(this),    // address (OracleVerifier contract)
 *       minerAddress,     // address
 *       modelHash,        // bytes32
 *       totalTokens,      // uint256
 *       seedEpoch,        // uint256
 *       seed,             // uint256
 *       claimIndex,       // uint256
 *       deadline          // uint256
 *   ));
 *   return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", dataHash));
 *
 * ethers.Wallet.signMessage(bytes) auto-prepends the EIP-191 prefix.
 */

export function computeDataHash(
  chainId: bigint,
  verifierAddress: string,
  minerAddress: string,
  modelHash: string,
  totalTokens: bigint,
  seedEpoch: bigint,
  seed: bigint,
  claimIndex: bigint,
  deadline: bigint,
): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'address', 'address', 'bytes32', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
      [chainId, verifierAddress, minerAddress, modelHash, totalTokens, seedEpoch, seed, claimIndex, deadline],
    ),
  );
}

export async function signAttestation(
  wallet: ethers.Wallet,
  chainId: bigint,
  verifierAddress: string,
  minerAddress: string,
  modelHash: string,
  totalTokens: bigint,
  seedEpoch: bigint,
  seed: bigint,
  claimIndex: bigint,
  deadline: bigint,
): Promise<string> {
  const dataHash = computeDataHash(
    chainId, verifierAddress, minerAddress, modelHash,
    totalTokens, seedEpoch, seed, claimIndex, deadline,
  );

  // signMessage(bytes) adds "\x19Ethereum Signed Message:\n32" prefix automatically
  const signature = await wallet.signMessage(ethers.getBytes(dataHash));
  return signature;
}

/**
 * Verify a signature recovers to the expected signer address.
 * Used for startup self-test.
 */
export function recoverSigner(
  chainId: bigint,
  verifierAddress: string,
  minerAddress: string,
  modelHash: string,
  totalTokens: bigint,
  seedEpoch: bigint,
  seed: bigint,
  claimIndex: bigint,
  deadline: bigint,
  signature: string,
): string {
  const dataHash = computeDataHash(
    chainId, verifierAddress, minerAddress, modelHash,
    totalTokens, seedEpoch, seed, claimIndex, deadline,
  );

  return ethers.verifyMessage(ethers.getBytes(dataHash), signature);
}
