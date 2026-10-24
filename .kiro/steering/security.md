---
inclusion: always
---

# Security rules (mandatory)

This app stores data about children. Treat any violation as a bug. Full details are in `docs/build-prompt.md` section 6.

- **SQL injection:** Use only the Supabase query builder or `.rpc()` with parameters. Never build SQL from strings. Every `security definer` function sets `search_path = ''` and uses fully qualified table names.
- **Auth:** Public sign-ups are off. On the server, check identity with `supabase.auth.getUser()`, not `getSession()`. After login, redirect only to relative paths starting with a single `/`.
- **Authorization:** RLS is on for every table. Every server action also checks role and ownership. Never trust client values for `points_awarded`, `status`, `confirmed_by`, `approved_by`, `hours`, `role`, `school_id`, or `level`. Nobody approves their own work.
- **Proof log:** `audit_log` is append-only. No update or delete policies, plus a trigger that blocks updates and deletes. Approved completions are never deleted. They can only be marked `reversed`, by the class’s teacher within 24 hours or by an admin at any time, and every reversal is logged with a reason.
- **Validation:** Validate every input with zod on the server, reject unknown fields, and set maximum lengths on all text.
- **XSS:** Never use `dangerouslySetInnerHTML` with user data. Allow only `http` and `https` links.
- **CSRF:** Use server actions. Custom route handlers that change data check the `Origin` header.
- **Uploads:** Private bucket, images only, 5 MB maximum, server-generated file names, EXIF stripped in the browser, signed URLs that expire in 10 minutes.
- **QR codes:** Secure random tokens. Check-ins require sign-in, a linked school, the minimum grade, open capacity, and the right time window. Cap a check-in at 8 hours.
- **Quizzes:** Never send correct answers to the browser. Grade on the server.
- **Rate limits:** Login, QR lookups, check-ins, quiz submissions, and uploads.
- **Headers:** CSP, `frame-ancestors 'none'`, HSTS, `nosniff`, strict referrer policy, camera allowed only for the app.
- **CSV export:** Prefix cells starting with `=`, `+`, `-`, `@`, tab, or carriage return with a single quote.
- **Errors:** Friendly messages for users, details only in server logs. Never log secrets or student names.
- **Demo mode:** Demo logins and “Reset demo data” exist only when `DEMO_MODE=true`, checked on the server.
- **Secrets:** Never commit `.env.local`. The service role key never reaches client code. Never put access tokens in committed Kiro MCP settings; reference environment variables instead.
