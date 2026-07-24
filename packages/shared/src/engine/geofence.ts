import type { GeoPoint } from '../domain/types.js';
import { haversineMeters } from './scoring.js';

/** A circular geofence: play area or return spot (advanced/paid play). */
export interface Geofence {
  center: GeoPoint;
  radiusM: number;
}

/** True if a point lies within (or exactly on) the geofence boundary. */
export function isWithinGeofence(point: GeoPoint, fence: Geofence): boolean {
  return haversineMeters(point, fence.center) <= fence.radiusM;
}

export interface ReturnCheckin {
  teamId: string;
  /** Epoch ms the team checked in at the return spot. */
  at: number;
  location: GeoPoint;
}

/**
 * Compute per-team return durations from a round's start time and check-ins.
 * If a return geofence is supplied, check-ins outside it don't count (a team
 * must actually reach the return spot). The earliest valid check-in per team
 * wins. Output feeds computeScoreboard's return-time bonus.
 */
export function returnDurationsFromCheckins(
  roundStartedAt: number,
  checkins: ReturnCheckin[],
  returnFence?: Geofence,
): Record<string, number> {
  const durations: Record<string, number> = {};
  for (const c of checkins) {
    if (returnFence && !isWithinGeofence(c.location, returnFence)) continue;
    const duration = c.at - roundStartedAt;
    if (duration < 0) continue;
    if (durations[c.teamId] === undefined || duration < durations[c.teamId]!) {
      durations[c.teamId] = duration;
    }
  }
  return durations;
}
