import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import type { Config } from './config.js';

export class NonceManager {
  private db: Database.Database;
  private ttlSeconds: number;
  private maxPerAddress: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Config, dbPath: string = ':memory:') {
    this.ttlSeconds = config.nonceTtlSeconds;
    this.maxPerAddress = config.nonceMaxPerAddress;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nonces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nonce TEXT UNIQUE NOT NULL,
        miner_address TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used INTEGER DEFAULT 0
      )
    `);
  }

  /** Start periodic cleanup of expired nonces (every 60s) */
  startCleanup(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Generate a new nonce for the given miner address */
  generate(minerAddress: string): { nonce: string; expires_at: number } {
    // Check outstanding nonce count
    const now = Math.floor(Date.now() / 1000);
    const outstanding = this.db
      .prepare('SELECT COUNT(*) as cnt FROM nonces WHERE miner_address = ? AND used = 0 AND expires_at > ?')
      .get(minerAddress, now) as { cnt: number };

    if (outstanding.cnt >= this.maxPerAddress) {
      throw new Error(`Max outstanding nonces (${this.maxPerAddress}) reached for ${minerAddress}`);
    }

    const hex = crypto.randomBytes(4).toString('hex');
    const nonce = `CLAW-${hex}-${now}`;
    const expiresAt = now + this.ttlSeconds;

    this.db
      .prepare('INSERT INTO nonces (nonce, miner_address, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(nonce, minerAddress, now, expiresAt);

    return { nonce, expires_at: expiresAt };
  }

  /**
   * Validate and consume a nonce. Returns true if valid, throws descriptive error otherwise.
   */
  validate(nonce: string, minerAddress: string): void {
    const now = Math.floor(Date.now() / 1000);
    const row = this.db
      .prepare('SELECT * FROM nonces WHERE nonce = ?')
      .get(nonce) as { miner_address: string; expires_at: number; used: number } | undefined;

    if (!row) {
      throw new NonceError('INVALID_NONCE', `Nonce not found: ${nonce}`);
    }
    if (row.used) {
      throw new NonceError('NONCE_ALREADY_USED', `Nonce already used: ${nonce}`);
    }
    if (now >= row.expires_at) {
      throw new NonceError('NONCE_EXPIRED', `Nonce expired: ${nonce}`);
    }
    if (row.miner_address !== minerAddress) {
      throw new NonceError('INVALID_NONCE', `Nonce does not belong to miner ${minerAddress}`);
    }

    // Mark as used
    this.db.prepare('UPDATE nonces SET used = 1 WHERE nonce = ?').run(nonce);
  }

  /** Remove expired nonces */
  cleanup(): number {
    const now = Math.floor(Date.now() / 1000);
    const result = this.db.prepare('DELETE FROM nonces WHERE expires_at <= ?').run(now);
    return result.changes;
  }

  close(): void {
    this.stopCleanup();
    this.db.close();
  }
}

export class NonceError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'NonceError';
    this.code = code;
  }
}
