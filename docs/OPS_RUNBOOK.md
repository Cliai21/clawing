# Clawing Operations Runbook

Emergency procedures and operational guide for the Clawing protocol. This document covers incident response for all critical failure modes.

---

## 1. Oracle Private Key Compromise

**Severity:** CRITICAL

**Detection:**
- Unauthorized `mint()` transactions appearing on-chain
- Abnormal token distribution patterns (minting to unknown addresses)
- Oracle logs showing signing requests not initiated by real miners

**Impact Assessment:**
- Attacker is rate-limited by on-chain constraints:
  - 3,500-block cooldown (~11.67 hours) between claims
  - Max 14 claims per Epoch per address
  - Epoch token cap limits total extraction
- Maximum damage per Epoch is bounded by `epochCap()`

**Response:**

| Step | Action | Timeline |
|------|--------|----------|
| 1 | Guardian proposes new minter via `MinterProxy.proposeMinter()` pointing to a new PoAIWMint with a fresh OracleVerifier | Immediately |
| 2 | Monitor attacker activity — they are rate-limited by cooldown and epoch caps | Days 1–7 |
| 3 | Deploy new Oracle server with fresh signing key | Days 1–3 |
| 4 | New minter takes effect after 7-day timelock | Day 7 |
| 5 | Old Oracle key is effectively revoked (new OracleVerifier has different signers) | Day 7 |
| 6 | Post-incident: update DNS, notify miners to update `ORACLE_URL`, publish post-mortem | Day 7+ |

**Maximum attacker extraction:**
- Per address: ~14 claims per Epoch × ~12 Epochs in 7 days = ~168 claims
- Each claim is bounded by the logarithmic reward formula
- Total damage is a small fraction of the Epoch cap

---

## 2. Oracle Server Down

**Severity:** HIGH

**Detection:**
- `/health` endpoint returns non-200 or is unreachable
- Uptime Robot / monitoring alert fires
- Miners report attestation failures

**Response:**

```bash
# 1. Check systemd service status
systemctl status openclaw-oracle

# 2. Check Docker logs (if containerized)
docker compose logs --tail=100 oracle

# 3. Check for common issues
df -h              # Disk space
free -m            # Memory
curl localhost:3000/health  # Local health check
```

| Issue | Fix |
|-------|-----|
| Process crashed | `systemctl restart openclaw-oracle` — auto-restart should handle most cases |
| Out of memory | Increase instance size or add swap space |
| RPC URL unreachable | Check Ethereum RPC provider status; switch to backup RPC |
| SQLite locked/corrupt | Stop service, backup DB, restart (nonce DB is recoverable) |
| Disk full | Clear old logs: `journalctl --vacuum-time=7d` |

**Failover procedure:**
1. Start backup Oracle on secondary VPS using the same signing key
2. Update DNS to point to the backup instance
3. OracleVerifier supports 1–5 signers — add the backup node as an additional signer for future redundancy

**Multi-node setup:**
The OracleVerifier contract supports up to 5 Oracle signer nodes. Any single valid signer can issue attestations independently. To add redundancy:
- Deploy multiple Oracle instances with different signing keys
- Register all signer addresses in the OracleVerifier at deployment time
- If one node goes down, others continue operating with zero coordination overhead

---

## 3. Guardian Private Key Compromise

**Severity:** CRITICAL (mitigated by design)

**Detection:**
- Unexpected `MinterProposed` events on-chain from the Guardian address
- Monitor: filter for `MinterProposed(address indexed newMinter, uint256 executeAfter, address indexed proposer)` events

**Response:**

| Scenario | Action |
|----------|--------|
| Attacker proposes malicious minter | Guardian calls `cancelMinterChange()` — up to 3 cancellations available |
| Guardian key itself is compromised | Race condition — attacker must wait 7 days for any proposal to take effect |
| Community detects unauthorized proposal | 7-day window to organize response, deploy countermeasures |

**Design mitigations:**
- 7-day mandatory timelock on ALL minter changes — no fast path
- Guardian has max 3 cancellations total (prevents griefing if attacker gets the key)
- All `MinterProposed` events are indexed and publicly visible
- Community monitoring will detect unauthorized proposals within hours

**Prevention:**
- Store Guardian private key on a Ledger hardware wallet
- Never connect the Guardian wallet to the internet for routine operations
- Consider multi-sig wallet for the Guardian role in the future
- Guardian can call `renounceGuardian()` for full decentralization (irreversible)

---

## 4. High Gas Prices

**Severity:** MEDIUM

**Detection:**
- Miners reporting gas estimation errors or transaction reverts
- Auto-mine loops pausing due to `MAX_GAS_PRICE_GWEI` threshold

**Response:**

1. **This is normal Ethereum behavior** — no action required from operators
2. Miners should configure `MAX_GAS_PRICE_GWEI` in their `.env` file:
   - Low priority: `2` gwei (default)
   - Medium priority: `10` gwei
   - High priority: `30`+ gwei
3. The cooldown period (~11.67 hours) naturally spaces out transactions — there is no rush
4. A single `mint()` call costs ~100k gas — manageable even at moderate gas prices:

| Gas Price | Cost per Mine (at 100k gas) |
|-----------|---------------------------|
| 2 gwei | ~0.0002 ETH |
| 10 gwei | ~0.001 ETH |
| 30 gwei | ~0.003 ETH |
| 100 gwei | ~0.01 ETH |

**Miner guidance:** Use the `auto` command — it automatically waits for gas prices to drop below the configured threshold before submitting transactions.

---

## 5. AI API Provider Down

**Severity:** HIGH

**Detection:**
- Miners report AI API call failures (timeouts, 5xx errors)
- Mining attempts fail at the "Call AI" step

**Response:**

| Step | Action |
|------|--------|
| 1 | Check AI provider status page (e.g., status.openai.com) |
| 2 | Switch miners to an alternative OpenAI-compatible provider |
| 3 | Update `.env`: change `AI_API_URL` and `AI_API_KEY` to the new provider |
| 4 | Ensure `AI_MODEL` matches the on-chain Era model (same model name required) |

**Model compatibility requirement:**
- All candidate models must support the `/v1/chat/completions` API format
- The model name in the API response must match the on-chain Era model hash
- Era Model Governance allows the community to vote for a new model in the next Era

**Long-term resilience:**
- Encourage miners to have backup API keys from multiple providers
- Era Model Governance provides a democratic path to switch models if a provider becomes permanently unavailable

---

## 6. Deployment Nonce Error

**Severity:** CRITICAL (deployment only — does not affect running systems)

**Detection:**
- `Deploy.s.sol` assertion failures during contract deployment
- Nonce mismatch errors from Foundry

**Response:**

```bash
# NEVER deploy without testing on Sepolia first
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC --broadcast --slow

# The --slow flag ensures sequential transactions (critical for nonce ordering)
```

| Rule | Detail |
|------|--------|
| Always test on Sepolia first | Full deployment dry run before mainnet |
| Use `--slow` flag | Ensures sequential transaction submission |
| Check all 6 assertions | `Deploy.s.sol` contains 6 `assert` checks for contract wiring |
| If failed: STOP | Do NOT proceed — investigate nonce state before retrying |

**Recovery if deployment is partially complete:**
1. Record which contracts were successfully deployed
2. Check on-chain state of each deployed contract
3. Determine if a fresh deployment is needed or if remaining contracts can be deployed separately
4. Never re-deploy to the same addresses — start fresh if nonces are corrupted

---

## 7. Smart Contract Bug

**Severity:** CRITICAL

**Detection:**
- Unexpected contract behavior observed on-chain
- Test failures in the contract test suite
- Community reports of incorrect reward calculations or state transitions

**Response:**

| Step | Action |
|------|--------|
| 1 | Assess severity — is the bug exploitable? |
| 2 | If exploitable: Guardian proposes new minter pointing to a fixed PoAIWMint |
| 3 | 7-day timelock gives community time to verify the fix |
| 4 | Deploy fixed contract and new OracleVerifier if needed |
| 5 | After timelock: `executeMinterChange()` activates the fix |

**Existing safeguards:**
- 4 rounds of adversarial security review completed (0 blocking issues found)
- 68 contract tests covering all critical paths
- 10 end-to-end integration tests
- On-chain constraints (cooldown, epoch caps, token range) limit damage even if a bug exists
- MinterProxy timelock ensures any fix is publicly reviewed before activation

**If the bug is in CLAW_Token:**
- CLAW_Token has no admin functions, no upgradeability, and an immutable minter
- Token bugs cannot be patched — assess if impact is critical enough to warrant a token migration

---

## Monitoring Checklist

### Automated (Set Up Before Launch)

- [ ] **Uptime monitoring** — Uptime Robot or equivalent monitoring Oracle `/health` endpoint (check interval: 1 min)
- [ ] **Chain event monitoring** — Alert on `MinterProposed` events from MinterProxy (detect unauthorized proposals)
- [ ] **Metrics collection** — Oracle `/metrics` endpoint scraped by Prometheus, visualized in Grafana
- [ ] **Log aggregation** — Oracle server logs shipped to centralized logging (e.g., Loki, CloudWatch)

### Daily Checks

- [ ] Oracle attestation success/failure ratio (target: >99% success for valid requests)
- [ ] Oracle server resource utilization (CPU, memory, disk)
- [ ] RPC provider health and latency

### Weekly Checks

- [ ] Gas costs for miners (are miners being priced out?)
- [ ] New miner onboarding rate
- [ ] Oracle signing key rotation readiness

### Per-Epoch Checks

- [ ] Total minted vs. Epoch cap (is the Epoch being fully utilized?)
- [ ] Distribution of rewards across miners (detect concentration)
- [ ] Epoch seed was updated (miners should call `updateSeed()` each Epoch)

### Per-Era Checks

- [ ] Model governance participation (nominations and votes)
- [ ] Era model finalized before next Era starts
- [ ] Halving schedule proceeding as expected
