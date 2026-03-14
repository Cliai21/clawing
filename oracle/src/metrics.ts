import { getUptimeSeconds } from './health.js';

export class MetricsCollector {
  public attestSuccess = 0;
  public attestRejected = 0;
  public nonceRequests = 0;
  public attestDurationSum = 0;
  public attestDurationCount = 0;
  public chainBlock = 0;
  public chainEra = 0;
  public chainEpoch = 0;

  recordAttest(success: boolean, durationMs: number): void {
    if (success) this.attestSuccess++;
    else this.attestRejected++;
    this.attestDurationSum += durationMs;
    this.attestDurationCount++;
  }

  recordNonce(): void {
    this.nonceRequests++;
  }

  updateChainState(block: number, era: number, epoch: number): void {
    this.chainBlock = block;
    this.chainEra = era;
    this.chainEpoch = epoch;
  }

  getAvgAttestMs(): number {
    if (this.attestDurationCount === 0) return 0;
    return Math.round(this.attestDurationSum / this.attestDurationCount);
  }

  toPrometheus(): string {
    const lines: string[] = [];

    lines.push('# HELP clawing_oracle_attestations_total Total attestation requests');
    lines.push('# TYPE clawing_oracle_attestations_total counter');
    lines.push(`clawing_oracle_attestations_total{status="success"} ${this.attestSuccess}`);
    lines.push(`clawing_oracle_attestations_total{status="rejected"} ${this.attestRejected}`);
    lines.push('');

    lines.push('# HELP clawing_oracle_nonces_total Total nonce requests');
    lines.push('# TYPE clawing_oracle_nonces_total counter');
    lines.push(`clawing_oracle_nonces_total ${this.nonceRequests}`);
    lines.push('');

    lines.push('# HELP clawing_oracle_attest_duration_ms Attestation request latency');
    lines.push('# TYPE clawing_oracle_attest_duration_ms histogram');
    lines.push(`clawing_oracle_attest_duration_ms_sum ${this.attestDurationSum}`);
    lines.push(`clawing_oracle_attest_duration_ms_count ${this.attestDurationCount}`);
    lines.push('');

    lines.push('# HELP clawing_oracle_uptime_seconds Server uptime');
    lines.push('# TYPE clawing_oracle_uptime_seconds gauge');
    lines.push(`clawing_oracle_uptime_seconds ${getUptimeSeconds()}`);
    lines.push('');

    lines.push('# HELP clawing_oracle_chain_block_number Latest known block');
    lines.push('# TYPE clawing_oracle_chain_block_number gauge');
    lines.push(`clawing_oracle_chain_block_number ${this.chainBlock}`);
    lines.push('');

    lines.push('# HELP clawing_oracle_chain_era Current era');
    lines.push('# TYPE clawing_oracle_chain_era gauge');
    lines.push(`clawing_oracle_chain_era ${this.chainEra}`);
    lines.push('');

    lines.push('# HELP clawing_oracle_chain_epoch Current global epoch');
    lines.push('# TYPE clawing_oracle_chain_epoch gauge');
    lines.push(`clawing_oracle_chain_epoch ${this.chainEpoch}`);
    lines.push('');

    return lines.join('\n');
  }
}
