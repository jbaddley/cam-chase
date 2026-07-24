# 04 – AI Strategy

## What AI does in PhotoChase (paid tiers only)

| Task | When | Purpose |
|------|------|---------|
| Face-present check | At capture / on upload | Enforce the face rule (rule 2) before a photo counts |
| Clue plausibility check | On upload | Early warning to the team ("we can't spot a clue — sure?") and foul support during rating |
| Pairwise judging: location visual match, angle similarity, pose similarity | Round 2 submissions, async | AI score shown **alongside** human votes, never replacing them |
| Fun extras | Post-game | AI-written game recap, category suggestions |

## Provider choices

- **Amazon Rekognition — face detection only** (`DetectFaces`): fractions of a cent per image, already in our AWS account/VPC story, and it's *detection*, not *recognition* — no identity matching, no biometric templates stored (legal posture, see doc 07). Cheaper still: run **on-device face detection first** (Expo/MLKit/Vision framework are free) and only call Rekognition when the device can't decide.
- **Anthropic Claude (vision) — pairwise judging.** Use the smallest capable model tier (Haiku-class) with structured output: input is the original + chase thumbnails (≤1024 px) and the prompt rubric; output is strict JSON `{location_match, angle_score, pose_score, clue_visible, confidence, one_liner}`. One call judges one pair across all axes.
- Keep the judging interface **provider-agnostic** (a `Judge` port in `services/api`): rubric prompts + JSON schema stay ours, so we can switch or mix providers (Bedrock-hosted models keep traffic inside AWS if preferred) on cost or quality without touching game code.

## Cost controls (the 80%-margin rules)

1. **Downscale before judging.** All AI calls use the ≤1024 px thumbnail the resize pipeline already produces. Image tokens dominate vision costs; this alone cuts spend ~4–10x vs. full-resolution.
2. **One call per pair.** All judging axes in a single structured call — never one call per axis.
3. **Async + batch pricing.** Judging runs on an SQS queue after submission; nothing user-blocking. Use batch/discounted endpoints where offered (~50% off) — results are only needed by the rating phase, minutes later.
4. **Cheap models first, escalation never automatic.** Haiku-class handles rubric scoring well; a larger model is only used if eval scores (see doc 05) show quality failures, and then only for the axes that need it.
5. **Hard per-game AI budget cap by tier** (e.g., $0.30/game). The judging worker tracks cumulative spend per game; at the cap it stops and the game degrades gracefully to human-voting-only with a friendly notice. Per-account monthly soft caps bound heavy Tier 3 / lifetime users.
6. **Cache + dedupe.** Judging results are stored per pair; resubmissions or replays never re-judge. Face checks are cached per photo.
7. **Kill switch.** Remote config can disable AI judging globally or per tier instantly; the product is fully playable without it.
8. **Margin telemetry.** Every AI call logs cost attribution (game, plan). A CloudWatch dashboard tracks AI COGS vs. AI-attributed revenue; alarm fires if the ratio approaches the 80%-margin line.

Worked estimate (6 teams × 15 photos = 90 pairs/game): 90 judging calls on a Haiku-class model with two ~1024 px images each ≈ $0.10–0.25 per game at current pricing — inside the $0.30 cap with headroom. Free tier: zero AI cost by definition.

## Quality: judging must feel fair

- Maintain a **golden-set eval**: ~200 curated photo pairs with human consensus scores; every prompt/model change runs the eval (CI job) and reports correlation with human ratings. Ship only if correlation ≥ target.
- AI score is displayed as its own labeled component ("AI judge: 8/10") next to human votes — transparency defuses "the app robbed us" complaints.
- Log disagreements (AI vs. human vote deltas) as eval candidates.

## More paid-tier feature ideas (requested)

| Feature | Value | Cost posture |
|---------|-------|--------------|
| **AI highlight reel** — auto-cut recap video of best comparisons with music | Shareable, sells the app | Batch, post-game, capped |
| **AI game commentary** — funny written recap in the app's voice | Delight, share cards | One small-model call/game |
| **Route heatmaps** — team GPS trails on a map after the game | "Look how far we ran" | Pure client/map rendering, ~free |
| **Clue difficulty rating** — AI rates each original's findability, feeds handicap scoring | Fairness in mixed-skill groups | Piggybacks on judging call |
| **Photo album/book export** — laid-out PDF/print-ready album of the game | Memorabilia; possible print-partner upsell | Batch render |
| **Tournament/league mode** — multi-game seasons, standings, badges | Retention for clubs, offices, schools | Pure backend |
| **Corporate/event mode** — custom branding, big-screen theming, 6+ teams (special SKU) | Team-building market pays real money | High-margin SKU |
| **AR hot/cold hints** — optional Round 2 assist showing bearing "warmth" | Accessibility for casual groups | On-device only |

## Non-goals

- No face recognition/identification, ever (legal + trust).
- No generative alteration of players' photos beyond layout/captioning in recaps.
- No AI features on the free tier (cost floor stays at infrastructure-only).
