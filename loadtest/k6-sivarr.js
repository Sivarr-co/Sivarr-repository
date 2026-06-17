// Sivarr load test — #6 of the 1000-concurrent scale/hardening program.
//
// GOAL: validate the infra that hardening added — the Postgres pool (free
// pooler = 15 conn hard ceiling), Redis rate-limiting + shared response cache,
// and horizontal scaling (>=2 instances). It deliberately does NOT hammer the
// Gemini-backed endpoints (chat / quiz-question); those cost money, are
// daily-capped per user, and aren't what we're trying to size here. AI traffic
// is opt-in (INCLUDE_AI=1) and weighted low, and its throttle responses
// (429/503) are counted as expected, not failures.
//
// ─── RUN ────────────────────────────────────────────────────────────────────
//   POINT IT AT STAGING, NEVER PROD. Staging needs a separate DB — this
//   registers a pool of synthetic users and reads/writes their data.
//
//   # smoke (10 VUs, 30s) — prove the script + target work
//   k6 run -e BASE_URL=https://staging.sivarr.app -e PROFILE=smoke loadtest/k6-sivarr.js
//
//   # full ramp to 1000 concurrent
//   k6 run -e BASE_URL=https://staging.sivarr.app -e PROFILE=peak loadtest/k6-sivarr.js
//
//   # include the AI endpoints in the mix (expect 429s once daily caps hit)
//   k6 run -e BASE_URL=... -e PROFILE=peak -e INCLUDE_AI=1 loadtest/k6-sivarr.js
//
// ENV:
//   BASE_URL     (required) target origin, no trailing slash
//   PROFILE      smoke | ramp | peak | soak           (default ramp)
//   USER_POOL    how many synthetic users to provision (default = peak VUs)
//   INCLUDE_AI   "1" to include chat + quiz-question   (default off)
//   RUN_TAG      suffix for synthetic emails so reruns reuse the same accounts
//                (default "a"). Accounts are loadtest+<RUN_TAG>_<i>@sivarr.test
//   PASSWORD     password for synthetic users          (default "LoadTest!234")

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Inlined from k6-utils/randomItem — keeps the script self-contained (no runtime
// fetch of https://jslib.k6.io, which fails on networks that block/can't verify it).
function randomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const BASE = (__ENV.BASE_URL || '').replace(/\/$/, '');
if (!BASE) throw new Error('BASE_URL is required (point at STAGING, not prod).');

const PROFILE     = __ENV.PROFILE || 'ramp';
const INCLUDE_AI  = __ENV.INCLUDE_AI === '1';
const RUN_TAG     = __ENV.RUN_TAG || 'a';
const PASSWORD    = __ENV.PASSWORD || 'LoadTest!234';

// ─── load profiles ────────────────────────────────────────────────────────
const PROFILES = {
  // quick correctness check
  smoke: { stages: [{ duration: '30s', target: 10 }], peak: 10 },
  // default: gentle ramp, good for a first real run
  ramp: {
    stages: [
      { duration: '2m', target: 200 },
      { duration: '3m', target: 600 },
      { duration: '3m', target: 1000 },
      { duration: '2m', target: 1000 },
      { duration: '1m', target: 0 },
    ],
    peak: 1000,
  },
  // straight to 1000 and hold
  peak: {
    stages: [
      { duration: '3m', target: 1000 },
      { duration: '5m', target: 1000 },
      { duration: '1m', target: 0 },
    ],
    peak: 1000,
  },
  // endurance: hold a moderate load to surface leaks / pool exhaustion over time
  soak: {
    stages: [
      { duration: '3m', target: 400 },
      { duration: '30m', target: 400 },
      { duration: '2m', target: 0 },
    ],
    peak: 400,
  },
};

const PLAN      = PROFILES[PROFILE] || PROFILES.ramp;
const USER_POOL = parseInt(__ENV.USER_POOL || String(PLAN.peak), 10);

// ─── custom metrics ─────────────────────────────────────────────────────────
const errors      = new Rate('sivarr_errors');           // real failures (excl. expected throttle)
const aiThrottled = new Counter('sivarr_ai_throttled');  // expected 429/503 on AI under load
const dbReadTime  = new Trend('sivarr_db_read_ms', true);

export const options = {
  stages: PLAN.stages,
  thresholds: {
    // <1% genuine errors and a healthy p95 on DB-bound reads
    sivarr_errors: ['rate<0.01'],
    sivarr_db_read_ms: ['p(95)<800'],
    http_req_duration: ['p(95)<1500'],
  },
};

function url(path) { return `${BASE}${path}`; }
function email(i)  { return `loadtest+${RUN_TAG}_${i}@sivarr.test`; }

// Register (or, if already there from a prior run, log in) one synthetic user.
function provision(i) {
  const body = {
    name: `Load Test ${i}`,
    email: email(i),
    password: PASSWORD,
    confirm_password: PASSWORD,
    phone: '',
    action: 'register',
  };
  let r = http.post(url('/api/login'), JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'setup_register' },
  });
  // Account already exists from a previous run → log in instead.
  if (r.status === 409 || r.status === 400) {
    r = http.post(url('/api/login'), JSON.stringify({
      email: email(i), password: PASSWORD, action: 'login',
    }), { headers: { 'Content-Type': 'application/json' }, tags: { name: 'setup_login' } });
  }
  if (r.status !== 200) return null;
  try {
    const d = r.json();
    if (d && d.token && d.sid) return { sid: d.sid, token: d.token, email: email(i) };
  } catch (_) { /* fall through */ }
  return null;
}

// setup() runs once. Provision a pool of users that the VUs share.
export function setup() {
  const users = [];
  for (let i = 0; i < USER_POOL; i++) {
    const u = provision(i);
    if (u) users.push(u);
  }
  if (users.length === 0) {
    throw new Error('Provisioned 0 users — check BASE_URL / auth is reachable.');
  }
  console.log(`Provisioned ${users.length}/${USER_POOL} synthetic users.`);
  return { users };
}

// One simulated member "tick". Weighted toward DB-bound reads (the thing we're
// sizing); AI is opt-in and rare.
export default function (data) {
  const u = randomItem(data.users);
  const auth = { tags: {} };
  const roll = Math.random();

  if (roll < 0.45) {
    // Most common: open the app → read your progress (pure DB read).
    group('progress', () => {
      const r = http.get(
        url(`/api/progress?sid=${encodeURIComponent(u.sid)}&token=${encodeURIComponent(u.token)}`),
        { tags: { name: 'progress' } },
      );
      dbReadTime.add(r.timings.duration);
      errors.add(!check(r, { 'progress 200': (x) => x.status === 200 }));
    });
  } else if (roll < 0.65) {
    // Health / infra pings (cheap; what monitoring + Railway hit constantly).
    group('health', () => {
      const r = http.get(url('/health'), { tags: { name: 'railway_health' } });
      errors.add(!check(r, { 'health 200': (x) => x.status === 200 }));
    });
  } else if (roll < 0.80) {
    // Honest health (live DB ping) — exercises the pool + reports redis/pool.
    group('api_health', () => {
      const r = http.get(url('/api/health'), { tags: { name: 'api_health' } });
      const ok = check(r, {
        'api_health 200': (x) => x.status === 200,
        'db up': (x) => { try { return x.json('db') === true; } catch { return false; } },
      });
      errors.add(!ok);
    });
  } else if (roll < 0.92) {
    // Re-auth / session restore churn (DB write + token lookup).
    group('relogin', () => {
      const r = http.post(url('/api/login'), JSON.stringify({
        email: u.email, password: PASSWORD, action: 'login',
      }), { headers: { 'Content-Type': 'application/json' }, tags: { name: 'relogin' } });
      errors.add(!check(r, { 'relogin 200': (x) => x.status === 200 }));
    });
  } else if (INCLUDE_AI) {
    // AI path — expensive + daily-capped. 429/503 are EXPECTED under load.
    group('ai', () => {
      const r = http.post(url('/api/chat'), JSON.stringify({
        sid: u.sid, token: u.token, message: 'Give me one quick study tip.', context: '',
      }), { headers: { 'Content-Type': 'application/json' }, tags: { name: 'chat' } });
      if (r.status === 429 || r.status === 503) {
        aiThrottled.add(1);                 // expected throttle, not an error
      } else {
        errors.add(!check(r, { 'chat 200': (x) => x.status === 200 }));
      }
    });
  }

  sleep(Math.random() * 3 + 1); // 1–4s think time between actions
}
