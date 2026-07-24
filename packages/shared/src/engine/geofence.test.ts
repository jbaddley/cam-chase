import { describe, expect, it } from 'vitest';
import { computeScoreboard } from './scoring.js';
import { isWithinGeofence, returnDurationsFromCheckins, type Geofence } from './geofence.js';

const CENTER = { lat: 40, lng: -74 };
const FENCE: Geofence = { center: CENTER, radiusM: 50 };

describe('isWithinGeofence', () => {
  it('includes the center and nearby points, excludes far ones', () => {
    expect(isWithinGeofence(CENTER, FENCE)).toBe(true);
    expect(isWithinGeofence({ lat: 40.0003, lng: -74 }, FENCE)).toBe(true); // ~33m
    expect(isWithinGeofence({ lat: 40.001, lng: -74 }, FENCE)).toBe(false); // ~111m
  });
});

describe('returnDurationsFromCheckins', () => {
  it('measures duration from round start and keeps the earliest per team', () => {
    const durations = returnDurationsFromCheckins(1000, [
      { teamId: 'A', at: 1500, location: CENTER },
      { teamId: 'A', at: 1400, location: CENTER }, // earlier wins
      { teamId: 'B', at: 1800, location: CENTER },
    ]);
    expect(durations).toEqual({ A: 400, B: 800 });
  });

  it('ignores check-ins outside the return geofence', () => {
    const durations = returnDurationsFromCheckins(
      1000,
      [
        { teamId: 'A', at: 1500, location: { lat: 40.01, lng: -74 } }, // ~1.1km away
        { teamId: 'B', at: 1600, location: CENTER },
      ],
      FENCE,
    );
    expect(durations).toEqual({ B: 600 });
  });

  it('feeds the scoring time bonus so the faster team ranks higher', () => {
    const durations = returnDurationsFromCheckins(0, [
      { teamId: 'A', at: 500, location: CENTER },
      { teamId: 'B', at: 900, location: CENTER },
    ]);
    const board = computeScoreboard({
      teamIds: ['A', 'B'],
      assignments: [],
      locations: {},
      votes: [],
      returnDurations: durations,
    });
    const a = board.find((s) => s.teamId === 'A')!;
    const b = board.find((s) => s.teamId === 'B')!;
    expect(a.timeBonus).toBe(40);
    expect(b.timeBonus).toBe(30);
  });
});
