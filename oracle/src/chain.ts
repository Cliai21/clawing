import { ethers } from 'ethers';
import type { ChainState, MinerState } from './types.js';
import type { Config } from './config.js';

const POAIW_ABI = [
  'function currentEra() view returns (uint256)',
  'function currentGlobalEpoch() view returns (uint256)',
  'function currentSeed() view returns (uint256)',
  'function seedEpoch() view returns (uint256)',
  'function eraModel(uint256) view returns (bytes32)',
  'function cooldownRemaining(address) view returns (uint256)',
  'function epochClaimCount(address,uint256) view returns (uint256)',
  'function lastClaimBlock(address) view returns (uint256)',
  'function MAX_CLAIMS_PER_EPOCH() view returns (uint256)',
  'function COOLDOWN_BLOCKS() view returns (uint256)',
  'function MIN_TOKENS() view returns (uint256)',
  'function MAX_TOKENS() view returns (uint256)',
  'function estimateReward(uint256) view returns (uint256)',
];

const VERIFIER_ABI = [
  'function SIGNATURE_VALIDITY_BLOCKS() view returns (uint256)',
  'function isOracleSigner(address) view returns (bool)',
];

export class ChainReader {
  public readonly provider: ethers.JsonRpcProvider;
  public readonly poaiwMint: ethers.Contract;
  public readonly verifier: ethers.Contract;

  private cachedBlock: number = 0;
  private cachedState: ChainState | null = null;
  private stateTimestamp: number = 0;
  private readonly STATE_CACHE_TTL = 30_000; // 30 seconds
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Config) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.poaiwMint = new ethers.Contract(config.poaiwMintAddress, POAIW_ABI, this.provider);
    this.verifier = new ethers.Contract(config.oracleVerifierAddress, VERIFIER_ABI, this.provider);
  }

  /** Start background sync loop (block every 12s, state every 30s) */
  startSyncLoop(): void {
    const sync = async () => {
      try {
        this.cachedBlock = await this.provider.getBlockNumber();
      } catch {
        // Silently ignore — cached value remains
      }
      try {
        const now = Date.now();
        if (!this.cachedState || now - this.stateTimestamp > this.STATE_CACHE_TTL) {
          this.cachedState = await this.getChainState();
          this.stateTimestamp = now;
        }
      } catch {
        // Silently ignore — cached value remains
      }
    };
    sync();
    this.syncTimer = setInterval(sync, 12_000);
  }

  stopSyncLoop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  getCachedBlockNumber(): number {
    return this.cachedBlock;
  }

  getCachedState(): ChainState | null {
    return this.cachedState;
  }

  async getChainState(): Promise<ChainState> {
    const [currentEra, currentGlobalEpoch, currentSeed, seedEpoch, blockNumber] =
      await Promise.all([
        this.poaiwMint.currentEra() as Promise<bigint>,
        this.poaiwMint.currentGlobalEpoch() as Promise<bigint>,
        this.poaiwMint.currentSeed() as Promise<bigint>,
        this.poaiwMint.seedEpoch() as Promise<bigint>,
        this.provider.getBlockNumber(),
      ]);

    const eraModelHash: string = await this.poaiwMint.eraModel(currentEra);

    return {
      currentEra,
      currentGlobalEpoch,
      currentSeed,
      seedEpoch,
      eraModelHash,
      currentBlock: blockNumber,
    };
  }

  async getMinerState(minerAddress: string, epoch: bigint): Promise<MinerState> {
    const [cooldownRemaining, epochClaimCount, lastClaimBlock] = await Promise.all([
      this.poaiwMint.cooldownRemaining(minerAddress) as Promise<bigint>,
      this.poaiwMint.epochClaimCount(minerAddress, epoch) as Promise<bigint>,
      this.poaiwMint.lastClaimBlock(minerAddress) as Promise<bigint>,
    ]);

    return { cooldownRemaining, epochClaimCount, lastClaimBlock };
  }

  async getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async isOracleSigner(address: string): Promise<boolean> {
    return this.verifier.isOracleSigner(address) as Promise<boolean>;
  }

  async estimateReward(totalTokens: bigint): Promise<bigint> {
    return this.poaiwMint.estimateReward(totalTokens) as Promise<bigint>;
  }

  async getMaxClaimsPerEpoch(): Promise<bigint> {
    return this.poaiwMint.MAX_CLAIMS_PER_EPOCH() as Promise<bigint>;
  }

  async getMinTokens(): Promise<bigint> {
    return this.poaiwMint.MIN_TOKENS() as Promise<bigint>;
  }

  async getMaxTokens(): Promise<bigint> {
    return this.poaiwMint.MAX_TOKENS() as Promise<bigint>;
  }
}
