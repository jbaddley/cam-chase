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

/**
 * Return durations used to live here too, computed from a list of check-ins that
 * nothing ever built. The API had its own private copy working off the aggregate,
 * which is the one that actually ran — so this file held a tested duplicate of
 * live logic, and a well-meaning fix to the wrong one would have changed nothing.
 * Both now live in `return.ts`, over the aggregate, once.
 */
