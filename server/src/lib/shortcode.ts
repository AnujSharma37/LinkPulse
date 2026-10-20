import crypto from 'node:crypto';

// Lowercase + digits only: codes are case-insensitive, so "AbC" and "abc" can never be two different links.
const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789'; // no l, 0, 1 (look-alikes) -> 33 symbols
export const DEFAULT_CODE_LENGTH = 7; // 33^7 ≈ 42.6 billion combinations

/** Cryptographically secure, uniformly random short code (crypto.randomInt avoids modulo bias). */
export function generateCode(length = DEFAULT_CODE_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

export { ALIAS_PATTERN, RESERVED_ALIASES, validateAlias } from '../shared/validation.js';
