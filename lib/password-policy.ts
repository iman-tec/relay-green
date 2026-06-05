/*
 * Password policy — shared between /set-password client + the
 * /api/auth/set-password server handler so the validation can't drift.
 *
 * Rules:
 *   • At least 8 characters
 *   • At least one lowercase letter
 *   • At least one digit
 *   • At least one special character from !@#$%^&*()_+-=[]{};:'",.<>/?\|`~
 */

const SPECIALS = "!@#$%^&*()_+\\-=\\[\\]{};:'\",.<>/?\\\\|`~";

export const PASSWORD_MIN_LENGTH = 8;

export type PasswordCheck = {
  length: boolean;
  lowercase: boolean;
  digit: boolean;
  special: boolean;
};

export function checkPassword(password: string): PasswordCheck {
  return {
    length: password.length >= PASSWORD_MIN_LENGTH,
    lowercase: /[a-z]/.test(password),
    digit: /\d/.test(password),
    special: new RegExp(`[${SPECIALS}]`).test(password),
  };
}

export function passwordIsValid(password: string): boolean {
  const c = checkPassword(password);
  return c.length && c.lowercase && c.digit && c.special;
}

/** Single-line server-side error message when validation fails. */
export const PASSWORD_RULES_MESSAGE =
  "Password must be at least 8 characters and include a lowercase letter, a number, and a special character.";
