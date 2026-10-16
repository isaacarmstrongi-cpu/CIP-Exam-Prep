# Personal learning tools

Implemented October 16, 2026. Scope: personal study plan, optional confidence labels and concept flashcards. These are descriptive learning aids, not a validated readiness score or pass guarantee.

## Study plan

The learner chooses a date up to 365 days ahead, daily minutes and study weekdays. The time zone is captured from the browser when creating the plan and preserved when editing it. Upcoming tasks rotate reading, objective-filtered practice and domain flashcards across assessed domain priorities. Fourteen upcoming scheduled tasks are shown, bounded by the exam date and account access. This is a focused rotation, not guaranteed coverage of all lessons in a short timeframe. Full mocks still require an uninterrupted 120-minute slot.

Task completion is explicit and cannot be claimed for future dates. It does not contribute to assessed mastery. Same-preference saves preserve checkmarks; a changed routine resets them. The service does not send reminders or add calendar events. An exam date beyond access produces an explicit warning and never extends entitlement.

## Confidence

The optional labels are confident, unsure and guessing. They can be changed during an active timed exam, or before checking an untimed answer. They lock when the answer is graded. Confidence does not change the official scoring logic or reveal an answer. Results identify confident mistakes and correct guesses, with original note links. Progress uses the latest assessed answer per unique question; unlabeled and unassessed work is distinguished. No peer ranking or calibrated probability is claimed.

## Flashcards

60 concept and decision cards reuse original teaching content from all 30 lessons. Each shows a recall prompt before the reasoning. No spoken or written recall answer is collected. After revealing, the learner self-rates Again, Hard, Good or Easy. Again schedules ten minutes; Hard schedules one day; Good and Easy increase simple review intervals. New cards and due reviews form the default queue; an all-cards view permits extra practice.

Revealing alone does not count as reviewing. A rating requires a valid, account-bound reveal operation, and its retry cannot double-increment or extend the schedule. Expired reveal state is rejected. These simple intervals are not a claim of empirically validated learning effectiveness. Flashcards do not use or expose the reserved fifth mock's question content.

## Data, access and operations

- APIs require signed-in, verified accounts where verification is enabled, and active entitlement. Reading/planning/card tools are blocked during active timed simulations; the original deadline and expiry remain authoritative.
- Study plans and card schedules are stored in SQLite; confidence labels are part of the existing attempt record. No new external provider, tracking script or learner email is added.
- Account export includes preferences, checkmarks, confidence and review schedules, without reveal-operation tokens.
- The privacy notice revision is 2026-10-16-v4. All new identifiable learning records follow study-data retirement, including holds, not seven-year financial retention.
- Database snapshots now verify restored counts of plans and flashcard schedules, while retaining support for older backups without those tables.
- Existing Google/email access, five-person trial limit, policies and closed paid enrollment remain in place.

Tests cover calendar/time-zone boundaries, consistent task rotation across days, persistence, invalid inputs, future completion, confidence lock/scoring, review scheduling and retry safety, account isolation, entitlement/timed gates, export, retention and restore. Browser QA uses a synthetic in-memory account with no payment or email service.
