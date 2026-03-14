import { describe, it, expect } from 'vitest';
import { MetricsCollector } from '../src/metrics.js';

describe('MetricsCollector', () => {
  it('should initialize with zero counters', () => {
    const m = new MetricsCollector();
    expect(m.attestSuccess).toBe(0);
    expect(m.attestRejected).toBe(0);
    expect(m.nonceRequests).toBe(0);
    expect(m.attestDurationSum).toBe(0);
    expect(m.attestDurationCount).toBe(0);
    expect(m.chainBlock).toBe(0);
    expect(m.chainEra).toBe(0);
    expect(m.chainEpoch).toBe(0);
  });

  it('should record successful attestations', () => {
    const m = new MetricsCollector();
    m.recordAttest(true, 50);
    m.recordAttest(true, 100);
    expect(m.attestSuccess).toBe(2);
    expect(m.attestRejected).toBe(0);
    expect(m.attestDurationSum).toBe(150);
    expect(m.attestDurationCount).toBe(2);
  });

  it('should record rejected attestations', () => {
    const m = new MetricsCollector();
    m.recordAttest(false, 10);
    expect(m.attestSuccess).toBe(0);
    expect(m.attestRejected).toBe(1);
    expect(m.attestDurationSum).toBe(10);
    expect(m.attestDurationCount).toBe(1);
  });

  it('should record nonce requests', () => {
    const m = new MetricsCollector();
    m.recordNonce();
    m.recordNonce();
    m.recordNonce();
    expect(m.nonceRequests).toBe(3);
  });

  it('should update chain state', () => {
    const m = new MetricsCollector();
    m.updateChainState(19500000, 1, 42);
    expect(m.chainBlock).toBe(19500000);
    expect(m.chainEra).toBe(1);
    expect(m.chainEpoch).toBe(42);
  });

  it('should compute average attest duration', () => {
    const m = new MetricsCollector();
    expect(m.getAvgAttestMs()).toBe(0); // no data
    m.recordAttest(true, 100);
    m.recordAttest(true, 200);
    m.recordAttest(false, 300);
    expect(m.getAvgAttestMs()).toBe(200); // (100+200+300)/3 = 200
  });

  describe('toPrometheus', () => {
    it('should produce valid Prometheus format', () => {
      const m = new MetricsCollector();
      m.recordAttest(true, 50);
      m.recordAttest(true, 150);
      m.recordAttest(false, 30);
      m.recordNonce();
      m.recordNonce();
      m.updateChainState(19500000, 1, 42);

      const output = m.toPrometheus();

      // Check HELP comments
      expect(output).toContain('# HELP clawing_oracle_attestations_total');
      expect(output).toContain('# TYPE clawing_oracle_attestations_total counter');

      // Check metric values
      expect(output).toContain('clawing_oracle_attestations_total{status="success"} 2');
      expect(output).toContain('clawing_oracle_attestations_total{status="rejected"} 1');
      expect(output).toContain('clawing_oracle_nonces_total 2');
      expect(output).toContain('clawing_oracle_attest_duration_ms_sum 230');
      expect(output).toContain('clawing_oracle_attest_duration_ms_count 3');
      expect(output).toContain('clawing_oracle_chain_block_number 19500000');
      expect(output).toContain('clawing_oracle_chain_era 1');
      expect(output).toContain('clawing_oracle_chain_epoch 42');
    });

    it('should include TYPE annotations', () => {
      const m = new MetricsCollector();
      const output = m.toPrometheus();

      expect(output).toContain('# TYPE clawing_oracle_attestations_total counter');
      expect(output).toContain('# TYPE clawing_oracle_nonces_total counter');
      expect(output).toContain('# TYPE clawing_oracle_attest_duration_ms histogram');
      expect(output).toContain('# TYPE clawing_oracle_uptime_seconds gauge');
      expect(output).toContain('# TYPE clawing_oracle_chain_block_number gauge');
      expect(output).toContain('# TYPE clawing_oracle_chain_era gauge');
      expect(output).toContain('# TYPE clawing_oracle_chain_epoch gauge');
    });

    it('should have zero values when empty', () => {
      const m = new MetricsCollector();
      const output = m.toPrometheus();

      expect(output).toContain('clawing_oracle_attestations_total{status="success"} 0');
      expect(output).toContain('clawing_oracle_attestations_total{status="rejected"} 0');
      expect(output).toContain('clawing_oracle_nonces_total 0');
      expect(output).toContain('clawing_oracle_attest_duration_ms_sum 0');
      expect(output).toContain('clawing_oracle_attest_duration_ms_count 0');
    });
  });
});
