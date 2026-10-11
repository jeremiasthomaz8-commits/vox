# Architecture and security

## Runtime and trust boundaries

Node.js 24 serves the frontend and same-origin API. Supabase PostgreSQL provides shared relational storage, foreign keys, checks and asynchronous transactions. SQLite WAL remains an explicit local development option. No browser storage is used for evaluation records, credentials or sessions. Temporary kiosk answers exist only in memory.

The server connects through the Supabase IPv4 session pooler using `pg`, at most five connections per process and TLS certificate/hostname verification. The private `vox` schema is not exposed through the Data API. RLS denies browser roles; a restricted `vox_app` role has policies and table grants only for server operations. This role cannot create objects, modify categories or schema versions, or alter/delete audit rows. Durable application state is isolated from static files. Synchronous scrypt still limits login throughput; capacity testing is required before scaling.

The session joins the current user and current unit on **every request**. Deactivating either takes effect immediately. All administrative paths share an explicit administrator guard before any operation. Every evaluation uses `session.unit_id` and the unit's server-side device ID, ignoring a client unit ID. Unit accounts can only read their own session context and submit new ratings; they cannot list historical records or photos.

## Credentials and sessions

Setup runs explicitly, once, with hidden interactive input or JSON stdin for controlled automation. Accounts are not recreated during server startup. Passwords use scrypt N=32768, r=8, p=1, 64-byte output and independent random salts. Validation rejects oversized input before hashing. No passwords are returned or written to logs.

Login attempts are limited per normalized account (5/15 minutes) and source IP (25/15 minutes); unknown accounts perform a dummy hash verification. Session tokens contain 256 random bits, are hashed at rest, and use HttpOnly/SameSite=Strict cookies. Production adds Secure. Administrator sessions expire after eight hours with a 30-minute idle timeout. Unit sessions expire after 12 hours. Password resets revoke all target sessions; password changes revoke other sessions.

For deployments behind a reverse proxy, the IP limiter currently sees the proxy socket. The account limit remains independent. Configure a single trusted ingress with additional IP rate limiting; do not blindly trust arbitrary forwarded IP headers.

Authenticated mutations require the session's CSRF token. Cross-origin POST/PATCH requests are rejected. Output is escaped, SQL uses bound parameters, requests are size-limited, and static paths use a fixed allowlist. CSP excludes external scripts, framing is forbidden, camera permission is restricted to the same origin when enabled, and API responses are not cached. Inline CSS is allowed for SVG chart values; scripts remain same-origin without inline event handlers.

## Evaluation transaction

1. Authenticate the unit and verify its current active status.
2. Validate exactly six integer ratings between 1 and 5.
3. Within the transaction, lock the unit and key with PostgreSQL advisory locks (SQLite uses its writer mutex). Check a unique idempotency key and the payload digest. Reuse with a different payload or unit is rejected.
4. Commit evaluation, six response rows and audit event in one transaction on the same database connection.
5. Detect operational alerts. A detection failure never discards committed ratings.
6. Confirm success only after commit. The client retains the same key on retry.

Optional photographs require a versioned consent flag and bounded JPEG upload. Invalid or absent consent discards the image while saving all six ratings. Denied permissions, unavailable camera and capture failure are persisted as explicit states. No face recognition is performed.

`photographic_evidence` stores AES-256-GCM ciphertext with a random 96-bit IV, 128-bit tag and evaluation ID as authenticated data. The photo and ratings commit together. A local Windows development key is DPAPI CurrentUser protected; production requires an external secret key and privacy approval. Unit accounts cannot read images. Director reads are authorized per request, audited and served with no-store; list endpoints expose metadata only. There is no public photo directory. Expiry is enforced at startup, every ten minutes and on image/list access; deletion clears ciphertext, marks the photo deleted and preserves ratings. Backups and SQLite remnants require separate lifecycle controls.

## Scoring and history

`categoryScore = (AVG(rating) - 1) * 25`.

All six categories have equal weight. Since only complete six-response evaluations can be submitted, averaging all valid response ratings yields the same overall score as averaging the six category scores. Units with no evaluations have a null score. Sample warnings use a configurable minimum, initially 30.

Filters resolve calendar boundaries in `America/Sao_Paulo` with Intl, rather than the host's local timezone. The database's `sao_day` function groups records in the same timezone. Comparisons use the immediately preceding period with the same number of calendar days. Missing history produces no invented delta. Chart buckets weight category or general scores by their actual evaluation counts.

Improvement priorities rank actual category scores. Dashboard priorities require the configured sample and a score below the attention limit; unit analysis also describes the lowest categories with explicit sample counts and historical availability. No AI inference is used.

## Alerts and audit

Rules inspect the latest 30 days, two seven-day windows, or a ten-minute window. Evidence includes counts, thresholds and intervals. Detection runs after evaluations or technical reports and on the director's manual verification. There is no background scheduler: without new activity, the director can execute verification. A daily/time-bucket fingerprint prevents duplicate detections within that bucket. Repeated daily signals are separate observations and may warrant operational grouping in a later release.

Review status, notes and every resolution event are persisted transactionally. Alerts are investigation prompts; repeated patterns or high scores are not proof of misconduct. Threshold changes do not change the scoring formula or historical ratings.

Audit records reject UPDATE and DELETE through PostgreSQL/SQLite triggers and restricted PostgreSQL grants. This prevents normal application modification, but does not protect against a database owner changing the schema or filesystem. Production requires protected host access and a separate append-only external log sink for stronger tamper evidence.

## Reports and operational limits

CSV and PDF use the same filtered persisted aggregates as the dashboard. Exports include sample context and methodology and exclude passwords, tokens and photos. CSV cells are quoted and formula-prefixed cells are escaped. PDF reports embed the bundled Sora regular font with WinAnsi encoding, measure its glyph widths, paginate and wrap text, with no external renderer needed at runtime.

Database, backups and host-level encryption are operational responsibilities. This local MVP does not claim encrypted SQLite storage, high availability, remote monitoring, automatic offsite backups, legal approval, formal accessibility certification or automated LGPD compliance. Those dependencies are explicit in the deployment runbook.
