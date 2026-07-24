# 01 – Product Spec

## Overview

PhotoChase is played by 2–6 teams in two rounds. In **Round 1**, each team roams a predefined play area taking a configured number of photos. Every photo must contain (a) at least one visual clue to where it was taken and (b) at least one team member's face — the crazier the pose and odder the angle, the better. In **Round 2**, each team receives other teams' photos and must find each spot and recreate the shot: same location, same angle, same pose, as closely as possible. Everyone then rates the comparisons, points are tallied, and a winner is announced with a full score breakdown.

## Roles

| Role | Description | Account required |
|------|-------------|------------------|
| **Host** | Sponsors the game, sets configuration, controls game start/advance. Advanced features are gated by the host's plan tier — invited teams never need a paid plan. | Yes — authenticated (Google, Facebook, X, or Apple) |
| **Team captain** | Creates a team inside a game, names it | Yes (free account OK) |
| **Team member** | Joins an existing team in a game. Many members per team; members may share one phone or each take turns shooting | Yes (free account OK) |
| **Judge** | Impartial rater. Does not play rounds and does not need to be in the play area — can vote from anywhere. Votes carry a configurable weight (1x–5x a regular member vote) | Yes (free account OK) |
| **Spectator** | Watch-only: lobby, reveals, results. May be promoted to judge by the host | Yes (free account OK) |

## Joining flow

1. Host creates a game → app displays a **short join code** (6 characters, unambiguous alphabet — no `0/O`, `1/I/L`) and a **QR code** encoding a deep link.
2. Other players either scan the QR with their phone camera (deep link opens the app, or the app-store page with the code preserved via deferred deep link) or open PhotoChase and type the code.
3. On joining, a player **creates a new team** or **joins an existing team** (or joins as judge/spectator).
4. The **lobby view** (mobile and web) shows all teams, their members, and judges/spectators in real time.
5. The host starts the game when at least 2 teams exist (max 6; free tier caps at 2).

## Game lifecycle state machine

All game logic is driven by an explicit server-side state machine. This is the backbone for realtime sync and for testing.

```
draft ──> lobby ──> round1_active ──> round1_return ──> round2_active
                                                            │
results <── finals_voting <── rating <── round2_return <────┘
   │
   └──> archived
```

| State | Entry condition | Exit condition |
|-------|-----------------|----------------|
| `draft` | Host creates game | Config valid → `lobby` |
| `lobby` | Code/QR live, teams join | Host starts with ≥2 teams |
| `round1_active` | Round 1 timer starts | All teams hit photo quota **or** timer expires |
| `round1_return` | Teams return to origin point; GPS + timestamp recorded per team (advanced: geofence auto-detects arrival) | All teams checked in (or host forces advance) |
| `round2_active` | Photo assignments distributed per game type | All assignments submitted **or** timer expires |
| `round2_return` | Return check-in as above | All teams checked in |
| `rating` | Original vs. chase pairs shown; members + judges rate pose and angle; GPS accuracy computed automatically. Teams never rate their own photos | All pairs rated |
| `finals_voting` | Top matches (scaled to total photos and team count) shown for **best overall match** vote; configured special categories voted | All votes in or host closes |
| `results` | Winner announced with breakdown: location accuracy, pose, angle, chase completion times, best-overall-match, special categories, fouls | Host archives |
| `archived` | Read-only history | — |

Key rules encoded in the engine:

- **Clue rule:** every Round 1 photo must contain at least one location clue. During rating, any rater can flag "no clue"; a majority flag (or AI check on paid tiers) marks a **foul** and applies the configured penalty to the originating team.
- **Face rule:** every photo must contain at least one face. Enforced at capture time by on-device/AI face detection where available; also flaggable during rating.
- **Round 2 secrecy:** chasing teams are never told whether a take was successful mid-round — they submit and receive the next photo.
- **GPS capture:** location is recorded at every photo capture and at each return check-in. Advanced play (paid) geofences the play area and return spot and records per-team return times for bonus points.

## Game types (Round 2 photo assignment)

| Type | Assignment | Notes |
|------|-----------|-------|
| **Round Robin** | Ring order: A chases B's photos, B chases C's, … last chases A's. Photos delivered in original capture order | Deterministic; up to 6 teams on paid plans |
| **Random** | Each team receives randomly assigned photos from any team that is not their own; every photo chased exactly once | Seeded server-side for fairness and test reproducibility |
| **Relay** *(idea)* | Each team member must personally shoot exactly one Round 1 photo and chase exactly one Round 2 photo | Forces participation on shared-phone teams |
| **Decoy** *(idea)* | Each team plants one intentionally misleading photo. Chasers who correctly identify the decoy earn a bonus; setters earn a bonus for each team fooled | Adds bluffing layer |
| **Blitz** *(idea)* | Multiple short micro-rounds (e.g., 3 photos in 5 minutes) instead of one long round | Small play areas, parties |
| **Theme rounds** *(idea)* | Host sets a theme ("reflections", "look tiny") judged as an extra rating axis | Pairs well with special categories |

## Scoring

| Component | Source | Notes |
|-----------|--------|-------|
| Location accuracy | Automatic — GPS distance between original and chase capture points, banded (e.g., <10 m full points, <25 m, <50 m, beyond) | Free tier uses coarse bands; paid uses fine bands |
| Pose match | Member votes + weighted judge votes (+ AI score on paid tiers) | 1–5 stars |
| Angle match | Same as pose | 1–5 stars |
| Chase completion time | Return check-in timestamps; faster teams earn bonus tiers | Advanced/paid: geofence-verified |
| Best overall match | Finals vote among top matches | Single winner bonus |
| Special categories | Finals votes per configured category | Fun bonuses |
| Fouls | Missing clue / missing face | Configured penalty per foul |

Judge votes count at the configured multiplier (1x–5x). AI scores (paid) are added alongside human votes as a separate component, never replacing them.

## Configuration matrix

| Setting | Range / options | Tier availability |
|---------|-----------------|-------------------|
| Photos per team (Round 1) | 5–20 | Free: fixed default (e.g., 5); Paid: full range |
| Round 1 minutes | 5–20 | Free: fixed default; Paid: full range |
| Round 2 minutes | 5–20 | Free: fixed default; Paid: full range |
| Teams | 2–6 | Free: 2; Paid: up to 6 |
| Game type | Round Robin, Random (+future types) | Free: Round Robin only; Paid: all |
| Play area | Center point + radius; advanced: drawn geofence | Free: informal (honor system); Paid: geofenced |
| Return spot | GPS point captured at game start | Paid: geofenced auto check-in + timing |
| Special voting categories | 5 presets (Worst Attempt, Craziest Pose, Most Difficult Angle, Most Creative Clue, Best Photobomb) + up to 5 user-created, saved to the host's profile for reuse | Paid |
| Judge vote weight | 1x–5x | Paid (free fixed at 1x) |
| AI judging | On/off | Paid only |

## Big screen, casting, and comparison viewing

Comparisons (original vs. chase side-by-side) are the emotional peak of the game and are best on a large screen, while remaining fully usable on mobile.

- **Web big-screen view (v1):** any browser — smart TV, laptop plugged into a TV, Chromecast tab-cast, AirPlay screen mirror — opens `photochase.app/watch` and enters the game code. The view auto-scales layout to the screen size and renders the reveal/voting sequence in a lean, presentation-style UI. Phones act as voting controllers; the big screen updates live.
- **Native casting (fast follow):** Google Cast SDK and AirPlay integration in the mobile app for one-tap casting of the same big-screen experience.
- The layout engine uses screen dimensions to choose between stacked (portrait phone), side-by-side (landscape/tablet), and stage mode (TV: large images, oversized vote tallies, animated reveals).

## UX principles

- Playful, fun, inviting: bright palette, rounded shapes, springy motion, confetti on reveals and winner announcement — modern but not childish.
- Camera-first during rounds: full-screen viewfinder, photo count and countdown timer always visible, one-tap capture.
- Zero-friction joining: scan → name a team → in the lobby in under 30 seconds.
- Ads (free tier) appear only in lobby and results screens — never during rounds, capture, or rating. Family-appropriate ad categories only.
- Web surfaces: marketing page, join/lobby, spectator/big-screen view, results — all responsive.
