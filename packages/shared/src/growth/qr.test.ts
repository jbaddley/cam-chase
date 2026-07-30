import { describe, expect, it } from 'vitest';
import { joinCodeUrl, parseJoinCode } from './qr.js';

describe('joinCodeUrl', () => {
  it('builds the link a lobby QR encodes', () => {
    expect(joinCodeUrl('ABC234')).toBe('https://photochase.app/j/ABC234');
  });
});

describe('parseJoinCode', () => {
  it('round-trips a code through its own link', () => {
    expect(parseJoinCode(joinCodeUrl('ABC234'))).toBe('ABC234');
  });

  it('reads a bare code shared as text', () => {
    expect(parseJoinCode('ABC234')).toBe('ABC234');
  });

  it('normalises case and tolerates a trailing slash', () => {
    expect(parseJoinCode('https://photochase.app/j/abc234/')).toBe('ABC234');
    expect(parseJoinCode('  abc234  ')).toBe('ABC234');
  });

  it('rejects anything that is not a join code', () => {
    expect(parseJoinCode('https://evil.example.com/j/ABC234')).toBeNull(); // wrong host path shape
    expect(parseJoinCode('hello world')).toBeNull();
    expect(parseJoinCode('ABC23')).toBeNull(); // too short
    expect(parseJoinCode('ABC2345')).toBeNull(); // too long
    expect(parseJoinCode('')).toBeNull();
  });
});
