import { randomInt } from 'node:crypto';

const LOWERCASE = 'abcdefghijkmnpqrstuvwxyz'; // no 'l'/'o' — avoid look-alike confusion with '1'/'0'
const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 'I'/'O'
const DIGITS = '23456789'; // no '0'/'1'
const SYMBOLS = '!@#$%^&*-_=+';
const ALL_CHARS = LOWERCASE + UPPERCASE + DIGITS + SYMBOLS;
const PASSWORD_LENGTH = 16;

function pickRandomChar(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)];
}

/**
 * A single admin never chooses an executive's password (per spec) — this
 * is the only source of new/reset passwords. Cryptographically random
 * (crypto.randomInt, never Math.random), guarantees at least one char from
 * each required class, then a crypto-random Fisher-Yates shuffle so the
 * guaranteed characters aren't always in the same fixed positions.
 */
export function generateTemporaryPassword(): string {
  const required = [
    pickRandomChar(LOWERCASE),
    pickRandomChar(UPPERCASE),
    pickRandomChar(DIGITS),
    pickRandomChar(SYMBOLS),
  ];
  const remainingLength = PASSWORD_LENGTH - required.length;
  const chars = [...required, ...Array.from({ length: remainingLength }, () => pickRandomChar(ALL_CHARS))];

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

const MIN_CHOSEN_PASSWORD_LENGTH = 10;

/**
 * A lighter bar than the generator's own output (no mandatory symbol) for
 * a password the EXECUTIVE chooses themselves in `/auth/change-password` —
 * strong enough to matter, without being so strict it just pushes users
 * toward "Password1!" patterns.
 */
export function meetsPasswordPolicy(password: string): boolean {
  return (
    password.length >= MIN_CHOSEN_PASSWORD_LENGTH &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password)
  );
}
