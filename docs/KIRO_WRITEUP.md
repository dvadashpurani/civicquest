# How CivicQuest was built with Kiro

Fill in each section as you build. Judges read this alongside the `.kiro/` folder. Keep it honest and specific.

## Kiro tools used
- Kiro IDE: (what you used it for)
- Kiro CLI: (what you used it for, such as running seeds and tests)
- How they differed:

## Spec-driven development
- How the spec was structured (requirements, design, tasks):
- How it traced back to `docs/build-prompt.md`:
- How it compared to vibe coding:

## Steering
- The six steering files and what each one controls:
- The strategy that made the biggest difference (for example, security and child-privacy rules applied to every task without repeating them):

## Agent hooks
- Which hooks ran, and a specific problem each one caught:

## MCP
- How the Supabase MCP server was used, and what it made easier:

## Property-based testing
- Which rules were tested with fast-check:
- Any bug a property test caught that a unit test would have missed:

## Powers
- Which powers were used, if any, and what they added:

## Other tools
- Other AI tools used for planning or debugging, and how:

## Build log
(Add entries as each step is finished.)

- **Schema migration (`0001_schema.sql`) changes from build-prompt section 3:** (1) `pgcrypto` is created `with schema extensions` and the `opportunities.qr_token` default calls `extensions.gen_random_bytes(16)`, because Supabase keeps pgcrypto in the `extensions` schema and the explicit name removes any dependence on the migration's `search_path`. (2) `students.first_name` checks `char_length between 1 and 50` instead of `<= 50`, because Requirement 2.4 requires at least one character and the original check accepted an empty name. (3) RLS is enabled (deny-all, no policies yet) on every table in 0001, so no table is reachable through the API before 0002 adds policies. Everything else matches section 3 exactly.
- **`0003_opportunities_private.sql` differences from design.md:** (1) the column grants use `location_name`, the column name created in 0001, instead of `location`. (2) `delete` on `opportunities` is also revoked from `anon`/`authenticated`; there was already no delete policy, so behavior is unchanged, but the privilege is gone too. (3) `partner_checkin_students` is a `security definer` function filtered to the caller's partner org, not a view or invoker function, because partners have no access to `students` and an invoker surface would return nothing. It returns `checkin_id` plus exactly `first_name`, `last_initial`, `grade`, so the partner page can match names to the check-in rows it already reads under RLS.
