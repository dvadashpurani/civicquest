# CivicQuest security tests

Each case lists what it checks, how to run it, and the expected result. Later build steps append their own sections.

## How to run

- **Unit tests:** `npm run test` (Vitest, runs once). Covers the header values, the absence of any sign-up code path, login rate-limit rules, and photo path / signed-URL rules.
- **SQL suites:** run each file in `supabase/tests/` against the **dev** project, either by pasting it into the Supabase MCP `execute_sql` tool or with `psql "$DEV_DB_URL" -f supabase/tests/<file>.sql`. Every suite does its work inside a block that always rolls back, so it leaves no rows behind. It finishes silently when every check passes and raises `... test failed: <list of failing checks>` otherwise.
  - `supabase/tests/00_schema.sql`: constraints and the generated `level` column.
  - `supabase/tests/01_foundation.sql`: RLS isolation, `audit_log` immutability, the direct-write guard, completion protection, and `qr_token` secrecy. It impersonates users with `set local role authenticated` plus `set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'`.
- **Manual HTTP checks** use `curl`. In PowerShell, call `curl.exe`, not the `curl` alias. Load the values from `.env.local` into your shell first (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Never paste the service role key into a committed file, script, or issue.
- **Local sign-in** (needed for the rate-limit case) requires a real `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. The login action records attempts in `public.rate_limits` through the admin client.

## Step 1: Foundation

| ID | Checks | Run | Requirements |
|----|--------|-----|--------------|
| S1-01 | Cross-teacher and cross-school isolation | `01_foundation.sql` | 3.10 (3.3–3.8) |
| S1-02 | `audit_log` is immutable | `01_foundation.sql` | 4.1, 4.2 |
| S1-03 | Approved completions cannot be deleted | `01_foundation.sql` | 4.9 |
| S1-04 | Direct writes to `mission_completions` / `checkins` / `audit_log` rejected | `01_foundation.sql` | design "Direct writes rejected" (32.2) |
| S1-05 | `qr_token` stays secret from non-owners | `01_foundation.sql` + REST | 25.4 (design) |
| S1-06 | `private` schema is not exposed by the API | REST | design "No flag wrapper" |
| S1-07 | Security headers on every route | `npm run test` + `curl` | 6.1, 6.2 |
| S1-08 | Public sign-up disabled | `npm run test` + `curl` | 6.3, 6.4 |
| S1-09 | Non-image or oversize upload rejected by `mission-photos` | SQL + `curl` (service role) | 5.1, 5.2, 5.3 |
| S1-10 | Login rate limit | `npm run test` + browser | 35.1, 35.2 |

### S1-01 Cross-teacher and cross-school isolation

- **Checks:** a teacher sees only their own classes, students, rewards, and completions. An admin or counselor sees only their own school. A Leader sees only their own student row and their linked partners' opportunities.
- **Run:** `supabase/tests/01_foundation.sql`.
- **Expected:** selects for another teacher's class or another school return **zero rows** (no error). Suite passes.

### S1-02 `audit_log` immutability

- **Checks:** no role can change or remove a proof-log row.
- **Run:** `supabase/tests/01_foundation.sql`. Manual spot check as `postgres` in the SQL editor, inside `begin; ... rollback;`: `update public.audit_log set action = 'x';` and `delete from public.audit_log;`.
- **Expected:**
  - As `authenticated`: `permission denied for table audit_log` (update/delete privileges are revoked).
  - As `postgres` or `service_role`: `audit_log rows are immutable` (SQLSTATE 42501, from the `audit_log_immutable` trigger). `truncate` raises the same.
  - Target rows unchanged.

### S1-03 Completions cannot be deleted

- **Run:** `supabase/tests/01_foundation.sql`.
- **Expected:** `delete from public.mission_completions ...` fails with `permission denied` as `authenticated`, and with `mission completions cannot be deleted` (42501) as `postgres` / `service_role`. The row remains.

### S1-04 Direct-write guard

- **Checks:** a signed-in teacher or Leader cannot `insert` or `update` `mission_completions` or `checkins` (or insert into `audit_log`) with the REST API. Only the CivicQuest RPCs, which set the `civicquest.via_rpc` flag, can write.
- **Run:** `supabase/tests/01_foundation.sql` (all eight teacher/Leader × insert/update × table statements).
- **Expected:** each statement raises `writes to this table must go through CivicQuest actions` (42501). The guard is statement-level, so it raises even when RLS hides every target row. It also applies to `postgres`; only `service_role` and the via_rpc flag are exempt (`audit_log` inserts also exempt `postgres`). No row changes.

### S1-05 `qr_token` secrecy

- **Checks:** only the owning partner can read an opportunity's QR token.
- **Run:** `supabase/tests/01_foundation.sql`. REST spot check with a signed-in Leader's access token: `GET $NEXT_PUBLIC_SUPABASE_URL/rest/v1/opportunities?select=qr_token`.
- **Expected:**
  - `select qr_token from public.opportunities` as any `authenticated` user fails with SQLSTATE **42501** (column privilege not granted). Over REST this is HTTP 401/403 with code `42501`.
  - `select id, title, ... from public.opportunities` (granted columns) still works within RLS.
  - `public.partner_opportunity_token(<id>)` returns **null** for a Leader, a teacher, or a partner from another org, and the token for the owning partner.

### S1-06 `private` schema not exposed

- **Run:** `curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/rate_limits" -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Accept-Profile: private"` (for an RPC, `POST /rest/v1/rpc/<fn>` with `Content-Profile: private`).
- **Expected:** HTTP 406 with code **`PGRST106`** (schema not in the exposed list). No helper that wraps `set_config` is callable from the client.

### S1-07 Security headers

- **Run:**
  1. `npm run test` (`lib/security/headers.test.ts`).
  2. Production build: `npm run build && npm run start`, then `curl -sI http://localhost:3000/` and `curl -sI http://localhost:3000/login` (PowerShell: `curl.exe -sI http://localhost:3000/`).
- **Expected** on every response (`next.config.ts` applies them to `/(.*)`):

  | Header | Value |
  |--------|-------|
  | `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: data: <supabase-origin>; connect-src 'self' <supabase-origin>; media-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests` |
  | `X-Frame-Options` | `DENY` |
  | `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
  | `X-Content-Type-Options` | `nosniff` |
  | `Referrer-Policy` | `strict-origin-when-cross-origin` |
  | `Permissions-Policy` | `camera=(self), microphone=(), geolocation=()` |

  `<supabase-origin>` is the bare origin of `NEXT_PUBLIC_SUPABASE_URL`. If that value is missing or invalid, no Supabase source appears (fails closed).
- **Notes:**
  - Under `npm run dev` the CSP also contains `'unsafe-eval'` and omits `upgrade-insecure-requests`. Check the production build for the real policy.
  - Known tradeoff: `script-src` allows `'unsafe-inline'`. The App Router streams inline RSC scripts, and per-request nonces are incompatible with the `cacheComponents` static shells. Script files still load only from the app origin. The XSS backstop is React escaping plus the no-`dangerouslySetInnerHTML` rule. See `lib/security/headers.ts`.

### S1-08 Public sign-up disabled

- **Run:**
  1. `npm run test` (`tests/auth/no-signup.test.ts`: no `signup`/`register` route and no `auth.signUp(` call in `app/`, `components/`, or `lib/`).
  2. `curl -s "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/settings" -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"`
  3. `curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/signup" -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{"email":"signup-probe@example.com","password":"Probe-Passw0rd!"}'`
     (PowerShell: `Invoke-RestMethod -Method Post -Uri "$env:NEXT_PUBLIC_SUPABASE_URL/auth/v1/signup" -Headers @{ apikey = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY } -ContentType 'application/json' -Body '{"email":"signup-probe@example.com","password":"Probe-Passw0rd!"}'`)
- **Expected:** the unit test passes. `/auth/v1/settings` returns `"disable_signup": true`. The sign-up POST returns a 4xx error with the message `Signups not allowed for this instance`, and no user `signup-probe@example.com` appears under Authentication → Users. If sign-up succeeds, turn off **Allow new users to sign up** (README, "Supabase setup") and delete the probe user.

### S1-09 `mission-photos` rejects non-image and oversize uploads

- **Checks:** the private bucket accepts only `image/jpeg`, `image/png`, `image/webp` up to 5,242,880 bytes, and stores nothing otherwise.
- **Run:**
  1. Settings check (SQL): `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'mission-photos';`
  2. Client uploads are blocked outright: there is no INSERT policy on `storage.objects`, so an upload with the anon key or a user's token is denied by RLS.
  3. Bucket limits, run from a local shell with the **service role key** (it bypasses RLS but not the bucket limits; never commit it):
     - Create a text file named `not-an-image.jpg`.
     - `curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/mission-photos/<school>/<class>/<completion>.jpg" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: text/plain" --data-binary "@not-an-image.jpg"`
     - Repeat with `Content-Type: application/octet-stream`.
     - Repeat with a real JPEG over 5 MB declared `image/jpeg`.
     - Confirm nothing was stored: `select count(*) from storage.objects where bucket_id = 'mission-photos' and name like '<school>/%';`
- **Expected:**
  1. `public = false`, `file_size_limit = 5242880`, `allowed_mime_types = {image/jpeg,image/png,image/webp}`.
  2. Client upload fails with `new row violates row-level security policy`.
  3. The `text/plain` and `application/octet-stream` uploads are rejected with an invalid mime type error. The oversize upload is rejected with an object-too-large error. The count is 0.
- **Known limitation:** the bucket checks the **declared** content type, not the file's bytes. A non-image renamed `.jpg` and declared `image/jpeg` passes the bucket. Magic-byte verification belongs in the future server-side upload action, which will append its own case here. If a probe upload succeeds, delete it through the Storage API or dashboard.

### S1-10 Login rate limit

- **Checks:** at most 5 sign-in attempts per minute per email and 20 per minute per client IP. Keys are SHA-256 hashes, so `rate_limits` never stores an email or IP.
- **Run:**
  1. `npm run test` (`lib/auth/login-rate-limit.test.ts`).
  2. With `npm run dev` and a real `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, submit a wrong password for one email six times within a minute on `/login`. Then run `select key from public.rate_limits where key like 'login:%';`.
- **Expected:** the unit test passes. The sixth attempt is refused before Supabase Auth is called, with `Too many sign-in attempts. Wait a minute, then try again.` The message never names a field. If the limiter itself is unavailable (for example a placeholder service role key), every attempt fails closed with `Sign-in failed. Wait a minute, then try again.` Keys look like `login:email:<64 hex>` and `login:ip:<64 hex>`, with no plain email or IP.

## Step 4: Core loop

These cover the confirm / edit / undo RPCs (`0006_confirm.sql`, `0007_edit.sql`, `0008_undo.sql`) and the protections behind them (the direct-write guard and the `mission_completions` protection trigger in `0004_triggers.sql`). Most of the server-side behavior is proven automatically by `supabase/tests/04_core_loop.sql`; the plain-text rendering cases are a short manual UI check backed by React escaping.

| ID | Checks | Run | Requirements |
|----|--------|-----|--------------|
| S4-01 | Cross-teacher RPC calls rejected (confirm / edit / undo) | `04_core_loop.sql` | 20.7, 32.2 |
| S4-02 | Direct table writes to `mission_completions` rejected | `04_core_loop.sql` + `01_foundation.sql` | 32.2 |
| S4-03 | `' OR 1=1 --` and `<script>alert(1)</script>` shown as plain text in rosters and mission records | `04_core_loop.sql` + `npm run test` + browser | 33.4, 34.4 |
| S4-04 | Re-confirm after undo works | `04_core_loop.sql` | 20.7 (15.2, 20.8) |

### S4-01 Cross-teacher RPC calls rejected

- **Checks:** a teacher cannot confirm, edit, or undo another teacher's class. The confirm / edit / undo RPCs are `security invoker`, so RLS plus the ownership check reject any caller who is not the class's own teacher (or a school admin, who is allowed). A non-owner teacher, and a wrong-role caller such as a partner, are both rejected.
- **Run:** `supabase/tests/04_core_loop.sql` (the `[non-owner]` and `[wrong-role]` cases). Each impersonates a signed-in user with `set local role authenticated` plus `set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'` and calls the RPC with `perform public.confirm_class_mission(...)`.
- **Expected:** the non-owner teacher's and the partner's calls raise `not permitted`, and the rejection rolls back fully — **zero** stray `mission_completions` rows and **zero** stray `audit_log` rows remain for that mission. A positive control in the same suite confirms the owning teacher (and the school admin) succeed, so a rejection cannot pass just because nothing works. Suite passes.

### S4-02 Direct table writes to `mission_completions` rejected

- **Checks:** only the via_rpc RPCs may write `mission_completions`. A signed-in teacher or Leader cannot `insert` or `update` the table directly through the REST API — the direct-write guard and the `mission_completions` protection trigger (`0004_triggers.sql`) block it. The guard is statement-level, so it raises even when RLS hides every target row, and it applies to `postgres` too; only `service_role` and the `civicquest.via_rpc` flag (set only inside the five core RPCs' preamble) are exempt.
- **Run:**
  1. `supabase/tests/01_foundation.sql` (case **S1-04**, the direct insert/update statements against `mission_completions`).
  2. `supabase/tests/04_core_loop.sql` — the trailing `pg_proc` scan asserts that in the PostgREST-exposed schemas, `set_config` appears only inside the core RPC names and only with the constant `'civicquest.via_rpc'`, so the client has no path to set the flag itself.
- **Expected:** each direct `insert` / `update` raises `writes to this table must go through CivicQuest actions` (SQLSTATE 42501) and no row changes. The `pg_proc` scan returns **zero** rows (no function sets the flag outside the sanctioned RPCs). Both suites pass. See also S1-04.

### S4-03 Injection strings render as plain text

- **Checks:** text containing `' OR 1=1 --` or `<script>alert(1)</script>` is stored and shown as inert plain text in class rosters and saved mission records — no SQL runs and no HTML/script executes. The RPCs and the query builder use named parameters, never concatenated SQL, and every value renders through React (no `dangerouslySetInnerHTML`).
- **Run:**
  1. `npm run test` (`lib/validation/login.test.ts` confirms the injection string survives validation unchanged as inert text; the `dangerouslySetInnerHTML` guard in `scripts/guard-client.mjs` keeps raw HTML rendering out of the app).
  2. `supabase/tests/04_core_loop.sql` exercises the RPCs with parameterized calls (`perform public.confirm_class_mission(...)`), confirming no SQL injection path exists through the core loop.
  3. Manual UI check: create or rename a student whose name is `' OR 1=1 --` and another whose name is `<script>alert(1)</script>`, confirm a mission for them, then view the roster and the saved mission record on `/teacher/class/[id]`.
- **Expected:** the unit test passes. In the browser, both strings appear **verbatim as text** in the roster and in the saved mission record. No row is unexpectedly matched or altered (no SQL execution), no alert dialog appears, and viewing page source shows the string HTML-escaped (`&lt;script&gt;...`), i.e. React escaped it rather than injecting markup.

### S4-04 Re-confirm after undo works

- **Checks:** a mission can be undone and then confirmed again. After `confirm -> undo -> confirm`, the completions end `approved` again with fresh server-set points and a strictly later `confirmed_at`, and a plain re-confirm of an already-approved mission is idempotent (no duplicate rows, points, or `audit_log` entries).
- **Run:** `supabase/tests/04_core_loop.sql` (the `[cycle]` and `[reconfirm]` cases). The suite uses a pre-aged `reversed` row written as `service_role` to prove the re-confirm stamps a strictly later `confirmed_at` across transactions, plus a live `confirm -> undo -> confirm` cycle on a fresh roster.
- **Expected:** after the full cycle the rows are `approved` at 10 points with a `confirmed_at` later than the prior stamp; a second identical confirm changes nothing (same `confirmed_at`, same points, exactly one `confirm` audit entry). Suite passes.
