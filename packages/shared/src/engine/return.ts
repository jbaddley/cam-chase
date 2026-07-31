import type { GameState } from '../domain/enums.js';
import type { GeoPoint } from '../domain/types.js';
import { isWithinGeofence, type Geofence } from './geofence.js';
import { haversineMeters } from './scoring.js';
import type { Game } from './state.js';

/**
 * Everything the game needs to know about teams coming back to where they
 * started: where "back" is, whether a team is there, and whether everyone is.
 *
 * All of it derives from the aggregate, and none of it is stored. A team's
 * readiness is the earliest check-in among its members — the same rule
 * {@link returnDurations} has always used for scoring — which is why there is no
 * per-team `checkedIn` flag to keep in sync and no migration to run.
 */

/**
 * The fence used when the host's phone gave us a start point but nobody chose a
 * radius. Deliberately generous: a false "you are not back yet" strands a team
 * mid-game with no way forward, while a false accept costs them a time bonus.
 * Phone GPS between buildings is routinely worse than this looks.
 *
 * It is a guess until somebody walks it. Named so tuning it is one edit.
 */
export const DEFAULT_RETURN_RADIUS_M = 75;

/**
 * How far a single bad fix may widen the fence. Devices report their own
 * horizontal accuracy and we have collected it since the beginning without ever
 * reading it; a fix that says "within 60 m" should not be judged as though it
 * were exact. Capped so a device claiming kilometre-scale uncertainty cannot
 * check in from the next town.
 */
export const MAX_ACCURACY_SLACK_M = 100;

/**
 * Past this, a team is not "still walking" — something is wrong with the spot.
 *
 * A misrecorded meeting point produces a distance nobody could cover on foot,
 * and telling that player how many metres they have to go reads as a broken app
 * rather than a misconfiguration. Five kilometres is well beyond any plausible
 * round on foot and well inside "the host pressed Start in the wrong city".
 */
export const IMPLAUSIBLE_RETURN_DISTANCE_M = 5_000;

/**
 * A distance a person can read. Metres up to a kilometre, then kilometres to one
 * decimal — `941950 m to go` is technically true and completely useless.
 */
export function formatDistance(metres: number): string {
  if (metres < 1_000) return `${metres} m`;
  const km = metres / 1_000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** Where the host gathered the teams, recorded when they pressed Start. */
export interface StartSpot {
  lat: number;
  lng: number;
  /** Horizontal accuracy of the host's fix, when reported. */
  accuracyM?: number;
  at: number;
}

export type ReturnRound = 'round1' | 'round2';

/**
 * Where a team is in the round-trip. `heading_back` is the honest middle state:
 * the work is done but the team is still out there, which is the difference
 * between "waiting on three teams to finish" and "waiting on three teams to
 * walk".
 */
export type TeamReturnStatus = 'shooting' | 'heading_back' | 'ready';

/**
 * Which round's return a state belongs to.
 *
 * The active phases count, not only the `*_return` ones. A team that has taken
 * its photos is done whether or not the host has called everyone in, and making
 * it wait for a phase change to say so is what prevented a roster showing some
 * teams back and others still out.
 */
export function returnRoundOf(state: GameState): ReturnRound | null {
  if (state === 'round1_active' || state === 'round1_return') return 'round1';
  if (state === 'round2_active' || state === 'round2_return') return 'round2';
  return null;
}

/**
 * The fence a check-in is judged against, or null when the game has none.
 *
 * Geofencing is a paid feature (docs/01): a free game still captures a start
 * point and runs the whole return loop — teams check in, the roster shows who is
 * back — but the check-in is accepted anywhere and no time bonus is scored. Only
 * `config.geofencing` turns the point into a fence, so this returns null first
 * when it is off, whatever start point the game happens to hold.
 *
 * With it on: a host-configured `returnSpot` wins outright, radius included —
 * they chose that number and it is not ours to widen. Failing that, the point
 * captured at Start with the default radius. Failing both, still null.
 */
export function resolveReturnFence(game: Game): Geofence | null {
  if (!game.config.geofencing) return null;
  const configured = game.config.returnSpot;
  if (configured) {
    return { center: { lat: configured.lat, lng: configured.lng }, radiusM: configured.radiusM };
  }
  const spot = game.startSpot;
  if (spot) return { center: { lat: spot.lat, lng: spot.lng }, radiusM: DEFAULT_RETURN_RADIUS_M };
  return null;
}

/** Slack from a reported accuracy, ignoring absent values and absurd ones. */
function slack(accuracyM: number | undefined): number {
  if (accuracyM === undefined || !Number.isFinite(accuracyM) || accuracyM <= 0) return 0;
  return Math.min(accuracyM, MAX_ACCURACY_SLACK_M);
}

/**
 * Whether a fix counts as back at the start.
 *
 * The fence is widened by the uncertainty of both fixes involved — the one being
 * judged and the host's original — because judging a ±60 m reading against a
 * hard circle rejects teams who are genuinely standing there. An unfenced game
 * accepts everything.
 */
export function isBackAtStart(game: Game, at: GeoPoint): boolean {
  const fence = resolveReturnFence(game);
  if (!fence) return true;
  const widened = fence.radiusM + slack(at.accuracyM) + slack(game.startSpot?.accuracyM);
  return isWithinGeofence(at, { center: fence.center, radiusM: widened });
}

/**
 * Roughly how much further a team has to walk, or null when there is no fence.
 *
 * Rounded to 25 m on purpose. It is a wayfinding aid — "keep going" versus
 * "you're basically there" — and not a coordinate readout; the exact centre is
 * never sent to a client.
 */
export function metresToStart(game: Game, at: GeoPoint): number | null {
  const fence = resolveReturnFence(game);
  if (!fence) return null;
  const gap = haversineMeters(at, fence.center) - fence.radiusM;
  if (gap <= 0) return 0;
  return Math.round(gap / 25) * 25;
}

/**
 * teamId to the moment that team got back, being its earliest member check-in.
 * The same rule the time bonus has always used, so readiness and scoring can
 * never disagree about who was first.
 */
export function teamCheckins(game: Game, round: ReturnRound): Record<string, number> {
  const earliest: Record<string, number> = {};
  for (const m of game.memberships) {
    const at = m.returnCheckins[round];
    if (at === undefined || !m.teamId) continue;
    if (earliest[m.teamId] === undefined || at < earliest[m.teamId]!) earliest[m.teamId] = at;
  }
  return earliest;
}

/**
 * Per-team return durations, summed across rounds.
 *
 * Teams that never checked in are omitted rather than recorded as zero, so they
 * place last instead of scoring as instant returns.
 */
export function returnDurations(game: Game): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const round of ['round1', 'round2'] as const) {
    const startedAt = game.roundStartedAt?.[round];
    if (startedAt === undefined) continue;
    for (const [teamId, at] of Object.entries(teamCheckins(game, round))) {
      const duration = at - startedAt;
      if (duration < 0) continue;
      totals[teamId] = (totals[teamId] ?? 0) + duration;
    }
  }
  return totals;
}

/**
 * How much of a round's work a team has done, and how much it owes.
 *
 * Round 1 has to exclude Round 2's chases, which land in `game.photos` under the
 * *chasing* team's id — so a naive count of a team's photos keeps climbing after
 * Round 2 starts and would report every team as long since finished.
 */
export function teamRoundProgress(
  game: Game,
  teamId: string,
  round: ReturnRound,
): { done: number; goal: number } {
  if (round === 'round2') {
    const mine = game.assignments.filter((a) => a.chaserTeamId === teamId);
    return { done: mine.filter((a) => a.chasePhotoId !== null).length, goal: mine.length };
  }

  const chaseIds = new Set(
    game.assignments.map((a) => a.chasePhotoId).filter((id): id is string => id !== null),
  );
  const done = game.photos.filter((p) => p.teamId === teamId && !chaseIds.has(p.id)).length;
  const goal =
    (game.config.mode ?? 'photo_chase') === 'scavenger_hunt'
      ? (game.hunt?.items.length ?? 0)
      : game.config.photosPerRound;
  return { done, goal };
}

/** Where a team is in the round-trip. */
export function teamReturnStatus(game: Game, teamId: string, round: ReturnRound): TeamReturnStatus {
  if (teamCheckins(game, round)[teamId] !== undefined) return 'ready';
  const { done, goal } = teamRoundProgress(game, teamId, round);
  return done >= goal ? 'heading_back' : 'shooting';
}

/**
 * Whether every team is back.
 *
 * The empty-game clause is load-bearing: without it a game with no teams is
 * vacuously ready, and the gate that depends on this would wave through exactly
 * the state it exists to catch.
 */
export function allTeamsReady(game: Game, round: ReturnRound): boolean {
  if (game.teams.length === 0) return false;
  const back = teamCheckins(game, round);
  return game.teams.every((t) => back[t.id] !== undefined);
}

/** How many teams are still out. Zero when everyone is in. */
export function teamsStillOut(game: Game, round: ReturnRound): number {
  const back = teamCheckins(game, round);
  return game.teams.filter((t) => back[t.id] === undefined).length;
}
