# 10 – Mobile UI Conventions

This app is mobile-first, played one-handed, standing up, outdoors, often in a
hurry. These are the platform conventions it holds to, written down because they
were being rediscovered one correction at a time — a settings panel shipped across
the middle of the viewfinder, then shrunk, then still sitting on the picture, when
the standard answer existed the whole time.

Treat these as the baseline, not a preference to be asked about. Deviating is
allowed and should be justified in a comment where it happens.

## Chrome, content, action

Three zones, and things belong in exactly one of them.

- **Header** — identity and secondary actions. The join code, progress, and an
  options affordance. Persistent, predictable, never scrolls away.
- **Content** — the thing the screen is about. On a camera screen that is the
  viewfinder and the photo. **Nothing is drawn over content that could live in the
  header or a sheet.** A control on top of the picture is a control competing with
  the reason the screen exists.
- **Action** — one primary action, pinned, full width, in the lower third where a
  thumb reaches. Not two, not six. Anything else is secondary and belongs
  elsewhere.

## Settings and occasional controls

Options that are set occasionally and then left alone — view modes, opacity,
anything configural — go in a **modal sheet opened from a header icon**, with an
explicit **Done**. Not inline chips, not a disclosure that pushes content around,
not a panel that lives on screen because it was easier to render there.

The test: if a control is used once or twice per screen visit and then ignored, it
should not be visible while it is being ignored.

## Touch and reach

- Minimum touch target **48×48 dp**, with at least 8 dp between adjacent targets.
- The primary action sits in the bottom third. The top corners are for chrome
  only, because they cannot be reached one-handed on a large phone.
- Respect safe areas on all four edges — the app runs edge-to-edge, and turned
  sideways the notch and navigation bar are on the sides.

## State and feedback

- Show state, not a verb, when a control is collapsed: "Original at 40%" tells you
  where you are; "Change" does not.
- Every async action has a visible pending state, and every failure says what to do
  about it. A distance nobody could walk is a broken setting, not a long walk —
  say so, and name who can fix it.
- Disabled controls carry the reason as their label rather than being greyed out
  with the same text.

## Text

- Never assume English's plural rule. Counts use the catalogue's singular forms —
  see `packages/i18n`. `player{n === 1 ? '' : 's'}` in a component is a bug.
- Assume every string is 30% longer in translation. Names truncate; status labels
  keep their width.

## What this is not

Not a design system — `src/theme.ts` and `src/ui.tsx` are that. This is the layer
above: where things go, and why. When a screen needs a new *kind* of surface, add
it to `ui.tsx` so the next screen inherits it instead of improvising.
