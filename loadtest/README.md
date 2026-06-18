# Sivarr load test (#6 — scale/hardening)

Validates the infra the hardening program added: the Postgres pool, Redis
rate-limiting + shared cache, and horizontal scaling. **Point it at staging,
never prod** — it provisions synthetic users and reads/writes their data.

## Prereqs
1. Install k6: <https://grafana.com/docs/k6/latest/set-up/install-k6/>
   (Windows: `winget install k6` or `choco install k6`).
2. A **staging** deploy with its **own database** (don't share prod's).
3. Before running, sanity-check the target is healthy:
   ```
   curl https://staging.sivarr.com/api/health
   ```
   Want `db:true` and — once `REDIS_URL` is set — `redis:true`.

## Run
```bash
# 1. smoke test first (10 VUs, 30s) — proves script + target
k6 run -e BASE_URL=https://staging.sivarr.com -e PROFILE=smoke loadtest/k6-sivarr.js

# 2. full ramp to 1000 concurrent
k6 run -e BASE_URL=https://staging.sivarr.com -e PROFILE=peak loadtest/k6-sivarr.js

# 3. (optional) include the AI endpoints — expect 429s as daily caps hit
k6 run -e BASE_URL=https://staging.sivarr.com -e PROFILE=peak -e INCLUDE_AI=1 loadtest/k6-sivarr.js
```

Profiles: `smoke` (10), `ramp` (→1000 over ~11m, default), `peak` (→1000 fast,
hold 5m), `soak` (400 for 30m, leak hunting). Other env vars are documented at
the top of `k6-sivarr.js`.

## What to watch
- **k6 thresholds**: `sivarr_errors` (genuine failures) must stay `<1%`;
  `sivarr_db_read_ms` p95 `<800ms`. `sivarr_ai_throttled` counts *expected*
  429/503 on AI and is not a failure.
- **`/api/health` during the run**: `db_pool` (free Supabase pooler caps at
  **15** conns — if you see waits/exhaustion, that's the ceiling, not a bug),
  `db_ms` latency, `slow_queries`, `redis:true`.
- **Railway**: per-instance CPU/mem; confirm load spreads once you bump to ≥2
  instances.

## Reusing accounts across runs
Synthetic users are `loadtest+<RUN_TAG>_<i>@sivarr.test`. The same `RUN_TAG`
(default `a`) reuses the same accounts (setup falls back to login on 409), so
reruns don't bloat the DB. Use a fresh `RUN_TAG` for a clean set. To purge
afterward, delete `loadtest+%@sivarr.test` rows in the staging DB.
