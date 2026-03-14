import Database from 'better-sqlite3';

export class RequestLogger {
  private db: Database.Database;
  public totalAttestations = 0;
  public totalRejected = 0;
  public totalNonces = 0;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS request_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        request_id TEXT,
        miner_address TEXT,
        endpoint TEXT NOT NULL,
        success INTEGER NOT NULL,
        error_code TEXT,
        total_tokens INTEGER,
        seed_epoch INTEGER,
        claim_index INTEGER,
        signature_hash TEXT,
        ip_address TEXT,
        response_time_ms INTEGER
      )
    `);

    // Load counters from existing data
    const stats = this.db
      .prepare('SELECT SUM(CASE WHEN success=1 AND endpoint=\'/api/v1/attest\' THEN 1 ELSE 0 END) as ok, SUM(CASE WHEN success=0 AND endpoint=\'/api/v1/attest\' THEN 1 ELSE 0 END) as fail, SUM(CASE WHEN endpoint=\'/api/v1/nonce\' THEN 1 ELSE 0 END) as nonces FROM request_log')
      .get() as { ok: number | null; fail: number | null; nonces: number | null };
    this.totalAttestations = stats.ok ?? 0;
    this.totalRejected = stats.fail ?? 0;
    this.totalNonces = stats.nonces ?? 0;
  }

  log(entry: {
    request_id?: string;
    miner_address?: string;
    endpoint: string;
    success: boolean;
    error_code?: string;
    total_tokens?: number;
    seed_epoch?: number;
    claim_index?: number;
    signature_hash?: string;
    ip_address?: string;
    response_time_ms?: number;
  }): void {
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare(`
      INSERT INTO request_log (timestamp, request_id, miner_address, endpoint, success, error_code, total_tokens, seed_epoch, claim_index, signature_hash, ip_address, response_time_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      now,
      entry.request_id ?? null,
      entry.miner_address ?? null,
      entry.endpoint,
      entry.success ? 1 : 0,
      entry.error_code ?? null,
      entry.total_tokens ?? null,
      entry.seed_epoch ?? null,
      entry.claim_index ?? null,
      entry.signature_hash ?? null,
      entry.ip_address ?? null,
      entry.response_time_ms ?? null,
    );

    if (entry.endpoint === '/api/v1/attest') {
      if (entry.success) this.totalAttestations++;
      else this.totalRejected++;
    }
    if (entry.endpoint === '/api/v1/nonce') {
      this.totalNonces++;
    }
  }

  close(): void {
    this.db.close();
  }
}
