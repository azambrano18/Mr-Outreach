import { htmlToPlainText } from './html-to-plain-text';

describe('htmlToPlainText', () => {
  it('converts <br> and block-closing tags into newlines', () => {
    expect(htmlToPlainText('<p>Línea 1<br>Línea 2</p><p>Línea 3</p>')).toBe(
      'Línea 1\nLínea 2\nLínea 3',
    );
  });

  it('strips remaining tags and decodes common entities', () => {
    expect(htmlToPlainText('<p>A &amp; B &lt;tag&gt; &quot;x&quot;</p>')).toBe('A & B <tag> "x"');
  });

  it('turns list items into dashed lines', () => {
    expect(htmlToPlainText('<ul><li>uno</li><li>dos</li></ul>')).toBe('- uno\n- dos');
  });

  it('collapses excessive blank lines', () => {
    expect(htmlToPlainText('<p>A</p><p></p><p></p><p>B</p>')).not.toMatch(/\n{3,}/);
  });
});
