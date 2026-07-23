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
});
