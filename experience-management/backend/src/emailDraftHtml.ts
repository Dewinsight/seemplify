import sanitizeHtml from 'sanitize-html';

const allowedTags = ['p', 'br', 'strong', 'em', 's', 'ul', 'ol', 'li', 'blockquote', 'a'];

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function emailDraftPlainText(value: unknown) {
  const input = String(value || '');
  if (!/<[a-z][\s\S]*>/iu.test(input)) return input.replace(/\r\n?/gu, '\n').trim();
  return sanitizeHtml(input
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/(?:p|div|blockquote|li)>/giu, '\n'), {
    allowedTags: [], allowedAttributes: {}
  }).replace(/\n{3,}/gu, '\n\n').trim();
}

export function normalizeEmailDraftHtml(value: unknown) {
  const input = String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim();
  const html = /<(?:p|br|strong|em|s|ul|ol|li|blockquote|a)\b[^>]*>/iu.test(input)
    ? input
    : input.split(/\r?\n\s*\r?\n/gu).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\r?\n/gu, '<br>')}</p>`).join('');
  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: 'a',
        attribs: { href: attributes.href || '', target: '_blank', rel: 'noopener noreferrer' }
      })
    }
  }).trim();
}
