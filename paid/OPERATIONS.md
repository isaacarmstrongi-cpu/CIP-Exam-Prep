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

## Learning tools and quality audit — October 16, 2026

Focused study sessions are separate from timed simulations. Available filters are weakest domain, missed, flagged, new, due and mixed, with 5/10/20 requested questions. Smaller matching pools return fewer unique questions. The default pool reserves exam5, allowing only already-assessed exam5 items into study. One active session of each kind is allowed, with explicit resume/finish instructions rather than a silent change of exam or focus.

Study answers are locked after checking. Feedback contains only the current checked question; timed answers remain withheld until submission. Completed study results use answered-question accuracy and distinguish unassessed questions. Full-exam scores still use all100questions, and first-attempt history is separate from retakes. Unassessed questions do not become evidence of a learner's knowledge deficit in the progress profile.

question_reviews stores the latest graded result, date, review due date, streak and exposure count. Correct reviews schedule1/3/7/14/30day intervals; incorrect responses schedule a next-day review. This is a simple study schedule, not a validated adaptive engine or pass predictor. Review records are included in authenticated exports and removed with the180day practice-data retirement. Legacy completed attempts are backfilled once and do not overwrite newer assessed answers.

Browser verification used only synthetic local accounts: phone layout, start confirmation before clock activation, saved answers/flags/index and continuing clock after refresh, timed1%for1correct/99unanswered, study100%accuracy for1correct/9unassessed, immediate explanations, locked checked answers, keyboard focus and retry after a simulated save failure. The client prevents silent navigation past an unsaved answer; unconfirmed changes remain only in memory and a page-close warning is shown. Normal answer updates avoid resending all question text. This is not a claim of offline support or formal accessibility certification.

The bank retains500unique stems and all98objective tags, with15/20/20/30/15 questions per domain per form. Revised116correct-option wordings preserve the existing reasoning and keys while reducing the measured answer-length cue. The before/after option-length expectations are in dist/data/content-review.json; the most affected form moved from61.8%to29%. All forms are now29–32%for the longest-option-only heuristic. These figures are editorial diagnostics, not learner scores or psychometric evidence. An independent subject-matter review and real pilot item analysis remain the right next evidence steps before making outcome or difficulty claims.

Benchmark references: [Pocket Prep modes](https://help.pocketprep.com/en/articles/14548723-quiz-modes-explained-how-to-study-with-pocket-prep) for focused short practice; [Boson modes and custom exams](https://help.boson.com/exsim-max/choosing-an-exam) for separating learning from simulation; [UWorld product tour](https://medical.uworld.com/usmle/features/) for progress and review patterns. These are feature benchmarks from different exam markets, not an assertion that they offer CIP coverage or that this product matches their validated outcomes. [AIIM](https://www.aiim.org/education-section/cip) remains authoritative for CIP exam parameters and the April1,2027transition.

This work does not change the deferred tax decision, open enrollment or alter repository visibility. The repository's earlier public question bank/history exposure remains a launch issue pending the owner's explicit make-private approval. Private conversion cannot retrieve old copies. No live student purchase is required for these checks.

## Five-person friends trial

The friends trial is invitation-only and free: five separate accounts, seven days per account from activation, all exams and study tools, no card or automatic purchase. Use the existing isolated `/mcip-sandbox` service/database. It has the same student workflows with a clear trial label. Do not enable the trial on the live payment service or expose a public enrollment link.

`FRIENDS_TRIAL_ENABLED` defaults off. Enabling it requires owner approval of the new access. The runtime refuses trial mode with live Stripe, without verified-account email delivery, or without approved policies. Trial mode always disables checkout and public registration even if their switches are accidentally enabled. Keep `ENROLLMENT_OPEN=false`, `REGISTRATION_OPEN=false`, and `LAUNCH_APPROVED=false` in both environments.

Once approval is received, enable the flag only in the protected sandbox environment. The operator-only `paid/invite-trial.mjs`, run with that environment, creates one five-use invitation valid for seven days. Its output contains a sensitive bearer URL: save it in a root-only file, show it only to the owner and do not put it in logs, Git or public links. If a saved invitation already exists, recover it rather than issuing a duplicate. Anyone holding the link can claim a remaining slot, so share it privately with the five intended testers. Each tester chooses their own password and verifies their own email. Signing in to the same account does not consume another slot or extend expiry. Existing accounts can activate a trial after verification and explicit agreement. No fake purchase is recorded.

The database stores invitation hashes and per-account trial dates/agreed trial terms. Account export includes only the student's own trial agreement and dates. Verified trial records expire 180 days after trial access ends; unverified unpaid accounts retain the 30-day limit. No seven-year financial record is created for a free trial. Normal study/timing/isolation controls apply. Owner can revoke an invite and its associated trial access through the operator-only Store.trials.revoke(inviteId) method; no public administration endpoint exists.

Before sharing: verify the deployed trial entry, invalid-link handling, closed live sales and separate database; retain a screenshot of the invitation screen. Automated checks cover the five-account cap, token hashing, expiry/replay/revocation, account isolation, mandatory email verification, recovery/session invalidation, disabled checkout and trial retention. Local browser preview uses synthetic accounts and mock email, not real student identities or payments. A trial is an evaluation and does not establish validated difficulty or pass outcomes.

## Owner trial activity emails

The owner authorized operational alerts to isaacarmstrong@live.com for each trial account claim and its first exam or study-session start. Set OWNER_ALERTS_TO only in the protected isolated trial environment. No other recipient is accepted. The existing sending-only Resend key is reused; no new credential or marketing service is required. Production sales remain closed.

The worker checks trial activity at startup and every30seconds. It records a durable per-account/per-event outbox, recovers activity recorded during a restart, and does not send additional alerts for resumes, refreshes or retakes. Emails contain a pseudonymous tester number, capacity, activity kind and original event timestamp. They omit learner addresses, answers, credentials and invitation tokens. A recorded first-session start does not imply completion or passing. No learner email is sent for these operational alerts.

Transient delivery failures use bounded exponential retry and a stable provider idempotency key. Resend documents a24-hour key window (https://resend.com/docs/dashboard/emails/idempotency-keys); uncertain deliveries older than23hours or failures after8attempts require operator review rather than a blind resend. Permanent provider rejections also require review. This avoids repeated notifications; it is not a guarantee of inbox placement. Accepted delivery IDs and status remain in the private database. Operational logs contain no recipients or message contents. Check the service journal and owner_alerts statuses if alerts are missing. Do not reset or delete delivery records merely to force a retry without investigating the provider's result.

Alert records appear in the relevant learner's own account export and are removed with study records, even if minimal financial records remain. Privacy notice version2026-10-16-v2 describes the notices. After configuring, send one clearly labeled setup-test email to the approved owner address, with a stable one-time identity and root-only result record. It must state that no tester joined and no invitation slot was consumed. Do not create a trial account just to test delivery or expose the sending key. Verify receipt in the owner mailbox when available, then close temporary work tabs.
