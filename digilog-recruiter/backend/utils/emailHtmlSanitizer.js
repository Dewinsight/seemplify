const BLOCKED_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'meta',
  'link',
  'base',
  'svg',
  'math'
];

const DANGEROUS_PROTOCOL_REGEX = /^(javascript|vbscript|file|data:text\/html)/i;

const isHtmlLike = (value = '') => /<\/?[a-z][\s\S]*>/i.test(String(value));

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const sanitizeStyleValue = (styleValue = '') => {
  const cleaned = String(styleValue)
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/url\s*\(\s*['"]?\s*javascript:[^)]+\)/gi, '')
    .replace(/-moz-binding\s*:[^;]+;?/gi, '')
    .replace(/behaviou?r\s*:[^;]+;?/gi, '')
    .trim();

  return cleaned;
};

const sanitizeEmailHtml = (htmlInput = '') => {
  let html = String(htmlInput || '');

  if (!html) {
    return '';
  }

  html = html
    .replace(/\u0000/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  BLOCKED_TAGS.forEach((tag) => {
    const blockRegex = new RegExp(`<\\s*${tag}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${tag}\\s*>`, 'gi');
    const singleRegex = new RegExp(`<\\s*\\/?\\s*${tag}\\b[^>]*>`, 'gi');
    html = html.replace(blockRegex, '').replace(singleRegex, '');
  });

  html = html.replace(/\s(on[a-z]+|xmlns(:[a-z]+)?)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  html = html.replace(/\sstyle\s*=\s*(['"])([\s\S]*?)\1/gi, (_match, quote, styleValue) => {
    const cleanedStyle = sanitizeStyleValue(styleValue);
    return cleanedStyle ? ` style=${quote}${cleanedStyle}${quote}` : '';
  });

  html = html.replace(/\s(href|src|background|action|formaction)\s*=\s*(['"])([\s\S]*?)\2/gi, (_match, attr, quote, value) => {
    const normalizedValue = String(value || '').trim().replace(/[\u0000-\u001F\u007F]+/g, '');
    if (DANGEROUS_PROTOCOL_REGEX.test(normalizedValue)) {
      return ` ${attr}=${quote}#${quote}`;
    }
    return ` ${attr}=${quote}${normalizedValue}${quote}`;
  });

  return html.trim();
};

const plainTextToEmailHtml = (textInput = '') =>
  escapeHtml(String(textInput || ''))
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '<br>');

const htmlToText = (htmlInput = '') =>
  String(htmlInput || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n\n')
    .replace(/<\s*\/div\s*>/gi, '\n')
    .replace(/<\s*\/li\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();

module.exports = {
  isHtmlLike,
  escapeHtml,
  sanitizeEmailHtml,
  plainTextToEmailHtml,
  htmlToText
};
