import {
  SignatureRenderContext,
  resolveSignatureVariable,
} from '../signatures/signature-variable-resolver';

const FALLBACK_SAMPLE_VALUE = '[valor de ejemplo]';

/** Generic {contact.*} samples — there is no Contact entity yet (see README > "Fase 10"), so these never resolve to real data. */
const GENERIC_CONTACT_SAMPLES: Record<string, string> = {
  'contact.firstName': 'Juan',
  'contact.lastName': 'Pérez',
  'contact.fullName': 'Juan Pérez',
  'contact.email': 'juan.perez@ejemplo.com',
  'contact.company': 'Empresa Ejemplo S.A.',
  'contact.jobTitle': 'Gerente de Compras',
  'contact.city': 'Santiago',
  'contact.country': 'Chile',
  'contact.website': 'https://empresa-ejemplo.cl',
  'contact.linkedin': 'https://linkedin.com/in/juan-perez',
};

export type SequenceRenderContext = SignatureRenderContext;

/**
 * Same {sender.*}/{mailbox.*} resolution as signatures (delegated),
 * plus a {contact.*} namespace (including the free-form
 * {contact.customFields.anything} shape) that always falls back to a
 * generic labeled example — there is no Contact/ContactList entity in
 * this phase (see README > "Fase 10" for what's deferred and why).
 */
export function resolveSequenceVariable(
  key: string,
  ctx: SequenceRenderContext,
): { value: string; isReal: boolean } {
  if (key.startsWith('contact.')) {
    return { value: GENERIC_CONTACT_SAMPLES[key] ?? FALLBACK_SAMPLE_VALUE, isReal: false };
  }
  return resolveSignatureVariable(key, ctx);
}

export function renderSequenceText(
  text: string,
  variables: string[],
  ctx: SequenceRenderContext,
): { rendered: string; usesRealSenderData: boolean } {
  let usesRealSenderData = false;
  const rendered = variables.reduce((acc, key) => {
    const { value, isReal } = resolveSequenceVariable(key, ctx);
    if (isReal) usesRealSenderData = true;
    return acc.split(`{${key}}`).join(value);
  }, text);
  return { rendered, usesRealSenderData };
}
