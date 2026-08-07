# i18n gap audit

A point-in-time sweep of user-facing strings that bypass the message catalogue
(`packages/i18n`). Companion to [06-i18n-markets.md](06-i18n-markets.md); the
catalogue and the `t()` / `translate()` contract are described there.

- **Taken against:** worktree at `755d4a7` (`main` at `bacd471`, 2026-08-07).
- **Scope:** `apps/web/app/**` and `apps/mobile/src/**`. Excludes tests, specs,
  `dev/*`, and `packages/i18n` itself.
- **Line numbers drift.** Treat `path:line` as a starting point, not a permalink.

## How to read a gap

A gap is a human-readable string rendered to a user without going through
`t(key, params?)` / `translate(...)`. Two recurring anti-patterns:

1. **Hardcoded display text** — a literal in `<Text>`, `<h1>`, a `placeholder`,
   an `Alert.alert()`, an `accessibilityLabel`, or a button label.
2. **Inline conditional display text** — building a string in the component,
   e.g. `player{n === 1 ? '' : 's'}` or `flag ? 'AI judging' : 'no AI'`. English's
   plural rule is not every language's, and a ternary can't be translated. The
   catalogue's `count` + `<key>_one` mechanism exists for exactly this (see the
   doc comment in `packages/i18n/src/index.ts`).

Each gap is tagged **[reuse]** if a key already exists and is translated in all
six locales, or **[new key]** if a catalogue entry (and its ES/FR/DE/PT/JA
translations) must be added.

## Summary

- **~48 distinct gaps across 11 files.**
- **Root cause:** six files import no i18n layer at all — `HuntScreen`,
  `RatingScreen`, `FinalsScreen`, `CaptureScreen`, `native/CameraStage`
  (mobile) and `apps/web/app/page.tsx` (web).
- **~8 gaps are [reuse]** (safe to close with no new translations); **~40 are
  [new key]** (need real translations in five non-English locales).
- Anti-pattern #2 recurs at `apps/web/app/page.tsx:17` and
  `apps/mobile/src/native/CameraStage.tsx:136`.
- Several `{a} / {b} X` count concatenations (Capture, Hunt, Rating, Finals)
  should become `count`-param keys rather than string-built sentences.

Everything not listed below routes text correctly: `watch/[code]`, `j/[code]`,
`TagScreen`, `JoinScreen`, `HostScreen`, `ChaseScreen`, `GuessScreen`,
`SignInScreen`, `LeagueScreen`, `ProfileScreen`, `HomeScreen`, `DailyHuntScreen`,
`ColorShootScreen`, `ReferralScreen`, `ReturnScreen`, `GameBar`,
`CompleteProfileScreen`, `ui.tsx`.

## Web

### apps/web/app/page.tsx — marketing landing, zero i18n
- `:7` `<h1>PhotoChase</h1>` — [reuse] `app.title`
- `:8` tagline "Race out, snap the clue, strike the pose…" — [new key]
- `:10` `<h2>Plans</h2>` — [new key]
- `:16` `up to {limits.maxTeams} teams` (concat) — [reuse] `plan.maxTeams` (`Up to {count} teams`)
- `:17` `limits.allowAiJudging ? 'AI judging' : 'no AI'` — [new key] (anti-pattern #2)
- `:18` `'unlimited games'` / `` `${limits.gamesGranted} games` `` (concat) — [new key]
- `:25` `<a>Open the big-screen viewer →</a>` — [new key] (cf `watch.open`)

### apps/web/app/watch/page.tsx
- `:28` `placeholder="ABC123"` — borderline; optional [new key]

### apps/web/app/layout.tsx
- `:4` metadata `title: 'PhotoChase'` — minor; [reuse] `app.title`

## Mobile

### CaptureScreen.tsx — no i18n
- `:62` `'Could not save that photo. Try again.'` — [new key]
- `:73` button ladder `'All photos taken'` / `'Saving…'` (reuse `chase.saving`) / `'Take photo'` (cf `chase.take`) — mixed
- `:77` `<Title>Round 1</Title>` — [new key]
- `:79` `{taken} / {quota} photos` (concat) — [new key] with params

### HuntScreen.tsx — no i18n
- `:42` `'Could not load the hunt list.'` — [new key]
- `:74` `'Could not save that photo. Try again.'` — [new key]
- `:83` `title="Hunt"` + `'Loading the hunt list…'` — [new key]
- `:91` `<Title>Scavenger hunt</Title>` — [reuse] `mode.scavengerHunt`
- `:93` `{found} / {hunt.items.length} found` (concat) — [new key] with params
- `:95` "Someone from your team has to be in the shot…" — [new key]
- `:96` "A wildcard item drops mid-round…" — [new key]
- `:107-114` status ladder `'Found'` / `'Saving…'` (reuse `chase.saving`) / `'Wildcard — double points'` / `'Rare'` / `'Common'` — mixed

### RatingScreen.tsx — no i18n (heaviest concentration, ~18)
- `:13-15` axis labels `'Pose match'` / `'Angle match'` / `'Does it count?'` — [new key]
- `:21-22` foul labels `'No location clue'` / `'No face'` — [new key]
- `:27-28` hunt-foul labels `"Item isn't there"` / `'No face'` — [new key]
- `:62` `'Unavailable'` — [new key]
- `:89` `label="Claimed photo"` — [new key]
- `:92` `label="Original"` — [reuse] `chase.original`
- `:93` `label="Recreation"` — [new key]
- `:119` `'Could not load photos to rate.'` — [new key]
- `:144` `'Could not save that rating.'` — [new key]
- `:165` `'Could not update that foul.'` — [new key]
- `:174,:182` `<Title>Rating</Title>` — [new key]
- `:175` `'Loading photos to rate…'` — [new key]
- `:184` `{done} / {total} rated` (concat) — [new key] with params
- `:189` `Claimed: {current.itemLabel}` (concat) — [new key] with param
- `:200` `'Call a foul'` / `'Call a foul on the original'` — [new key]
- `:214` `'All rated — waiting for the host.'` — [new key]

### FinalsScreen.tsx — no i18n
- `:23` `'Could not load the finals ballot.'` — [new key]
- `:38` `'Could not save that vote.'` — [new key]
- `:46` `title="Finals"` + `'Loading the ballot…'` — [new key]
- `:54` `<Title>Finals</Title>` — [new key]
- `:56` `{voted} / {finals.categories.length} categories voted` (concat) — [new key] with params
- `:70` `` `${team.name} (yours)` `` — literal ` (yours)` suffix (concat) — [new key] with param

### ResultsScreen.tsx — partial (consent uses `t`, breakdown hardcoded)
- `:21-27` `BREAKDOWN` labels `'Location'` / `'Pose'` / `'Angle'` / `'Return bonus'` / `'Best match'` / `'Special'` / `'Fouls'` — [new key]
- `:32-34` `MODE_LABELS`: `'Items found'` [new key]; `'Guessed right'` [reuse] `score.guessedRight`; `'Bluff bonus'` [reuse] `score.bluffBonus`; `'Catches'` [reuse] `score.catches`; `'Survival'` [reuse] `score.survival`
- `:60` `'Could not load the results.'` — [new key]
- `:86` `title="Results"` + `'Tallying scores…'` — [new key]
- `:94` `<Title>Results</Title>` — [new key]
- `:123` `🏆 {nameOf(winner.teamId)} takes it` (concat) — [reuse-ish] `results.winner` (`{team} wins!`) or [new key]

> Note: `BREAKDOWN` and `MODE_LABELS` are **module-level constant arrays**, so
> they can't call the `t()` hook inline — they need restructuring to resolve
> labels at render time inside the component.

### PlanScreen.tsx — partial
- `:18-23` `FEATURE_LABEL` values `'AI judging'` / `'Geofencing & return bonuses'` / `'Special categories'` / `'Random game type'` / `'Weighted judge votes'` / `'Up to 6 teams'` — [new key] (also a module-level constant)

### LobbyScreen.tsx — partial
- `:85` error fallback `'Could not start the game.'` — [new key]

### native/CameraStage.tsx — no i18n
- `:136` "PhotoChase needs the camera to play." + `... ? '' : 'Enable it in Settings…'` — [new key] (anti-pattern #2)
- `:140` `<Text>Allow the camera</Text>` — [new key]

## Verified not-gaps

SignInScreen provider brand names (`Apple`/`Google`/`Facebook`/`X`); phase→key
lookup tables in the web dynamic pages; `AXIS`/foul-reason enum keys; event
names (`COMPLETE_RETURN1`, …); `dev/*` (dev-only); `.well-known` JSON routes;
`ui.tsx` text (callers pass `t()`-sourced props).

## Suggested remediation order

1. **[reuse] cleanups first** — the ~8 strings that map to already-translated
   keys, bite-checked. Includes restructuring the `ResultsScreen` /
   `PlanScreen` module constants to resolve via `t()` at render time. No new
   translations required.
2. **Wire i18n into the six dark files** — `HuntScreen`, `RatingScreen`,
   `FinalsScreen`, `CaptureScreen`, `native/CameraStage`, web `page.tsx`.
3. **[new key] batch** — add the ~40 English keys plus ES/FR/DE/PT/JA; the
   `{a} / {b}` concatenations become `count`-param keys with `_one` siblings
   where the singular reads badly. Non-English strings want native review
   before shipping.
