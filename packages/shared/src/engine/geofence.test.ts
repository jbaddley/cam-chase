import { describe, expect, it } from 'vitest';
import { isWithinGeofence, type Geofence } from './geofence.js';

const CENTER = { lat: 40, lng: -74 };
const FENCE: Geofence = { center: CENTER, radiusM: 50 };

describe('isWithinGeofence', () => {
  it('includes the center and nearby points, excludes far ones', () => {
    expect(isWithinGeofence(CENTER, FENCE)).toBe(true);
    expect(isWithinGeofence({ lat: 40.0003, lng: -74 }, FENCE)).toBe(true); // ~33m
    expect(isWithinGeofence({ lat: 40.001, lng: -74 }, FENCE)).toBe(false); // ~111m
  });

  it('includes a point exactly on the boundary', () => {
    // Being told you are not back while standing on the line would be absurd.
    expect(isWithinGeofence(CENTER, { center: CENTER, radiusM: 0 })).toBe(true);
  });
});

// `returnDurationsFromCheckins` used to be tested here. It computed durations
// from a list of check-ins that nothing ever built, while the API worked off the
// aggregate through its own private copy — so this file was testing a duplicate
// of live logic. Both now live in `return.ts`, and `return.test.ts` covers them.
