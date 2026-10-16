# Pro CIP Exam Prep

A responsive, independent CIP practice application with 500 original questions in five 100-question exams (Sets 4–8). The paid student portal and the original static demonstration are separate applications.

## Paid student portal

The `paid/` service runs on the existing Hostinger VPS with Node.js 24, SQLite, Stripe card checkout and Resend account emails. The package is $45 USD once for 90 days from confirmed payment, with unlimited practice retakes. Public enrollment remains closed until the launch requirements in `paid/OPERATIONS.md` are resolved.

The portal stores accounts and attempts on the server, verifies email ownership, supports single-use password recovery, and invalidates sessions after a password reset. Its server controls exam deadlines and grading and withholds timed-exam answer keys until submission. Untimed study reveals only checked answers during the session. Signed payment events grant access once; full refunds and disputes revoke it. Request limits survive service restarts. A backup tool creates checked snapshots and verifies restoration in isolation.

The owner approved revised student terms, refunds and privacy publication on October 15, 2026. Checkout requires the current policy agreement and preserves the exact document plus a dated purchase receipt. Learners can download their account records and archived purchase terms. Daily retention supports shorter study-data storage and seven-year minimal financial evidence. Policy publication and final launch approval are separate server gates; final launch remains off while launch requirements are unresolved. Private repository updates can use the credential-free-on-server upload workflow in `ops/PRIVATE-DEPLOYMENT.md`.

Run `npm ci`, then configure the protected settings documented in `paid/OPERATIONS.md` before starting `node paid/server.mjs`. Never put credentials in Git or serve the repository root or `dist/` as the paid portal. The repository has previously been public, including question-bank history; private hosting alone cannot retract prior copies.

`npm test` covers both applications. Deployment checks have also included a real Stripe sandbox purchase and server-side backup restoration. Those results do not establish tax readiness, legal-policy approval, real email delivery or permission to open enrollment.

## Learning tools added October 16, 2026

The paid dashboard provides focused 5/10/20-question sessions, weakest-domain/missed/flagged/new/due filters, immediate checked-answer explanations, a persistent review schedule, and full-exam first-attempt versus retake history. Exam 5 stays out of the default study pool except for questions already assessed from it. These are study tools, not validated pass predictions. Study accuracy excludes unassessed questions; timed scoring continues to count unanswered questions as zero.

The editorial review tightened 116 correct-option wordings without changing stems, answer indexes, rationales, sources, or the 500-item blueprint distribution. `dist/data/content-review.json` records the option-length audit. Difficulty labels remain editorial until empirical calibration and subject-matter review.

## Original static demonstration

The following browser-storage and static-hosting instructions describe the original demonstration only.

## Student experience

- Two-hour timed exams; absolute deadlines continue when the page is refreshed or closed.
- Saved answers, flags, previous/next controls, and a 100-question map.
- Manual submission with an unanswered-question warning, plus automatic submission at expiry.
- Overall score, domain scores, correct/wrong/unanswered review, explanations, and source locators.
- Study priorities ranked by points missed, with objective-level topics and references to the separate CIP Study Guide 2023 domain PDFs.
- Up to 50 attempts saved on the same browser/device, a study library, and printable results using the current answer-review filter.

## Exam alignment

Each set follows the AIIM CIP 2023 blueprint: Domains 1–5 contain 15, 20, 20, 30, and 15 questions respectively. Each set has 30 medium, 50 difficult, and 20 very difficult items and 25 correct choices in each letter position. Difficulty labels are editorial judgments, not psychometric calibration.

Exam details were checked on October 15, 2026. AIIM publishes a 60% passing threshold and has announced a revised exam becoming standard in April 2027. Reassess the content before using it for that version.

- [Official CIP information and preparation resources](https://www.aiim.org/education-section/cip)
- [2023 exam blueprint](https://332414.fs1.hubspotusercontent-na1.net/hubfs/332414/CIP/CIP%20v2023%20Exam%20Blueprint-FINAL.pdf)

The 80% overall / 75% per-domain practice targets are study goals, not official cut scores or validated predictions. Domain priority is based on points missed in the selected attempt, with lower accuracy breaking ties. It is not a percentile or a leaderboard comparing students. Correct guesses and repeated forms deserve additional caution.

## Run locally

Use Node.js 24 and install locked dependencies with `npm ci` so the combined automated checks can run.

```sh
npm run dev
```

Open the printed local address. To verify the bank and scoring/timer logic:

```sh
npm run check
```

## Update the application

| File | Purpose |
| --- | --- |
| `dist/data/questions.json` | Editable bank: stable ID, set, number, domain, objective, topic, difficulty, four choices, zero-based correctIndex, rationale, and source PDF pages |
| `dist/core.mjs` | Timing, scoring, domain weighting, persistence validation, bank version |
| `dist/app.mjs` | Screens, exam interactions, local persistence, review and recommendations |
| `dist/styles.css` | Responsive visual design and printable report layout |
| `test/exam.test.mjs` | Meaningful bank, scoring, timer, and saved-attempt tests |
| `.openai/hosting.json` | Sites deployment identity and static output directory |

When changing question wording, choices, or keys, review the rationale and source locator together, preserve domain weighting, then run the checks. Increase `BANK_VERSION` when answers or IDs change so old saved attempts cannot be silently graded against a different bank. Back up any important results first. Original Set 4–8 numbering matches the printable exams.

PDF page references refer to the separately supplied domain PDFs, not the page numbers of a combined book. A source domain can differ from the question domain. Licensed study guides are **not included in this repository**; students should obtain official materials through AIIM or their authorized training access.

## Hosting and GitHub

The source repository is `isaacarmstrongi-cpu/CIP-Exam-Prep`. The app is a buildless static site: deploy the contents of `dist/` to a static host. Relative asset URLs also support a repository subpath. No secrets, database, or API keys are needed.

A private Sites deployment is configured in `.openai/hosting.json`. GitHub pushes do not automatically deploy to Sites; publish the updated source through the Sites workflow after checks pass. Public student access requires an appropriate public hosting deployment or an explicit access change to the private Site.

## Privacy and practical limits

- There are no student accounts, server-side result records, cross-device synchronization, instructor dashboards, or collection of names or email addresses.
- Attempts are stored in browser local storage. Clearing browser data removes them. Anyone using the same browser profile can see saved results. The app reports when saving is unavailable.
- This is a learning simulator, not a secure/proctored testing platform. The question bank and keys are shipped to the browser, and the timer uses the device clock. Do not use scores for high-stakes assessment or identity-verified rankings.
- Google Fonts supplies optional typography; system fonts provide a fallback. Official AIIM/NIST links open external resources.
- Independent material, not affiliated with or endorsed by AIIM. No first-attempt pass guarantee.

## Verification performed

Automated tests check 500 unique items, five weighted forms, all correct-letter positions, source locators, perfect/incorrect/partial scoring, deadline behavior, invalid saved data, and manual submission. Browser checks cover starting an exam, selecting an answer, flagging, navigation, refresh/resume, scoring, answer filtering, and desktop/mobile layout.
