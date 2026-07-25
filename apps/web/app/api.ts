import { PhotoChaseClient } from '@photochase/client';

/**
 * Client for the big-screen viewer. No token supplier: the spectator endpoint
 * is public, because a TV browser has nobody signed in.
 */
export const client = new PhotoChaseClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000',
});
