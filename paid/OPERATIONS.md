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
| `POLICIES_APPROVED` | Only `true` after final policy content and operations receive owner approval; otherwise pages are marked as drafts |
| `LAUNCH_APPROVED` | Separate final launch gate; keep `false` while tax and other launch work is deferred |

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

## Student policies and privacy operations

The terms, refunds and privacy pages are served under `/mcip/policies/`. All are marked as owner-review drafts until `POLICIES_APPROVED=true`. The owner approved revision and publication on October 15, 2026 and separately approved publishing the supplied home mailing address. Store that address only in the protected runtime `SELLER_PUBLIC_ADDRESS` setting, never in Git, release archives, screenshots intended for public issue tracking, or operational logs. Published policies require the address and `RETENTION_ENABLED=true` at startup. Tax setup is explicitly deferred; keep `LAUNCH_APPROVED=false` and enrollment closed.

Checkout requires an affirmative checkbox and the current policy version. The server archives the exact policy content and digest, records the learner and agreement time, and binds a separate dated agreement receipt to the checkout. A stale, missing or string-valued acceptance is rejected. Never edit an accepted version in place: revise the content and increment `POLICY_VERSION` together. Agreement records must be included in private database backups.

Signed-in learners can download their own account records and portable HTML purchase confirmations containing the exact archived terms. Downloads exclude credentials and other learners. They remain available until account retirement, including 180 days after paid access expires. A delayed signed payment notification is checked against its original checkout agreement, not a newer published policy version.

Daily maintenance (`paid/maintenance.mjs`) snapshots and verifies the database before applying retention. Unverified unpaid accounts expire at 30 days, verified unpaid accounts at 180 days from creation, and paid practice records at 180 days after the latest entitlement expiry. Retiring a paid account removes its password, sessions, tokens and answers; its email moves to `financial_contacts` solely to support retained financial evidence. The retired address is replaced with a synthetic address so a later verified registration can use the email without gaining old records. Minimal purchase/contact/agreement evidence expires seven calendar years from purchase unless a documented hold applies. Seven years is the owner's business rule, not a universal statutory period. `retention_holds` has an explicit expiry and reason; review holds before they expire.

Analytics contain only pooled year/exam/domain counts, never account IDs, emails or individual answers. Only cohorts of at least ten learners are reportable. Repeated maintenance does not count the same attempts twice. This is internal service analysis, not a validated peer ranking or public pass-rate claim.

Application snapshots normally rotate after 30 days, preserving the newest two checked copies as a recovery minimum. Only matching regular snapshot/manifest pairs are eligible; unrelated files and symlinks are never silently removed. Hostinger's separate restore-point rotation remains provider-managed. Before reopening a restored database, reapply maintenance and any outstanding deletion/hold decisions. Do not use recovery copies for analytics or ordinary support browsing.

## Support and privacy request procedure

The operator must check the published support inbox each business day; this is an operating responsibility, not an automated monitoring claim. Record the received date, request type, verified requester, applicable deadline, actions, restricted retention justification and response date in a private case record. Never put these cases in the public source repository. Use the authenticated account or a proportionate email challenge to verify identity, without routinely demanding government ID. Do not disclose another person's records.

For covered 14-day refund requests, initiate the full refund to the original payment method within 14 days of notification, confirm by email and verify Stripe's signed notification revoked access. No exam-failure evidence is required. Longer mandatory remedies remain available. No actual refunds are performed automatically by this code.

For privacy requests, assess the applicable rights, respond without undue delay and within one month for GDPR/UK GDPR requests, explain any permitted extension in that first month, and preserve any shorter applicable deadline. Provide the account export and archived purchase terms where relevant. Correction, earlier deletion and restriction require an operator review of active access, financial obligations and holds; document the decision and notify relevant providers where needed. A retained financial-contact email is not available to a later account with the same email. Search that restricted record only for a verified financial/privacy request. Maintain a private record of deletion decisions for restoration handling.

## Policy diligence and market benchmark — October 15, 2026

Compared the structure and protections with [Pocket Prep privacy](https://www.pocketprep.com/privacy-policy/), [Pocket Prep terms](https://www.pocketprep.com/terms-of-service/) and [Boson ExSim-Max license](https://exams.boson.com/license). Useful patterns are clear single-user licensing, purpose-limited retention, rights/contact channels and pooled analytics. This product uses a plain 14-day refund promise without a pass guarantee. No competitor language or compliance claims were copied.

The [FTC security guide](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business) supports data minimization and a written retention/disposal policy. [EU distance-selling guidance](https://europa.eu/youreurope/business/selling-in-eu/selling-goods-services/ecommerce-distance-selling/index_en.htm) identifies physical seller contact details, pre-purchase disclosures, withdrawal information and durable contract confirmation. The [EDPB rights guide](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en) supports the request procedure and month-long GDPR response window. [IRS retention guidance](https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records) confirms periods vary; do not describe every financial record as legally requiring seven years.

Reviewed the provider data-processing agreements for [Hostinger](https://www.hostinger.com/legal/dpa), [Stripe](https://stripe.com/legal/dpa) and [Resend](https://resend.com/legal/dpa). They describe incorporated processing/transfer terms. Their existence does not independently establish this seller's worldwide compliance or remove any representative, territory, consumer or tax assessment. Keep account-specific agreements and transfer assessments privately. Publishing these policies is not certification of global legal compliance, and does not open sales.

For private-repository updates, follow `ops/PRIVATE-DEPLOYMENT.md`. The upload workflow uses the owner's existing SSH access and requires no GitHub token on the VPS. Repository visibility changes do not retrieve old public copies.
