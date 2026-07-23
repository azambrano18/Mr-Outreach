import {
  extractTemplateVariables,
  isInstitutionalEmail,
  isValidVariableKey,
  normalizeInstitutionalEmail,
  normalizeVariableKey,
  validateTemplateVariables,
} from './index';

describe('isInstitutionalEmail', () => {
  it('accepts valid @mejoreferido.cl addresses', () => {
    expect(isInstitutionalEmail('nombre.apellido@mejoreferido.cl')).toBe(true);
    expect(isInstitutionalEmail('napellido@mejoreferido.cl')).toBe(true);
  });

  it('accepts mixed case and surrounding whitespace, normalizing both', () => {
    expect(isInstitutionalEmail('  Nombre.Apellido@MejoReferido.CL  ')).toBe(true);
  });

  it('rejects external domains, including lookalikes', () => {
    expect(isInstitutionalEmail('usuario@gmail.com')).toBe(false);
    expect(isInstitutionalEmail('usuario@cliente.cl')).toBe(false);
    expect(isInstitutionalEmail('usuario@mejoreferido.com')).toBe(false);
    expect(isInstitutionalEmail('usuario@sub.mejoreferido.cl')).toBe(false);
  });

  it('rejects malformed addresses', () => {
    expect(isInstitutionalEmail('mejoreferido.cl')).toBe(false);
    expect(isInstitutionalEmail('a@b@mejoreferido.cl')).toBe(false);
    expect(isInstitutionalEmail('@mejoreferido.cl')).toBe(false);
  });
});

describe('normalizeInstitutionalEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeInstitutionalEmail('  Nombre.Apellido@MejoReferido.CL  ')).toBe(
      'nombre.apellido@mejoreferido.cl',
    );
  });
});

describe('validateTemplateVariables', () => {
  it('accepts text with no variables at all', () => {
    const result = validateTemplateVariables('Hola, este es un mensaje sin variables.');

    expect(result.valid).toBe(true);
    expect(result.variables).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('extracts well-formed variables in first-seen order, deduplicated', () => {
    const result = validateTemplateVariables(
      'Hola {nombre}, gracias por tu interés en {empresa}. Saludos, {nombre}.',
    );

    expect(result.valid).toBe(true);
    expect(result.variables).toEqual(['nombre', 'empresa']);
  });

  it('allows underscores and digits after the first character', () => {
    const result = validateTemplateVariables('{nombre_2} {_privado}');

    expect(result.valid).toBe(true);
    expect(result.variables).toEqual(['nombre_2', '_privado']);
  });

  it('allows a dot-namespaced system variable', () => {
    const result = validateTemplateVariables('{sender.name} — {mailbox.email}');

    expect(result.valid).toBe(true);
    expect(result.variables).toEqual(['sender.name', 'mailbox.email']);
  });

  it('rejects a variable name starting with a digit', () => {
    const result = validateTemplateVariables('Hola {1nombre}.');

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('1nombre');
  });

  it('rejects leading/trailing whitespace inside the braces', () => {
    const result = validateTemplateVariables('Hola { nombre }.');

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('rejects a variable name containing spaces or punctuation', () => {
    const result = validateTemplateVariables('Hola {Nombre Contacto}.');

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('rejects unbalanced braces', () => {
    const result = validateTemplateVariables('Hola {nombre, bienvenido.');

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('sin cerrar'))).toBe(true);
  });

  it('rejects the old double-brace format outright', () => {
    const result = validateTemplateVariables('Hola {{nombre}}, bienvenido.');

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('no soportado'))).toBe(true);
  });

  it('reports every malformed token, not just the first', () => {
    const result = validateTemplateVariables('{1bad} y también {otro malo}');

    expect(result.errors).toHaveLength(2);
  });

  it('extractTemplateVariables returns only the names, ignoring errors', () => {
    expect(extractTemplateVariables('Hola {nombre}, de {empresa}')).toEqual(['nombre', 'empresa']);
  });
});

describe('normalizeVariableKey', () => {
  it('lowercases and trims', () => {
    expect(normalizeVariableKey('  Rubro_Empresa  ')).toBe('rubro_empresa');
  });
});

describe('isValidVariableKey', () => {
  it('accepts every valid example from the spec', () => {
    expect(isValidVariableKey('empresa')).toBe(true);
    expect(isValidVariableKey('nombre')).toBe(true);
    expect(isValidVariableKey('apellido')).toBe(true);
    expect(isValidVariableKey('cargo')).toBe(true);
    expect(isValidVariableKey('rubro_empresa')).toBe(true);
  });

  it('accepts underscores and digits after the first character', () => {
    expect(isValidVariableKey('nombre_2')).toBe(true);
    expect(isValidVariableKey('_privado')).toBe(true);
  });

  it('rejects a key starting with a digit', () => {
    expect(isValidVariableKey('1nombre')).toBe(false);
  });

  it('rejects a key with spaces or punctuation', () => {
    expect(isValidVariableKey('nombre completo')).toBe(false);
    expect(isValidVariableKey('nombre-completo')).toBe(false);
  });

  it('rejects uppercase letters — a key must already be normalized', () => {
    expect(isValidVariableKey('Nombre')).toBe(false);
  });

  it('rejects a dotted/namespaced key — custom catalog variables are always bare', () => {
    expect(isValidVariableKey('sender.name')).toBe(false);
  });

  it('rejects reserved system-namespace roots', () => {
    expect(isValidVariableKey('sender')).toBe(false);
    expect(isValidVariableKey('mailbox')).toBe(false);
    expect(isValidVariableKey('contact')).toBe(false);
  });

  it('rejects an empty key', () => {
    expect(isValidVariableKey('')).toBe(false);
  });
});
