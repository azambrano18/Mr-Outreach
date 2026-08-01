import { BadRequestException } from '@nestjs/common';

/**
 * §5 — the ONLY place that turns a mailbox's stored email into the "folder"
 * segment of an R2 object key (`firmas/{correo-normalizado}/...`). Never
 * duplicate this logic elsewhere. The email always comes from the database
 * record (`mailbox.email`), never from a client-supplied value — this
 * function only normalizes and validates it, it never trusts input as
 * already-safe.
 *
 * Rejects anything that could let a crafted (theoretically already-invalid,
 * since emails are validated at write time) email escape the `firmas/`
 * prefix or reach another mailbox's folder: path separators, `..`
 * traversal, and control characters.
 */
const EMAIL_FORMAT_PATTERN = /^[^\s@/\\]+@[^\s@/\\]+\.[^\s@/\\]+$/;
// eslint-disable-next-line no-control-regex -- deliberately matching control characters to reject them.
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1f\x7f]/;

export function normalizeMailboxEmailForStorageKey(rawEmail: string): string {
  const normalized = rawEmail.trim().toLowerCase();

  if (!EMAIL_FORMAT_PATTERN.test(normalized)) {
    throw new BadRequestException('El correo de la cuenta no tiene un formato válido para construir su carpeta de assets.');
  }
  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new BadRequestException('El correo de la cuenta contiene caracteres no permitidos (barras).');
  }
  if (normalized.includes('..')) {
    throw new BadRequestException('El correo de la cuenta contiene una secuencia no permitida ("..").');
  }
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new BadRequestException('El correo de la cuenta contiene caracteres de control no permitidos.');
  }

  return normalized;
}

/** `firmas/{correo-normalizado}/` — always with the trailing slash, so prefix checks never accidentally match a sibling folder (`ventas@empresa.cl` vs `ventas2@empresa.cl`). */
export function buildSignatureFolderPrefix(signaturePrefixRoot: string, normalizedEmail: string): string {
  const safeRoot = signaturePrefixRoot.replace(/^\/+|\/+$/g, '');
  return `${safeRoot}/${normalizedEmail}/`;
}
