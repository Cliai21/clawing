import { ethers } from 'ethers';
import type { DeployedContracts } from './deploy.js';

const POAIW_ABI = [
  'function currentEra() view returns (uint256)',
  'function currentGlobalEpoch() view returns (uint256)',
  'function currentSeed() view returns (uint256)',
  'function seedEpoch() view returns (uint256)',
  'function startBlock() view returns (uint256)',
  'function eraModel(uint256) view returns (bytes32)',
  'function cooldownRemaining(address) view returns (uint256)',
  'function epochClaimCount(address,uint256) view returns (uint256)',
  'function lastClaimBlock(address) view returns (uint256)',
  'function epochMinted(uint256) view returns (uint256)',
  'function totalClaims() view returns (uint256)',
  'function estimateReward(uint256) view returns (uint256)',
  'function updateSeed() external',
  'function mint(bytes32 modelHash, uint256 totalTokens, uint256 claimSeedEpoch, uint256 claimSeed, uint256 claimIndex, uint256 deadline, bytes signature) external',
  'function COOLDOWN_BLOCKS() view returns (uint256)',
  'function MAX_CLAIMS_PER_EPOCH() view returns (uint256)',
  'function BLOCKS_PER_EPOCH() view returns (uint256)',
  'function perBlockForEra(uint256) view returns (uint256)',
  'function epochCap(uint256) view returns (uint256)',
];

const TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function totalMinted() view returns (uint256)',
  'function minter() view returns (address)',
];

const VERIFIER_ABI = [
  'function isOracleSigner(address) view returns (bool)',
  'function oracleCount() view returns (uint256)',
  'function oracleSignerAt(uint256) view returns (address)',
  'function SIGNATURE_VALIDITY_BLOCKS() view returns (uint256)',
  'function usedSignatures(bytes32) view returns (bool)',
];

const MINTER_PROXY_ABI = [
  'function activeMinter() view returns (address)',
  'function guardian() view returns (address)',
  'function pendingMinter() view returns (address)',
  'function token() view returns (address)',
];

export interface ContractClients {
  poaiwMint: ethers.Contract;
  token: ethers.Contract;
  verifier: ethers.Contract;
  minterProxy: ethers.Contract;
}

export function getContracts(
  provider: ethers.JsonRpcProvider,
  addresses: DeployedContracts,
): ContractClients {
  return {
    poaiwMint: new ethers.Contract(addresses.poaiwMint, POAIW_ABI, provider),
    token: new ethers.Contract(addresses.clawToken, TOKEN_ABI, provider),
    verifier: new ethers.Contract(addresses.oracleVerifier, VERIFIER_ABI, provider),
    minterProxy: new ethers.Contract(addresses.minterProxy, MINTER_PROXY_ABI, provider),
  };
}

export function getSignedPoaiwMint(
  provider: ethers.JsonRpcProvider,
  addresses: DeployedContracts,
  privateKey: string,
): ethers.Contract {
  const wallet = new ethers.Wallet(privateKey, provider);
  return new ethers.Contract(addresses.poaiwMint, POAIW_ABI, wallet);
}
