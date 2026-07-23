import { Mailbox } from '../../domain/mailbox/mailbox.entity';
import { Organization } from '../../domain/organization/organization.entity';
import { fullName, User } from '../../domain/user/user.entity';

/** Canned sample data for generic/unrecognized {variable} keys — no contacts phase exists yet to pull real values from. */
const GENERIC_SAMPLE_VALUES: Record<string, string> = {
  nombre: 'Juan Pérez',
  empresa: 'Empresa Ejemplo S.A.',
  correo: 'juan.perez@ejemplo.com',
  email: 'juan.perez@ejemplo.com',
  telefono: '+56 9 1234 5678',
  cargo: 'Gerente de Ventas',
};
const FALLBACK_SAMPLE_VALUE = '[valor de ejemplo]';

export interface SignatureRenderContext {
  mailbox: Mailbox;
  organization: Organization;
  /** The mailbox's primary assignee (or, absent one, any assignee) — null if nothing is assigned yet. */
  sender: User | null;
}

/**
 * Resolves the {sender.*} / {mailbox.*} namespace from real data when
 * available, falling back to a clearly-labeled example when there's no
 * assigned executive yet (see request section 10: "si todavía no hay
 * ejecutivo asignado, utilizar una vista previa genérica"). Anything
 * outside those two namespaces falls back to the same generic sample
 * values the Templates/Variables preview already uses.
 */
export function resolveSignatureVariable(
  key: string,
  ctx: SignatureRenderContext,
): { value: string; isReal: boolean } {
  if (key === 'mailbox.email') {
    return { value: ctx.mailbox.email, isReal: true };
  }

  if (key.startsWith('sender.')) {
    if (!ctx.sender) {
      const genericSender: Record<string, string> = {
        'sender.name': 'Juan Pérez',
        'sender.firstName': 'Juan',
        'sender.lastName': 'Pérez',
        'sender.email': 'juan.perez@ejemplo.com',
        'sender.company': ctx.organization.name,
      };
      return { value: genericSender[key] ?? FALLBACK_SAMPLE_VALUE, isReal: false };
    }

    const realSender: Record<string, string | null> = {
      'sender.name': fullName(ctx.sender),
      'sender.firstName': ctx.sender.firstName,
      'sender.lastName': ctx.sender.lastName,
      'sender.email': ctx.sender.email,
      'sender.company': ctx.organization.name,
    };
    const value = realSender[key];
    return value ? { value, isReal: true } : { value: FALLBACK_SAMPLE_VALUE, isReal: false };
  }

  return { value: GENERIC_SAMPLE_VALUES[key] ?? FALLBACK_SAMPLE_VALUE, isReal: false };
}

export function renderSignatureText(
  text: string,
  variables: string[],
  ctx: SignatureRenderContext,
): { rendered: string; usesRealSenderData: boolean } {
  let usesRealSenderData = false;
  const rendered = variables.reduce((acc, key) => {
    const { value, isReal } = resolveSignatureVariable(key, ctx);
    if (isReal) usesRealSenderData = true;
    return acc.split(`{${key}}`).join(value);
  }, text);
  return { rendered, usesRealSenderData };
}
