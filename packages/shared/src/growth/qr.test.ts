import { describe, expect, it } from 'vitest';
import { joinCodeUrl, joinDeepLink, parseJoinCode } from './qr.js';

describe('joinCodeUrl', () => {
  it('builds the link a lobby QR encodes', () => {
    expect(joinCodeUrl('ABC234')).toBe('https://photochase.app/j/ABC234');
  });
});

describe('joinDeepLink', () => {
  it('builds the deep link that opens the app on a code', () => {
    expect(joinDeepLink('ABC234')).toBe('photochase://j/ABC234');
  });
});

describe('parseJoinCode', () => {
  it('round-trips a code through its web link', () => {
    expect(parseJoinCode(joinCodeUrl('ABC234'))).toBe('ABC234');
  });

  it('round-trips a code through its deep link', () => {
    expect(parseJoinCode(joinDeepLink('ABC234'))).toBe('ABC234');
  });

  it('reads a bare code shared as text', () => {
    expect(parseJoinCode('ABC234')).toBe('ABC234');
  });

  it('normalises case and tolerates a trailing slash', () => {
    expect(parseJoinCode('https://photochase.app/j/abc234/')).toBe('ABC234');
    expect(parseJoinCode('  abc234  ')).toBe('ABC234');
  });

  it('rejects anything that is not a join code', () => {
    expect(parseJoinCode('https://evil.example.com/j/ABC234')).toBeNull(); // wrong origin
    expect(parseJoinCode('otherapp://j/ABC234')).toBeNull(); // wrong scheme
    expect(parseJoinCode('hello world')).toBeNull();
    expect(parseJoinCode('ABC23')).toBeNull(); // too short
    expect(parseJoinCode('ABC2345')).toBeNull(); // too long
    expect(parseJoinCode('')).toBeNull();
  });
});
