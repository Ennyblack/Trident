# 🚀 Testnet Cutover Runbook

This runbook defines the **standard operating procedure for transitioning Trident from staging to public Stellar Testnet**. It prescribes explicit preconditions, sequentially ordered cutover steps with named roles, verification gates, rollback triggers, and escalation paging rules.

---

## 1. Roles & Communication Channels

| Role | Responsibility | Primary Contact |
|---|---|---|
| **Cutover Lead** | Coordinates timeline, authorizes step progression, calls Go/No-Go | `#launch-war-room` on Slack / Discord |
| **Infra / Ops Engineer** | Executes database migrations, container deployments, and DNS routing | PagerDuty: `infra-oncall` |
| **Backend / Indexer Engineer** | Monitors ingestion cursor, RPC polling lag, Redis Streams fan-out | PagerDuty: `backend-oncall` |
| **QA / Verification Lead** | Executes live query smoke tests, WebSocket validations, and SDK checks | `#launch-war-room` |

---

## 2. Preconditions (Go / No-Go Launch Gate)

Before initiating cutover, the **Cutover Lead** must verify that all gates are green:

- [ ] **CI & Test Suites**: `cargo test --all`, `go test ./...`, and `npm test` are 100% green on the release commit.
- [ ] **Database Migration Plan**: All new schema migrations in `database/migrations/` have been tested against staging clones.
- [ ] **RPC Endpoint Quota**: Primary and fallback Soroban RPC endpoints (`STELLAR_RPC_URL`, `STELLAR_RPC_URLS`) verified responsive with valid credentials and rate-limit budgets.
- [ ] **Observability**: Prometheus metrics (`/metrics`), Grafana dashboard, and Alertmanager routing configured per [`docs/runbooks/alerts.md`](./alerts.md).
- [ ] **No Open P0/P1 Incidents**: No active blocker bugs impacting ingestion, storage, or auth.
- [ ] **Rollback Rehearsal**: Rollback procedures in [`docs/ROLLBACK_RUNBOOK.md`](../ROLLBACK_RUNBOOK.md) verified within the last 30 days.

---

## 3. Ordered Cutover Execution Steps

```
[Step 1: DB & Redis Setup] ──► [Step 2: Schema Migrations] ──► [Step 3: Indexer Startup] ──► [Step 4: API Deployment] ──► [Step 5: Public Ingress]
```

### Step 1: Infrastructure Provisioning & Health Check
* **Owner**: Infra Engineer
* **Action**:
  1. Provision PostgreSQL 15+ cluster and Redis 7+ cluster in the target region.
  2. Verify PgBouncer connection pooling service is listening on port `6432`.
* **Verification**:
  ```bash
  pg_isready -h "$PGBOUNCER_HOST" -p 6432 -U trident -d trident
  redis-cli -u "$REDIS_URL" ping
  # Expected: PONG
  ```

### Step 2: Database Schema Migration
* **Owner**: Infra Engineer
* **Action**: Run forward migrations against the testnet database instance:
  ```bash
  sqlx migrate run --database-url "$DATABASE_URL" --source database/migrations
  ```
* **Verification**:
  ```sql
  SELECT version, description, installed_on FROM _sqlx_migrations ORDER BY version DESC LIMIT 5;
  ```

### Step 3: Start Rust Indexer Core
* **Owner**: Backend Engineer
* **Action**: Deploy the `trident-indexer` container with Testnet configuration:
  ```bash
  NETWORK=testnet
  STELLAR_RPC_URL=https://soroban-testnet.stellar.org
  ```
* **Verification**:
  ```bash
  curl -s "http://$INDEXER_INTERNAL_HOST:9090/metrics" | grep trident_indexer_last_ledger_sequence
  # Verify ledger sequence is advancing continuously without panic/restart loops.
  ```

### Step 4: Deploy gRPC & Go REST API Services
* **Owner**: Backend Engineer
* **Action**: Deploy `trident-api` (gRPC) and Go REST API replicas with healthy database and redis connections.
* **Verification**:
  ```bash
  curl -sf "http://$API_HOST:3000/v1/health" | jq .
  # Expected: {"status": "ok", "database": "ok", "redis": "ok"}
  ```

### Step 5: Public DNS Ingress & Routing Cutover
* **Owner**: Infra Engineer
* **Action**: Point public gateway / Cloudflare DNS (`api.testnet.trident.telocel.com`) to the newly deployed API edge.
* **Verification**:
  ```bash
  curl -s "https://api.testnet.trident.telocel.com/v1/status" | jq .
  curl -s "https://api.testnet.trident.telocel.com/v1/events?network=testnet&limit=5" | jq .
  ```

---

## 4. Post-Cutover Verification & Smoke Tests

The **QA Lead** executes the 5-minute smoke validation checklist:

1. **REST Event Filtering**:
   ```bash
   curl -sf "https://api.testnet.trident.telocel.com/v1/events?network=testnet&limit=10"
   ```
2. **WebSocket Real-time Subscription**:
   ```bash
   wscat -c "wss://api.testnet.trident.telocel.com/v1/events/stream?network=testnet"
   ```
3. **API Key Generation & Rotation**:
   ```bash
   curl -X POST "https://api.testnet.trident.telocel.com/v1/api-keys" -H "X-Admin-Key: $ADMIN_KEY" -d '{"label":"smoke-test","network":"testnet","rate_limit_tier":"standard"}'
   ```
4. **SDK Compatibility Check**: Run `npm test` in `examples/testnet-monitor`.

---

## 5. Rollback Trigger & Escalation Protocol

### 5.1 Rollback Triggers (No-Go Signal)
Immediately initiate rollback if any of the following occur within **15 minutes** of cutover:
- `trident_indexer_stalled` alert fires (ledger lag > 50 ledgers and widening).
- API 5xx error rate exceeds **1%** for more than 3 consecutive minutes.
- Unhandled schema corruption or data desynchronization detected.

### 5.2 Rollback Execution
Follow the emergency rollback procedure documented in [`docs/ROLLBACK_RUNBOOK.md`](../ROLLBACK_RUNBOOK.md):
```bash
# 1. Revert DNS ingress to fallback or maintenance page
# 2. Roll back container release via Helm / Fly.io:
helm rollback trident <PREVIOUS_REVISION> -n trident-testnet
# 3. Drain and verify indexer cursor state
```

### 5.3 Escalation & Paging
- **Primary On-Call**: Page through PagerDuty schedule `trident-testnet-oncall`.
- **Incident Channel**: `#incident-sev-1` on Slack / Discord.
- Cross-reference alert descriptions and recovery runs in [`docs/runbooks/alerts.md`](./alerts.md).
