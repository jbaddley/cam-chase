import type { FoulReason, RatingAxis, Role, Tier } from './enums.js';

/** A geographic point captured with a device. */
export interface GeoPoint {
  lat: number;
  lng: number;
  /** Horizontal accuracy in meters, when the device reports it. */
  accuracyM?: number;
  /** Compass heading in degrees (0–360), when available. */
  headingDeg?: number;
}

export interface User {
  id: string;
  displayName: string;
  /** Verified email is the key used for federated-account linking. */
  email?: string;
  tier: Tier;
  createdAt: number;
}

export interface Team {
  id: string;
  gameId: string;
  name: string;
  createdAt: number;
}

export interface Membership {
  id: string;
  gameId: string;
  userId: string;
  /** Null for judges/spectators, who are not on a team. */
  teamId: string | null;
  role: Role;
  /** Recorded when the team returns to the origin point each round. */
  returnCheckins: Partial<Record<'round1' | 'round2', number>>;
}

export interface Photo {
  id: string;
  gameId: string;
  teamId: string;
  /** The member who captured the shot. */
  shooterUserId: string;
  /** Capture order within the team's round (0-based). */
  order: number;
  location: GeoPoint;
  capturedAt: number;
  s3Key: string;
  /** Scavenger Hunt: which list item this photo claims. */
  itemId?: string;
  fouls: FoulReason[];
}

/** A Round 2 task: `chaserTeamId` must recreate `originalPhotoId`. */
export interface Assignment {
  id: string;
  gameId: string;
  chaserTeamId: string;
  originalPhotoId: string;
  /** Delivery order within the chasing team's Round 2 queue. */
  order: number;
  /** The chase photo submitted for this assignment, once taken. */
  chasePhotoId: string | null;
}

export interface Vote {
  id: string;
  gameId: string;
  assignmentId: string;
  voterUserId: string;
  axis: RatingAxis;
  /** 1–5 stars. */
  stars: number;
}

/** Per-team score breakdown produced by the scoring engine. */
export interface TeamScore {
  teamId: string;
  location: number;
  pose: number;
  angle: number;
  timeBonus: number;
  bestMatchBonus: number;
  specialBonus: number;
  foulPenalty: number;
  total: number;
}
