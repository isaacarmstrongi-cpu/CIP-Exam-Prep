# Visual direction and image provenance

The owner approved the emerald/ivory/warm-gold direction, realistic professional imagery, a controllable slideshow and brief learning-completion feedback on October 16, 2026. This is a presentation update; it does not change enrollment, price, exam rules, the five-person trial limit or payment access.

## Image

Final asset: `public-site/assets/learning-journey.jpg`, 2172 × 724 pixels, approximately 247 KB. Generated with the built-in image-generation tool. JPEG encoding preserves the full composition; the three scenes are framed with CSS rather than destructive cropping. The original generated PNG is preserved outside the public asset directory. Fictional professionals are labeled as AI-generated illustrations, not testimonials or actual successful students. No scores, certificates, endorsements or pass claims appear in the image.

Generation prompt:

> Use case: photorealistic-natural. Create one wide photographic editorial triptych for an independent Certified Information Professional exam preparation website. Three equal vertical panels with clean straight divisions, no visible borders, each a separate realistic candid scene in cohesive soft natural daylight, emerald green and warm ivory surroundings, subtle golden accents. Left third: Black Ghanaian professional woman in her early thirties studying thoughtfully at a laptop at a bright home desk with handwritten notes, smiling with quiet confidence. Center third: mature Black male professional and white female colleague in their late thirties to forties sharing a genuine celebratory high five beside a laptop, achievement mood, modern office. Right third: South Asian woman professional in her thirties smiling in relief after finishing an online study session, hands lifted gently in celebration, home office. Close medium shots, realistic faces and hands, authentic adult professional clothing, diverse global learners. Each subject entirely within its own third, faces and hands away from vertical division edges. No graduation gowns, no diplomas, no certificates, no visible test scores, no logos, no text, no watermark, no claims. These are illustrative fictional professionals, not testimonials. Wide landscape 3:1 composition suitable for cropping into three individual website images.

## Research applied

- [Pocket Prep study modes](https://help.pocketprep.com/en/articles/14548723-quiz-modes-explained-how-to-study-with-pocket-prep): short sessions, focused practice and visible progress. The new rhythm strip uses existing session-start history; it does not invent completion streaks, peer ranks or readiness predictions.
- [Boson ExSim](https://www.boson.com/practice-exam/exsim-max-practice-exams): separation of learning and simulation. Exam questions retain a quiet workspace with no slideshow or celebratory animation during a timed attempt.
- [Nielsen Norman Group on motion](https://www.nngroup.com/articles/animation-purpose-ux/): short, useful feedback. Completion feedback runs once when an active session becomes submitted; reopening results does not replay it.
- [W3C carousel guidance](https://www.w3.org/WAI/tutorials/carousels/): visible previous/next/play/pause, keyboard operation, manual-change announcements, pauses on pointer/focus, stops when page is hidden. The slideshow starts paused. Reduced-motion users get manual scene changes without animation or automatic rotation.
- [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): readable text/background combinations, text labels alongside state colors, visible keyboard focus. The palette is a design choice, not a claim that a color produces improved exam outcomes.

## Components and update points

Homepage layout and scene descriptions: `index.html` and `app.mjs`. Shared visual palette: homepage `styles.css` and student `paid/portal.css`. Dashboard activity strip: `paid/ui.mjs`, derived from the learner's own existing attempt dates. Completion feedback: `paid/portal.mjs`. No new tracking service, marketing messages or personal-data fields are added. Image and scripts are served locally by the VPS.
