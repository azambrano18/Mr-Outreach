import { HtmlSanitizerService } from './html-sanitizer.service';

describe('HtmlSanitizerService', () => {
  const sanitizer = new HtmlSanitizerService();

  it('strips <script> tags and their content entirely', () => {
    const result = sanitizer.sanitize('<p>Hola</p><script>alert(1)</script>');

    expect(result).not.toContain('<script>');
    expect(result).not.toContain('alert(1)');
  });

  it('strips inline event handlers like onclick', () => {
    const result = sanitizer.sanitize('<p onclick="alert(1)">Hola</p>');

    expect(result).not.toContain('onclick');
    expect(result).not.toContain('alert(1)');
  });

  it('blocks iframe and form tags', () => {
    const result = sanitizer.sanitize(
      '<iframe src="https://evil.example"></iframe><form action="/x"><input></form>',
    );

    expect(result).not.toContain('<iframe');
    expect(result).not.toContain('<form');
  });

  it('keeps the allowed tag set intact', () => {
    const html =
      '<p><strong>Hola</strong> <em>mundo</em> <a href="https://example.com">enlace</a></p>' +
      '<ul><li>uno</li></ul><img src="https://example.com/logo.png" alt="Logo">';

    const result = sanitizer.sanitize(html);

    expect(result).toContain('<strong>Hola</strong>');
    expect(result).toContain('<em>mundo</em>');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('<li>uno</li>');
    expect(result).toContain('src="https://example.com/logo.png"');
  });

  it('adds rel="noopener noreferrer" to links', () => {
    const result = sanitizer.sanitize('<a href="https://example.com" target="_blank">link</a>');

    expect(result).toContain('rel="noopener noreferrer"');
  });

  it('rejects a javascript: URL on a link', () => {
    const result = sanitizer.sanitize('<a href="javascript:alert(1)">click</a>');

    expect(result).not.toContain('javascript:');
  });

  it('keeps a safe allowed inline style but strips a disallowed CSS property', () => {
    const result = sanitizer.sanitize('<p style="color: #ff0000; position: fixed;">Hola</p>');

    expect(result).toContain('color');
    expect(result).toContain('#ff0000');
    expect(result).not.toContain('position');
  });

  describe('sanitizeSignatureHtml — Fase Firma, §9', () => {
    const host = 'assets.mejoreferido.com';

    it('keeps an https image on the allowed host', () => {
      const result = sanitizer.sanitizeSignatureHtml(
        `<img src="https://${host}/signatures/org_1/user_1/asset_1.png" alt="Logo">`,
        host,
      );
      expect(result).toContain(`https://${host}/signatures/org_1/user_1/asset_1.png`);
    });

    it('strips an image on any other host', () => {
      const result = sanitizer.sanitizeSignatureHtml('<img src="https://evil.example.com/logo.png" alt="Logo">', host);
      expect(result).not.toContain('<img');
      expect(result).not.toContain('evil.example.com');
    });

    it('strips a data: URL image', () => {
      const result = sanitizer.sanitizeSignatureHtml(
        '<img src="data:image/png;base64,iVBORw0KGgo=" alt="Logo">',
        host,
      );
      expect(result).not.toContain('<img');
      expect(result).not.toContain('data:');
    });

    it('strips a blob: URL image', () => {
      const result = sanitizer.sanitizeSignatureHtml(`<img src="blob:https://${host}/uuid" alt="Logo">`, host);
      expect(result).not.toContain('<img');
    });

    it('rejects plain HTTP against the allowed host by default (production/R2 mode)', () => {
      const result = sanitizer.sanitizeSignatureHtml(`<img src="http://${host}/x.png" alt="Logo">`, host);
      expect(result).not.toContain('<img');
    });

    it('allows plain HTTP against the allowed host only when allowInsecureHost is explicitly set (simulated dev mode)', () => {
      const result = sanitizer.sanitizeSignatureHtml(`<img src="http://localhost:3001/uploads/signatures/x.png" alt="Logo">`, 'localhost', true);
      expect(result).toContain('http://localhost:3001/uploads/signatures/x.png');
    });

    it('rejects an image pointing at a private/loopback-looking host even if it happens to match the string (defense in depth: hostname must be an exact match, never a suffix/substring)', () => {
      const result = sanitizer.sanitizeSignatureHtml(`<img src="https://evil-${host}/x.png" alt="Logo">`, host);
      expect(result).not.toContain('<img');
    });

    it('never emits base64/binary content in the sanitized output', () => {
      const result = sanitizer.sanitizeSignatureHtml(
        `<p>Firma</p><img src="https://${host}/signatures/x.png" alt="Logo">`,
        host,
      );
      expect(result).not.toMatch(/base64/);
    });
  });
});
