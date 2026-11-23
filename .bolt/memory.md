# Project memory

## Product intent & audience

- Telegram group bot with multi-account support; core feature is photo pinning via reply `تثبيت`.
- Additional commands identified: `قصف`, `كاتش`, `ماهوراغا`, `تغير جريدة`, `حذف كاتش` (exact behaviors unverified).
- Primary user language: Arabic (all commands in Arabic).
- Deployment target: Railway with a single shared port; multiple bot accounts run concurrently.

## Brand personality & voice

- Developer-facing status updates; concise, factual, no marketing tone.
- User communicates in Arabic; assistant responds in Arabic.

## Visual design & UX direction

- No direct UI; interaction is via chat commands in Telegram groups.
- Admin panel exists (referenced in code) for account management.
- Core interaction: reply to a target photo with `تثبيت` to pin it.
- New UX pattern: mention-based command routing — user @mentions a specific bot account and writes a command after it; only that account executes.

## Decisions, constraints & rationale

- Pins stored in memory only; cleared on disconnect; not restored on restart.
- Rationale: avoid stale pins; pins valid only for current session.
- Multi-account engine (`accounts-engine`) runs all accounts.
- Each account now has fully independent command state — own command instances, no shared handler. No cross-account interference even with 15 accounts in same group.
- Architecture: `accounts-engine.js` wires `contextFactory` and mention routing; `index.js` integrates both into multi-account engine.
- Mention routing implemented: real mention detection via `Mentions` data + account ID (not text/name matching). Mention portion stripped from message text before command extraction; remaining text/args passed to original command system as normal.
- Command dispatch rule:
  - Command without mention → all accounts execute (each with independent state).
  - Command with @mention → only the mentioned account executes; others ignore.
- Tests: 4/4 passing. Core commands (11) load successfully.
- Known env issue: 3 commands (Bankai, السياجين, تثبيت) fail loading `ws3-fca/src/utils` due to incomplete dependency install in sandbox; same happens in original. Not a code bug.
- Project build passes locally; dependency install blocked in sandbox.
- Bot cannot be started from assistant environment; user runs/restarts it. Auto-redeploy on Railway.

## Open questions & assumptions

- Resolved: isolation model = per-account command state isolation + mention-based routing (only mentioned account responds).
- Assumption: pinning is limited to photos (other media types unverified).
- Assumption: only group context supports pinning (not DMs).
- Unknown: exact behavior of `قصف`, `كاتش`, `ماهوراغا`, `تغير جريدة`, `حذف كاتش` commands.
- Unknown: whether multiple concurrent pins per group are allowed.
- Unknown: bot framework/language (code referenced but not directly inspected).
- Unverified: pin behavior after restart (manual testing required by user).
- Unknown: admin panel URL/host-per-account question still open (not part of current mention-routing work).