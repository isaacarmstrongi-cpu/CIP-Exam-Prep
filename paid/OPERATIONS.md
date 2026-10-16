# Pro CIP Exam Prep operations

The paid portal uses Node.js 24, SQLite, Stripe Checkout, and Resend transactional email. The static `dist/` application is a separate demonstration. Never expose the repository or its complete question bank as the paid portal.

## Protected configuration

Keep configuration in a root-owned file with mode 0600, outside the repository and public document root. Preserve existing Stripe keys when adding settings.

| Setting | Purpose |
| --- | --- |
| `PUBLIC_ORIGIN` | Exact HTTPS origin; no trailing slash |
| `PUBLIC_BASE` | One path segment; defaults to `/mcip` |
| `DATABASE_PATH` | Private SQLite file |
| `PORT` | Loopback listener |
| `STRIPE_LIVE` | `true` for production, `false` for isolated sandbox |
| `STRIPE_SECRET_KEY` | Checkout Sessions Write, Charges/Refunds Read |
| `STRIPE_WEBHOOK_SECRET` | Corresponding environment's signing secret |
| `STRIPE_PRICE_ID` | $45 USD one-time package |
| `RESEND_API_KEY` | Sending-only credential scoped to the verified mail domain |
| `MAIL_FROM` | Sender at the verified domain |
| `TRUST_PROXY` | `loopback` only behind the configured local Apache proxy |
| `ENROLLMENT_OPEN` | Keep `false` until launch requirements are satisfied |
| `REGISTRATION_OPEN` | Set `false` to disable new accounts independently |

The live service requires configured email delivery before enrollment can open. Unverified students cannot buy a package or access exam APIs. Reset links expire after 30 minutes, verification links after 24 hours; both are single-use. Resetting a password invalidates all existing sessions. Links use a URL fragment and are removed from the address bar after loading.

Resend processes the recipient address and verification/recovery message. Marketing is not part of this integration. Do not enable paid email overages without approval. Delivery failures log a fixed message without tokens or recipient addresses; students can request a new link. The operator should monitor delivery failures and the provider's quota.

## Deployment

Deploy a pinned Git commit into a new release directory. Set `umask 022` before creating the code release or installing dependencies, so the DynamicUser service can read public application code. Secrets and database directories remain private. Install locked dependencies with `npm ci --omit=dev --ignore-scripts` and run tests before switching the current symlink. Keep the prior release for rollback. Code rollback does not reverse database migrations; the current migration only adds tables and a verification flag.

Apache must append the real client address to `X-Forwarded-For`. The app trusts only the final valid IP when the immediate peer is loopback and trust is explicitly enabled. Client-supplied earlier addresses are ignored. Request and account limits are stored as hashes in SQLite and survive service restarts.

## Backups and restoration

`paid/backup.mjs` creates an online SQLite snapshot, checksum manifest, integrity check, and an isolated restoration check. Run under a protected operator/service account with `DATABASE_PATH` and `BACKUP_DIRECTORY` configured. The destination must be private and outside the web root. Snapshot names are unique and existing backups are not overwritten or removed. The script logs only table counts.

Snapshots contain student data and password hashes. Protect them like the live database. Local snapshots protect against application mistakes; a separate provider/off-server backup is needed for loss of the VPS. Record and monitor the backup job's exit status and disk usage. Choose retention and deletion rules with the approved privacy policy.

For an actual restore: close enrollment, stop the student service, retain the existing database and WAL/SHM files in a private recovery directory, verify the selected backup's manifest/checksum, restore the snapshot to the configured database path, and match its ownership to the service state directory. Start the service and verify sign-in, purchases, attempts, and webhook replay handling before reopening. Never restore directly over a running SQLite database. Test restoration in isolation first.

## Payment operations

Keep live and sandbox keys, webhook destinations, databases, ports, and base paths separate. Verify the exact price, currency and student checkout binding before granting access. Signed payment completion grants 90 days once; retries do not extend it. Full refunds and disputes revoke access. Process approved refunds in Stripe; a signed notification synchronizes access. No refund API write permission is needed by the portal.

Do not use real cards for integration tests. Use Stripe's documented sandbox cards. Do not submit a live payment just to verify configuration; create, inspect and expire a live Checkout session without paying.

## Launch requirements

- Verify a real account email and real password recovery delivery through the configured sender.
- Verify current HTTPS domain, DNS, cookies, proxy, and payment redirects.
- Confirm monitored backups and an isolated restoration check.
- Review and approve student terms, refund handling, privacy/retention and tax setup before opening sales.
- Resolve public access to the question bank, including its existing Git history. Making a repository private does not retract prior copies.
- Keep the 2023 exam-version notice visible; do not claim coverage for AIIM's revised exam without a content review.
- Confirm the public landing page's enrollment status matches the server.

Account recovery and sending credentials being configured does not establish global tax readiness. Stripe Tax calculates only where an applicable active registration is configured; resolve registrations and the product tax category before global enrollment.
