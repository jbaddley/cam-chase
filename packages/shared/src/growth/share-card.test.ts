import { describe, expect, it } from 'vitest';
import { buildShareCard, shareUrlFor, takedown, type ShareCardInput } from './share-card.js';

const input: ShareCardInput = {
  gameId: 'game_1',
  originalRef: 'orig',
  chaseRef: 'chase',
  originalTeamName: 'Reds',
  chaseTeamName: 'Blues',
  scoreStamp: 'Best overall match!',
  referralCode: 'ABC123',
  depictedUserIds: ['u1', 'u2'],
};

describe('buildShareCard', () => {
  it('builds a card when all depicted participants consented', () => {
    const result = buildShareCard(input, ['u1', 'u2', 'u3']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('active');
      expect(result.data.shareUrl).toContain('ref=ABC123');
    }
  });

  it('refuses and names missing consenters', () => {
    const result = buildShareCard(input, ['u1']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('u2');
  });
});

describe('shareUrlFor', () => {
  it('embeds the referral code and game id', () => {
    expect(shareUrlFor('CODE99', 'game_x')).toBe('https://photochase.app/s/game_x?ref=CODE99');
  });
});

describe('takedown', () => {
  it('flips status to taken_down', () => {
    const card = buildShareCard(input, ['u1', 'u2']);
    if (!card.ok) throw new Error('expected card');
    expect(takedown(card.data).status).toBe('taken_down');
  });
});
