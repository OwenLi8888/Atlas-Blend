/** Passcodes are kept as a salted scrypt hash, never as written. */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_BYTES = 32;

/** The form a passcode is stored in: its salt and its hash, in hex. */
export function hashPasscode(passcode: string): string {
  const salt = randomBytes(16);
  return salt.toString('hex') + ':' + scryptSync(passcode, salt, KEY_BYTES).toString('hex');
}

/** Whether `passcode` is the one `stored` was made from. A stored value that cannot be read matches nothing. */
export function passcodeMatches(passcode: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== KEY_BYTES) return false;
  return timingSafeEqual(scryptSync(passcode, Buffer.from(salt, 'hex'), KEY_BYTES), expected);
}
