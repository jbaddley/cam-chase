import { randomUUID } from 'node:crypto';

/** Unambiguous alphabet for join codes (no 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/** Generate a random join code. Uniqueness is enforced by the repository. */
export function newJoinCode(rng: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  }
  return code;
}
