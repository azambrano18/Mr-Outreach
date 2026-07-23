import sanitizeHtml from 'sanitize-html';

/**
 * Client-side safety net only — the server (HtmlSanitizerService) is the
 * source of truth and re-sanitizes on every save regardless. This runs
 * when switching from the raw HTML source view back to the visual editor,
 * so a user who hand-typed a <script> tag never even sees it render.
 * Mirrors the backend allowlist (apps/api/src/infrastructure/security/html-sanitizer.service.ts).
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
};

export function sanitizeRichTextHtml(html: string): string {
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
  });
}
