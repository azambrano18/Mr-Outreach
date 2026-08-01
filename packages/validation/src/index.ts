/**
 * Shared validation logic for template content — the {variable} syntax
 * used in a template's subject/body. Used by both the API (DTO validation,
 * server is the source of truth) and the web app (live inline feedback in
 * the template editor) so the two never drift apart.
 *
 * Format: a single pair of braces, one identifier inside (digits and
 * underscore allowed after the first letter), no spaces. Namespaced system
 * variables (sender, mailbox, contact) use a dot inside the same single
 * pair of braces, e.g. {sender.firstName} — the dot is the only "special"
 * character allowed, so a custom catalog key can never collide with one of
 * those (a bare key has no dot). A custom catalog key (the admin-facing
 * Variables module) must additionally be lowercase — see
 * BARE_VARIABLE_KEY_PATTERN / isValidVariableKey. The old double-brace
 * syntax is no longer supported and is explicitly rejected wherever it's
 * detected, so a stray un-migrated token fails loudly instead of silently
 * misrendering.
 */

/**
 * A bare name (e.g. "nombre") or a dot-namespaced one (e.g.
 * "sender.firstName") — namespaces let the signature editor distinguish
 * {sender.*} / {mailbox.*} (resolved from real executive/mailbox data,
 * with their own camelCase-style property names) from the general Variable
 * catalog's flat custom keys, without two separate syntaxes. Case is only
 * restricted for bare catalog keys (see BARE_VARIABLE_KEY_PATTERN /
 * isValidVariableKey) — a reference inside template text tolerates either,
 * same as before the {{ }} → { } migration.
 */
export const VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;
const BRACE_TOKEN_PATTERN = /\{([^{}]*)\}/g;
const DOUBLE_BRACE_PATTERN = /\{\{|\}\}/;

export interface DefaultTemplateVariable {
  key: string;
  label: string;
  description: string;
}

/**
 * The fixed variables the live SequenceTemplate/SequenceExecution flow
 * resolves automatically from the imported prospect file's column mapping
 * — never typed by hand, never created as a Variable catalog row. Single
 * source of truth, reused by: the sequence template editor's built-in
 * variable list, the Variables panel's "Variables por defecto" section, the
 * prospect-import column mapping board, and RESERVED_VARIABLE_KEYS below
 * (a custom catalog variable can never shadow one of these). If this flow
 * ever starts resolving more fixed fields end-to-end, add them here first.
 */
export const DEFAULT_TEMPLATE_VARIABLES: DefaultTemplateVariable[] = [
  { key: 'email', label: 'Correo', description: 'Correo del contacto.' },
  { key: 'contact_name', label: 'Nombre del contacto', description: 'Nombre del contacto.' },
  { key: 'company_name', label: 'Empresa', description: 'Empresa del contacto.' },
];

export const DEFAULT_TEMPLATE_VARIABLE_KEYS = DEFAULT_TEMPLATE_VARIABLES.map((variable) => variable.key);

/**
 * Namespace roots reserved for this app's built-in, dot-qualified variables
 * ({sender.*}, {mailbox.*}, {contact.*}, all resolved server-side from real
 * data), plus the flat DEFAULT_TEMPLATE_VARIABLE_KEYS above — a custom
 * catalog variable is always a bare key, so it's rejected if it exactly
 * matches one of these, keeping a custom variable from ever shadowing a
 * built-in one. Common sample keys like "nombre"/"empresa"/"cargo" are NOT
 * reserved — those are exactly the kind of custom variable an admin is
 * expected to create (see spec §5.3 examples).
 */
export const RESERVED_VARIABLE_KEYS = new Set(['sender', 'mailbox', 'contact', ...DEFAULT_TEMPLATE_VARIABLE_KEYS]);

export interface TemplateVariableValidationResult {
  valid: boolean;
  /** Unique variable names found, in first-seen order. Only populated when valid. */
  variables: string[];
  /** Human-readable (Spanish) descriptions of every problem found. */
  errors: string[];
}

/**
 * Validates the {variable} tokens in a piece of template text (subject or
 * body, checked independently). A token is valid when it contains only a
 * name matching [a-z_][a-z0-9_]* (optionally dot-namespaced). Any leftover
 * {{double-brace}} syntax, unbalanced braces, and malformed names are all
 * reported.
 */
export function validateTemplateVariables(text: string): TemplateVariableValidationResult {
  const errors: string[] = [];
  const variables: string[] = [];
  const seen = new Set<string>();

  if (DOUBLE_BRACE_PATTERN.test(text)) {
    errors.push('Formato de variable no soportado: usa {nombre} en vez de {{nombre}}.');
    return { valid: false, variables: [], errors };
  }

  const openCount = (text.match(/\{/g) ?? []).length;
  const closeCount = (text.match(/\}/g) ?? []).length;
  if (openCount !== closeCount) {
    errors.push('Llaves sin cerrar: cada variable debe escribirse como {nombre}.');
  }

  let match: RegExpExecArray | null;
  const pattern = new RegExp(BRACE_TOKEN_PATTERN);
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1].trim();
    if (raw !== match[1] || !VARIABLE_NAME_PATTERN.test(raw)) {
      errors.push(
        `Variable inválida "{${match[1]}}": usa solo minúsculas, números y guion bajo, sin espacios ni empezar con número.`,
      );
      continue;
    }
    if (!seen.has(raw)) {
      seen.add(raw);
      variables.push(raw);
    }
  }

  return { valid: errors.length === 0, variables, errors };
}

/** Convenience for callers that only need the extracted names, e.g. a live preview. */
export function extractTemplateVariables(text: string): string[] {
  return validateTemplateVariables(text).variables;
}

/** Lowercase + trim — applied before a variable key is ever validated, stored, or compared. */
export function normalizeVariableKey(key: string): string {
  return key.trim().toLowerCase();
}

/**
 * Validates a standalone variable *key* (the catalog entry's identifier,
 * e.g. "nombre" — not wrapped in {...}). Same character rules as a
 * variable reference inside template text, since a catalog key must be
 * usable as {key} the moment someone inserts it into a template. Rejects
 * reserved system-namespace words and dotted keys (a custom catalog
 * variable is always bare — namespacing is reserved for built-ins).
 */
const BARE_VARIABLE_KEY_PATTERN = /^[a-z_][a-z0-9_]*$/;

export function isValidVariableKey(key: string): boolean {
  return BARE_VARIABLE_KEY_PATTERN.test(key) && !RESERVED_VARIABLE_KEYS.has(key);
}

/**
 * Human-readable (Spanish) reason a normalized catalog key is rejected, or
 * null if it's valid — single source of truth for the message shown by
 * both the create and edit Variable forms (and mirrored server-side by
 * IsValidVariableKey's defaultMessage), so a reserved-key rejection reads
 * differently from a plain character-format error instead of the same
 * generic message for both.
 */
export function describeInvalidVariableKey(key: string): string | null {
  if (isValidVariableKey(key)) return null;
  if (RESERVED_VARIABLE_KEYS.has(key)) {
    return 'Esta clave está reservada por el sistema (es una variable por defecto) y no puede usarse en el catálogo personalizado.';
  }
  return 'Usa solo minúsculas, números y guion bajo, sin espacios ni empezar con número.';
}

/**
 * Executives must authenticate with an institutional MejoReferido email —
 * a single, fixed domain (this app treats "Organization" as effectively
 * one tenant everywhere else too), not a per-organization setting.
 */
export const INSTITUTIONAL_EMAIL_DOMAIN = 'mejoreferido.cl';

/** Lowercase + trim — the same normalization applied before every uniqueness check or comparison. */
export function normalizeInstitutionalEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Exact-domain match only (no subdomains, no lookalike domains like
 * "mejoreferido.com") — split on a single "@" so "a@b@mejoreferido.cl"
 * (multiple "@") is rejected here even before class-validator's @IsEmail.
 */
export function isInstitutionalEmail(email: string): boolean {
  const parts = normalizeInstitutionalEmail(email).split('@');
  return parts.length === 2 && parts[0].length > 0 && parts[1] === INSTITUTIONAL_EMAIL_DOMAIN;
}
