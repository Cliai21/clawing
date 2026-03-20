import Database from 'better-sqlite3';
import type { Config } from './config.js';

export class RateLimiter {
  /** In-memory cache for fast lookups */
  private attestCache: Map<string, number> = new Map();
  private nonceCache: Map<string, number[]> = new Map();

  private windowSeconds: number;
  private maxPerWindow: number;
  private db: Database.Database;

  private static readonly NONCE_RATE_LIMIT = 10; // per minute
  private static readonly NONCE_WINDOW_SECONDS = 60;

  constructor(config: Config, dbPath: string = ':memory:') {
    this.windowSeconds = config.rateLimitWindowSeconds;
    this.maxPerWindow = config.rateLimitMaxPerWindow;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        address TEXT PRIMARY KEY,
        last_attest_timestamp INTEGER NOT NULL
      )
    `);

    // Load persisted rate limits into memory
    const rows = this.db.prepare('SELECT address, last_attest_timestamp FROM rate_limits').all() as Array<{
      address: string;
      last_attest_timestamp: number;
    }>;
    for (const row of rows) {
      this.attestCache.set(row.address, row.last_attest_timestamp);
    }
  }

  /** Check if an attest request is rate limited. Throws if limited. */
  checkAttest(address: string): void {
    const now = Math.floor(Date.now() / 1000);
    const lastTs = this.attestCache.get(address);
    if (lastTs !== undefined && now - lastTs < this.windowSeconds) {
      const remaining = this.windowSeconds - (now - lastTs);
      throw new RateLimitError(`Rate limited. Try again in ${remaining} seconds.`);
    }
  }

  /** Record a successful attestation */
  recordAttest(address: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.attestCache.set(address, now);
    this.db
      .prepare('INSERT OR REPLACE INTO rate_limits (address, last_attest_timestamp) VALUES (?, ?)')
      .run(address, now);
  }

  /** Check if a nonce request is rate limited (10/min per address) */
  checkNonce(address: string): void {
    const now = Math.floor(Date.now() / 1000);
    const window = RateLimiter.NONCE_WINDOW_SECONDS;
    const timestamps = this.nonceCache.get(address) ?? [];

    // Remove timestamps outside the window
    const valid = timestamps.filter(ts => now - ts < window);
    this.nonceCache.set(address, valid);

    if (valid.length >= RateLimiter.NONCE_RATE_LIMIT) {
      throw new RateLimitError('Nonce rate limited. Max 10 requests per minute.');
    }
  }

  /** Record a nonce request */
  recordNonce(address: string): void {
    const now = Math.floor(Date.now() / 1000);
    const timestamps = this.nonceCache.get(address) ?? [];
    timestamps.push(now);
    this.nonceCache.set(address, timestamps);
  }

  /** Clear the attest rate limit for a specific address (admin use) */
  clearAttest(address: string): void {
    this.attestCache.delete(address);
    this.db.prepare('DELETE FROM rate_limits WHERE address = ?').run(address);
  }

  close(): void {
    this.db.close();
  }
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}
