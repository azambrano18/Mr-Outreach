import { Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';

/**
 * Signature/step HTML is authored through a rich-text editor (Tiptap) but
 * can also be typed by hand in the "HTML source" view — this is the
 * server-side enforcement that matters (the frontend sanitizes too, but
 * only as a UX nicety; this is the one that can't be bypassed). Allowlist
 * mirrors the request's section 8: tags, attributes, and a set of inline
 * styles that survive most email clients (see README > "Compatibilidad
 * de firmas con clientes de correo").
 */
const ALLOWED_TAGS = [
  'p',
  'div',
  'span',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'a',
  'img',
  'table',
  'tbody',
  'tr',
  'td',
  'ul',
  'ol',
  'li',
  'hr',
];

const ALLOWED_STYLES: Record<string, RegExp[]> = {
  color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(.*\)$/],
  'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(.*\)$/],
  'text-align': [/^(left|center|right|justify)$/],
  'font-family': [/^[\w\s,'"-]+$/],
  'font-size': [/^\d+(\.\d+)?(px|pt|em|rem|%)$/],
  'font-weight': [/^(normal|bold|\d+)$/],
  'font-style': [/^(normal|italic)$/],
  'text-decoration': [/^(none|underline|line-through)$/],
  padding: [/^[\d.]+(px|em|%)?(\s+[\d.]+(px|em|%)?){0,3}$/],
  margin: [/^[\d.]+(px|em|%)?(\s+[\d.]+(px|em|%)?){0,3}$/],
  width: [/^[\d.]+(px|%)$/],
  height: [/^[\d.]+(px|%)$/],
  'border-collapse': [/^(collapse|separate)$/],
};

@Injectable()
export class HtmlSanitizerService {
  sanitize(html: string): string {
    return sanitizeHtml(html, {
      allowedTags: ALLOWED_TAGS,
      allowedAttributes: {
        a: ['href', 'target', 'rel'],
        img: ['src', 'alt', 'width', 'height', 'style'],
        '*': ['style'],
      },
      allowedStyles: { '*': ALLOWED_STYLES },
      allowedSchemes: ['http', 'https', 'mailto'],
      allowProtocolRelative: false,
      transformTags: {
        a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
      },
      // No script/iframe/form/object/embed/on* — none are in the
      // allowlist above, so sanitize-html strips them (and their
      // contents, for script) unconditionally.
    });
  }
}
