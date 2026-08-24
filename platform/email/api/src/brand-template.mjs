const BRAND = Object.freeze({
  canvas: '#0f0e13',
  surface: '#fffdfa',
  text: '#191816',
  muted: '#625e57',
  line: '#ded8cf',
  accent: '#7047eb',
  accentSoft: '#f3f0ff',
  footer: '#a59eac',
  logoUrl: 'https://auth.seemplifyai.com/images/seemplifylogo.png',
});

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeEmailHtml(value = '') {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

function extractBody(html = '') {
  const match = String(html).match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[1].trim() : String(html).trim();
}

function shouldPreserve(html = '') {
  return /data-seemplify-email-shell/i.test(html) ||
    /data-seemplify-preserve-style\s*=\s*['"]true['"]/i.test(html) ||
    /<meta[^>]+name\s*=\s*['"]x-seemplify-email-style['"][^>]+content\s*=\s*['"]preserve['"]/i.test(html);
}

function serviceLabel(fromName = '', tag = '') {
  const name = String(fromName || '').trim();
  if (name && !/^seemplify(?: mail)?$/i.test(name)) return name.slice(0, 80);
  const normalizedTag = String(tag || '').trim().replace(/[._-]+/g, ' ');
  if (!normalizedTag) return 'Seemplify';
  return normalizedTag.replace(/\b\w/g, (character) => character.toUpperCase()).slice(0, 80);
}

/**
 * Adds one email-client-safe Seemplify frame around transactional HTML.
 * Product-specific content remains intact inside the frame. Callers with an
 * intentionally complete design can opt out with data-seemplify-preserve-style.
 */
export function renderBrandedTransactionalHtml({ html, subject, fromName, tag } = {}) {
  if (!html) return null;
  const sanitized = sanitizeEmailHtml(html);
  if (shouldPreserve(sanitized)) return sanitized;

  const content = extractBody(sanitized);
  const label = escapeHtml(serviceLabel(fromName, tag));
  const preheader = escapeHtml(String(subject || '').trim().slice(0, 160));

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(subject || 'Seemplify')}</title>
    <style>
      body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
      table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
      img { -ms-interpolation-mode:bicubic; }
      .seemplify-content h1, .seemplify-content h2, .seemplify-content h3 { color:${BRAND.text}; font-family:Arial,Helvetica,sans-serif; letter-spacing:-0.02em; }
      .seemplify-content h1 { margin:0 0 18px; font-size:30px; line-height:38px; }
      .seemplify-content h2 { margin:0 0 16px; font-size:24px; line-height:31px; }
      .seemplify-content h3 { margin:0 0 12px; font-size:19px; line-height:26px; }
      .seemplify-content p, .seemplify-content li, .seemplify-content td { color:${BRAND.muted}; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; }
      .seemplify-content p { margin:0 0 16px; }
      .seemplify-content a { color:${BRAND.accent}; font-weight:700; }
      .seemplify-content > a, .seemplify-content p > a:only-child { display:inline-block; padding:11px 17px; border-radius:8px; background:${BRAND.accent}; color:#ffffff !important; text-decoration:none; }
      .seemplify-content code { border-radius:6px; background:${BRAND.accentSoft}; padding:3px 6px; color:${BRAND.text}; }
      @media screen and (max-width:660px) { .seemplify-shell { width:100% !important; } .seemplify-pad { padding-left:18px !important; padding-right:18px !important; } }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.canvas};">
    ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ''}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${BRAND.canvas}" style="background:${BRAND.canvas};">
      <tr>
        <td align="center" class="seemplify-pad" style="padding:28px 18px 44px;">
          <table role="presentation" width="620" class="seemplify-shell" cellspacing="0" cellpadding="0" border="0" data-seemplify-email-shell="transactional" style="width:620px;max-width:620px;">
            <tr>
              <td style="padding:0 4px 18px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td align="left">
                      <img src="${BRAND.logoUrl}" width="142" alt="Seemplify" style="display:block;width:142px;max-width:142px;height:auto;border:0;" />
                    </td>
                    <td align="right" style="color:${BRAND.footer};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;">
                      People operations, connected.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td bgcolor="${BRAND.surface}" style="border:1px solid ${BRAND.line};border-top:4px solid ${BRAND.accent};border-radius:10px;background:${BRAND.surface};padding:34px 36px;">
                <div style="margin:0 0 20px;color:${BRAND.accent};font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.1em;line-height:18px;text-transform:uppercase;">${label}</div>
                <div class="seemplify-content">${content}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 12px 0;color:${BRAND.muted};font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:18px;text-align:center;">
                This is an automated service message from Seemplify. If you did not expect it, contact your organisation administrator.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export { sanitizeEmailHtml };
