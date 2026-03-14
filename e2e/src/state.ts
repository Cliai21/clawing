import type { ethers } from 'ethers';
import type { DeployedContracts } from './deploy.js';
import type { ContractClients } from './contracts.js';

/** Global shared state for all tests */
export const state: {
  contracts: ContractClients | null;
  addresses: DeployedContracts | null;
  provider: ethers.JsonRpcProvider | null;
  oracleUrl: string;
  initialized: boolean;
} = {
  contracts: null,
  addresses: null,
  provider: null,
  oracleUrl: '',
  initialized: false,
};
