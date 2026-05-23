# FuelDesk v2 — Postman / Bruno collection

Two files:

- `fueldesk_v2.postman_collection.json` — every endpoint the app uses,
  grouped: Auth, Permissions, Platform Owner, Fuel & Pricing, Salary
  Advances, Tenant Analytics, Direct Tables.
- `fueldesk_v2.postman_environment.json` — env variable template.

Bruno, Insomnia, and Hoppscotch all read the v2.1 Postman format.

## Setup

1. Open Postman → **Import** → drop both files in.
2. Switch to the **FuelDesk v2 — local** environment.
3. Fill in the values that say `REPLACE_WITH_…`:
   - `supabase_url` — Supabase Settings → API → Project URL
   - `anon_key` — Supabase Settings → API → `anon` `public` key
   - `login_email` / `login_password` — a real PLATFORM_OWNER user (the
     anon key alone is not authorised to call most endpoints; the bearer
     token is acquired via the **Sign in (email)** request)
4. Run **Auth → Sign in (email)**. Its test script captures
   `access_token`, `refresh_token`, and `user_id` automatically.
5. Look up a pump UUID once (e.g. by running
   **Direct Tables → users (same pump)** with `pump_id=`
   replaced by `*` in PostgREST, or just copy from the platform UI)
   and paste it into the env's `pump_id`.

## Run order for a smoke test

1. Auth → Sign in (email)                 *captures token*
2. Permissions → has_permission           *expect `true` for owner perms*
3. Platform Owner → platform_global_stats *expect non-zero counts*
4. Platform Owner → v_pump_health         *expect a row per pump*
5. Tenant Analytics → tenant_analytics_daily *expect one row per day*
6. Tenant Analytics → tenant_credit_aging *expect 0–4 rows*

Any 401 → `access_token` expired; re-run **Sign in** (or **Refresh
session** if you've got a refresh token).

Any 403 / `42501` → caller's role doesn't grant the permission. RPCs
verify caller in SQL on top of RLS, so this is the intended behaviour
for non-platform-owner users hitting platform-only endpoints, etc.

## Notes on PostgREST quirks

- **Function RPCs** are POST `/rest/v1/rpc/<fn>` with the parameter
  names from the SQL signature (`p_pump_id`, `p_from_date`, etc.).
- **PostgREST returns single-column functions as a JSON value, not a
  one-row result-set.** `get_email_by_phone` returns a string; the
  client doesn't need to index `[0]`.
- **Functions returning TABLE(...)** come back as an array of objects.
  `tenant_analytics_daily` and `tenant_top_employees` work that way.
- **Direct table reads** with `select=*` need the `apikey` header even
  when authed; PostgREST splits anon role from JWT user.

## Files in `database/`

| File | Run order |
|---|---|
| `fresh_setup.sql` | 1 — once, on a fresh Supabase project |
| `step1_rbac_and_business.sql` | 2 |
| `step3_platform_owner.sql` | 3 |
| `step5_sales_analytics_and_advance_flow.sql` | 4 |
| `step6_analytics_reports.sql` | 5 |
| `smoke_test.sql` | any time — read-only checks |

`smoke_test.sql` returns one row per artifact with `✅ pass` /
`❌ fail`. Sort by status to surface anything missing.

## Troubleshooting

- Logged in but `/users?id=eq.<my-uuid>` returns `[]` → your auth
  user has no `public.users` row yet. Insert one (see
  `fresh_setup.sql` section 6 for the seed pattern).
- `permission denied for function …` → forgot to run the matching
  `GRANT EXECUTE` step. The smoke test catches this; re-run the
  relevant migration.
- `cross-pump report blocked` (`42501`) → you're calling a tenant RPC
  with a `p_pump_id` that doesn't match the JWT's pump. Switch users
  or pick the right pump.
