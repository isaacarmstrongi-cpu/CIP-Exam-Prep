# MCIP Exam Prep

A responsive, independent CIP practice application with 500 original questions in five 100-question exams (Sets 4–8).

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

Use a current Node.js version supporting ES modules and `node:test`. No dependency installation is required.

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
