const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLibDocument, rgb, StandardFonts } = require('pdf-lib');
const { decodeHtmlEntities } = require('../utils/htmlDecode');

const PAGE_SIZES = {
  letter: [612, 792],
  a4: [595.28, 841.89],
  legal: [612, 1008]
};

const DEFAULT_DOCUMENT_STYLE = {
  pageSize: 'letter',
  fontSize: 10,
  lineHeight: 1.45,
  textColor: '#1f2937',
  backgroundColor: '#ffffff',
  accentColor: '#2563eb',
  marginX: 54,
  marginY: 54
};

function normalizeText(value = '') {
  return decodeHtmlEntities(String(value ?? ''))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function replaceVariables(value = '', variables = {}) {
  return String(value ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => {
    const parts = key.split('.');
    const resolved = parts.reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), variables);
    return resolved === undefined || resolved === null ? '' : String(resolved);
  });
}

function createDefaultBlocks(title) {
  return [
    {
      id: 'heading-default',
      type: 'heading',
      content: { text: title || 'Onboarding document' }
    },
    {
      id: 'text-default',
      type: 'text',
      content: { text: 'Add your onboarding document content here.' }
    }
  ];
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeHexColor(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed) ? trimmed : fallback;
}

function getDocumentStyle(variables = {}) {
  const saved = variables && typeof variables.documentStyle === 'object' && variables.documentStyle
    ? variables.documentStyle
    : {};

  const pageSize = PAGE_SIZES[saved.pageSize] ? saved.pageSize : DEFAULT_DOCUMENT_STYLE.pageSize;

  return {
    pageSize,
    fontSize: clampNumber(saved.fontSize, 9, 28, DEFAULT_DOCUMENT_STYLE.fontSize),
    lineHeight: clampNumber(saved.lineHeight, 1, 2.4, DEFAULT_DOCUMENT_STYLE.lineHeight),
    textColor: normalizeHexColor(saved.textColor, DEFAULT_DOCUMENT_STYLE.textColor),
    backgroundColor: normalizeHexColor(saved.backgroundColor, DEFAULT_DOCUMENT_STYLE.backgroundColor),
    accentColor: normalizeHexColor(saved.accentColor, DEFAULT_DOCUMENT_STYLE.accentColor),
    marginX: clampNumber(saved.marginX, 16, 96, DEFAULT_DOCUMENT_STYLE.marginX),
    marginY: clampNumber(saved.marginY, 16, 120, DEFAULT_DOCUMENT_STYLE.marginY)
  };
}

function getBlockStyle(block = {}) {
  const style = block && typeof block.style === 'object' && block.style ? block.style : {};
  const align = ['left', 'center', 'right', 'justify'].includes(style.align) ? style.align : undefined;

  return {
    align,
    color: normalizeHexColor(style.color, undefined),
    backgroundColor: normalizeHexColor(style.backgroundColor, undefined),
    borderColor: normalizeHexColor(style.borderColor, undefined),
    borderWidth: clampNumber(style.borderWidth, 0, 8, 0),
    borderRadius: clampNumber(style.borderRadius, 0, 32, 0),
    fontSize: style.fontSize === undefined ? undefined : clampNumber(style.fontSize, 8, 48, undefined),
    lineHeight: style.lineHeight === undefined ? undefined : clampNumber(style.lineHeight, 1, 2.4, undefined),
    fontWeight: style.fontWeight,
    padding: clampNumber(style.padding, 0, 48, 0)
  };
}

function isBoldWeight(weight) {
  return ['bold', '600', '700', '800', '900'].includes(String(weight || '').toLowerCase());
}

function fontNameForStyle(style, boldFallback = false) {
  return isBoldWeight(style.fontWeight) || boldFallback ? 'Helvetica-Bold' : 'Helvetica';
}

function lineGapFor(fontSize, lineHeight) {
  return Math.max(0, fontSize * lineHeight - fontSize);
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function ensureSpace(doc, requiredHeight) {
  if (doc.y + requiredHeight > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function drawPageBackground(doc, documentStyle) {
  if (documentStyle.backgroundColor === '#ffffff') return;
  doc.save()
    .rect(0, 0, doc.page.width, doc.page.height)
    .fill(documentStyle.backgroundColor)
    .restore();
}

function drawBox(doc, x, y, width, height, style) {
  const hasBackground = style.backgroundColor && style.backgroundColor !== '#ffffff';
  const hasBorder = style.borderWidth > 0;
  if (!hasBackground && !hasBorder) return;

  doc.save();

  if (hasBackground) {
    const fillPath = style.borderRadius > 0
      ? doc.roundedRect(x, y, width, height, style.borderRadius)
      : doc.rect(x, y, width, height);
    fillPath.fill(style.backgroundColor);
  }

  if (hasBorder) {
    const strokePath = style.borderRadius > 0
      ? doc.roundedRect(x, y, width, height, style.borderRadius)
      : doc.rect(x, y, width, height);
    strokePath
      .lineWidth(style.borderWidth)
      .stroke(style.borderColor || '#d1d5db');
  }

  doc.restore();
}

function drawStyledText(doc, text, style, documentStyle, options = {}) {
  const fontSize = style.fontSize || options.fontSize || documentStyle.fontSize;
  const font = fontNameForStyle(style, Boolean(options.bold));
  const lineGap = lineGapFor(fontSize, style.lineHeight || documentStyle.lineHeight);
  const x = doc.page.margins.left;
  const width = contentWidth(doc);
  const padding = style.padding || 0;
  const textOptions = {
    width: Math.max(40, width - padding * 2),
    lineGap,
    align: style.align || options.align || 'left'
  };

  doc.font(font).fontSize(fontSize);
  const height = doc.heightOfString(text || ' ', textOptions) + padding * 2;
  ensureSpace(doc, height);

  const y = doc.y;
  drawBox(doc, x, y, width, height, style);
  doc.font(font).fontSize(fontSize).fillColor(style.color || options.color || documentStyle.textColor)
    .text(text || ' ', x + padding, y + padding, textOptions);
  doc.y = y + height;
  doc.moveDown(options.moveDown ?? 0.7);
}

function drawSection(doc, titleText, bodyText, style, documentStyle) {
  const fontSize = style.fontSize || documentStyle.fontSize;
  const titleFontSize = Math.max(fontSize + 1, 12);
  const lineGap = lineGapFor(fontSize, style.lineHeight || documentStyle.lineHeight);
  const x = doc.page.margins.left;
  const width = contentWidth(doc);
  const padding = style.padding || 0;
  const align = style.align || 'left';
  const textWidth = Math.max(40, width - padding * 2);

  doc.font('Helvetica-Bold').fontSize(titleFontSize);
  const titleHeight = doc.heightOfString(titleText || 'Section', { width: textWidth, lineGap: 2, align });
  doc.font(fontNameForStyle(style)).fontSize(fontSize);
  const bodyHeight = bodyText ? doc.heightOfString(bodyText, { width: textWidth, lineGap, align }) : 0;
  const gap = bodyText ? 6 : 0;
  const height = titleHeight + gap + bodyHeight + padding * 2;

  ensureSpace(doc, height);
  const y = doc.y;
  drawBox(doc, x, y, width, height, style);
  doc.font('Helvetica-Bold').fontSize(titleFontSize).fillColor(style.color || documentStyle.textColor)
    .text(titleText || 'Section', x + padding, y + padding, { width: textWidth, lineGap: 2, align });

  if (bodyText) {
    doc.font(fontNameForStyle(style)).fontSize(fontSize).fillColor(style.color || documentStyle.textColor)
      .text(bodyText, x + padding, y + padding + titleHeight + gap, { width: textWidth, lineGap, align });
  }

  doc.y = y + height;
  doc.moveDown(0.8);
}

function drawSignatureBlock(doc, label, style, documentStyle) {
  const fontSize = style.fontSize || documentStyle.fontSize;
  const x = doc.page.margins.left;
  const width = contentWidth(doc);
  const padding = style.padding || 0;
  const lineWidth = Math.min(220, Math.max(80, width - padding * 2));
  const align = style.align || 'left';
  const lineX = align === 'center'
    ? x + (width - lineWidth) / 2
    : align === 'right'
      ? x + width - padding - lineWidth
      : x + padding;
  const height = padding * 2 + fontSize + 38;

  ensureSpace(doc, height);
  const y = doc.y;
  drawBox(doc, x, y, width, height, style);

  const lineY = y + padding + 18;
  doc.moveTo(lineX, lineY)
    .lineTo(lineX + lineWidth, lineY)
    .stroke(style.borderColor || '#6b7280');
  doc.font(fontNameForStyle(style)).fontSize(fontSize).fillColor(style.color || documentStyle.textColor)
    .text(label || 'Signature', x + padding, lineY + 8, {
      width: Math.max(40, width - padding * 2),
      align
    });
  doc.y = y + height;
  doc.moveDown(0.5);
}

function drawSpacer(doc, requestedHeight) {
  let remaining = clampNumber(requestedHeight, 8, 600, 48);

  while (remaining > 0) {
    const available = doc.page.height - doc.page.margins.bottom - doc.y;
    if (available <= 0) {
      doc.addPage();
      continue;
    }

    const step = Math.min(remaining, available);
    doc.y += step;
    remaining -= step;
    if (remaining > 0) doc.addPage();
  }
}

function parseImageDataUrl(value) {
  if (!value || typeof value !== 'string') return null;

  const match = value.match(/^data:(image\/png|image\/jpeg|image\/jpg);base64,([\s\S]+)$/);
  if (!match) return null;

  try {
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

function drawLogoBlock(doc, block, style, documentStyle, variables) {
  const imageBuffer = parseImageDataUrl(block.content?.src || block.content?.url);

  if (!imageBuffer) {
    const text = normalizeText(replaceVariables(block.content?.alt || block.content?.text || 'Company logo', variables));
    drawStyledText(doc, text, style, documentStyle, {
      bold: true,
      fontSize: 11,
      color: '#111827',
      moveDown: 0.6
    });
    return;
  }

  const x = doc.page.margins.left;
  const width = contentWidth(doc);
  const padding = style.padding || 0;
  const maxImageWidth = Math.max(24, width - padding * 2);
  const imageWidth = Math.min(clampNumber(block.content?.width, 32, 420, 160), maxImageWidth);
  const imageHeight = clampNumber(block.content?.height, 24, 240, 64);
  const align = style.align || 'left';
  const imageX = align === 'center'
    ? x + (width - imageWidth) / 2
    : align === 'right'
      ? x + width - padding - imageWidth
      : x + padding;
  const blockHeight = imageHeight + padding * 2;

  ensureSpace(doc, blockHeight);
  const y = doc.y;
  drawBox(doc, x, y, width, blockHeight, style);
  doc.image(imageBuffer, imageX, y + padding, {
    fit: [imageWidth, imageHeight],
    align
  });
  doc.y = y + blockHeight;
  doc.moveDown(0.6);
}

function drawTable(doc, rows = [], style = {}, documentStyle = DEFAULT_DOCUMENT_STYLE) {
  const safeRows = Array.isArray(rows) && rows.length ? rows : [
    ['Field', 'Value'],
    ['Candidate', '{{candidate.name}}']
  ];
  const startX = doc.page.margins.left;
  const width = contentWidth(doc);
  const fontSize = style.fontSize || Math.max(9, documentStyle.fontSize - 1);
  const padding = style.padding || 8;
  const columnWidth = width / Math.max(safeRows[0]?.length || 2, 1);
  const rowHeight = Math.max(28, fontSize + padding * 2);

  safeRows.forEach((row) => {
    const y = doc.y;
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    row.forEach((cell, cellIndex) => {
      const cellX = startX + cellIndex * columnWidth;
      if (style.backgroundColor && style.backgroundColor !== '#ffffff') {
        doc.rect(cellX, doc.y, columnWidth, rowHeight).fill(style.backgroundColor);
      }
      doc.rect(cellX, doc.y, columnWidth, rowHeight).lineWidth(style.borderWidth || 1).stroke(style.borderColor || '#d1d5db');
      doc.font(fontNameForStyle(style)).fontSize(fontSize).fillColor(style.color || documentStyle.textColor).text(String(cell || ''), cellX + padding, doc.y + padding, {
        width: Math.max(24, columnWidth - padding * 2),
        align: style.align || 'left',
        lineBreak: false
      });
    });
    doc.y = y + rowHeight;
  });
  doc.moveDown(0.8);
}

async function renderBuilderDocumentToBuffer({ title, builderBlocks = [], variables = {} }) {
  const blocks = builderBlocks.length ? builderBlocks : createDefaultBlocks(title);
  const documentStyle = getDocumentStyle(variables);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: PAGE_SIZES[documentStyle.pageSize] || PAGE_SIZES.letter,
        margins: {
          top: documentStyle.marginY,
          bottom: documentStyle.marginY,
          left: documentStyle.marginX,
          right: documentStyle.marginX
        },
        info: {
          Title: normalizeText(title || 'Onboarding document'),
          Author: 'Seemplify Recruiter'
        }
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.on('pageAdded', () => drawPageBackground(doc, documentStyle));

      drawPageBackground(doc, documentStyle);

      blocks.forEach((block) => {
        const style = getBlockStyle(block);

        if (block.type === 'pageBreak') {
          doc.addPage();
          return;
        }

        if (block.type === 'spacer') {
          drawSpacer(doc, block.content?.height);
          return;
        }

        if (block.type === 'heading') {
          const text = normalizeText(replaceVariables(block.content?.text || block.content?.title || title, variables));
          doc.moveDown(0.2);
          drawStyledText(doc, text || 'Untitled document', style, documentStyle, {
            bold: true,
            fontSize: 18,
            color: '#111827',
            moveDown: 0.8
          });
          return;
        }

        if (block.type === 'section') {
          const titleText = normalizeText(replaceVariables(block.content?.title || 'Section', variables));
          const bodyText = normalizeText(replaceVariables(block.content?.text || block.content?.body || '', variables));
          drawSection(doc, titleText, bodyText, style, documentStyle);
          return;
        }

        if (block.type === 'table') {
          const rows = (block.content?.rows || []).map((row) =>
            row.map((cell) => normalizeText(replaceVariables(cell, variables)))
          );
          drawTable(doc, rows, style, documentStyle);
          return;
        }

        if (block.type === 'signature') {
          const label = normalizeText(replaceVariables(block.content?.label || 'Signature', variables));
          doc.moveDown(0.8);
          drawSignatureBlock(doc, label, style, documentStyle);
          return;
        }

        if (block.type === 'logo') {
          drawLogoBlock(doc, block, style, documentStyle, variables);
          return;
        }

        const text = normalizeText(replaceVariables(block.content?.text || block.content?.body || '', variables));
        if (text) {
          drawStyledText(doc, text, style, documentStyle, {
            color: documentStyle.textColor,
            moveDown: 0.7
          });
        }
      });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function downloadPdfBuffer(url) {
  if (!url) {
    throw new Error('PDF URL is required');
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download PDF: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function parseSignatureData(signatureDataUrl) {
  if (!signatureDataUrl || typeof signatureDataUrl !== 'string') {
    return null;
  }

  const match = signatureDataUrl.match(/^data:(image\/png|image\/jpeg|image\/jpg);base64,(.+)$/);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    bytes: Buffer.from(match[2], 'base64')
  };
}

function fieldRect(field, page) {
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const width = Math.max(20, Math.min(pageWidth, Number(field.width || 0.25) * pageWidth));
  const height = Math.max(14, Math.min(pageHeight, Number(field.height || 0.08) * pageHeight));
  const x = Math.max(0, Math.min(pageWidth - width, Number(field.x || 0.1) * pageWidth));
  const yFromTop = Math.max(0, Math.min(pageHeight - height, Number(field.y || 0.1) * pageHeight));
  const y = pageHeight - yFromTop - height;
  return { x, y, width, height };
}

async function stampSignedPdf({
  pdfUrl,
  pdfBuffer,
  signatureFields = [],
  signer,
  signerRole = 'candidate',
  signerKey,
  signatureDataUrl,
  signedAt = new Date(),
  auditText
}) {
  const sourceBuffer = pdfBuffer || await downloadPdfBuffer(pdfUrl);
  const pdfDoc = await PdfLibDocument.load(sourceBuffer);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const signatureImage = parseSignatureData(signatureDataUrl);
  const embeddedSignature = signatureImage
    ? signatureImage.mimeType.includes('jpeg') || signatureImage.mimeType.includes('jpg')
      ? await pdfDoc.embedJpg(signatureImage.bytes)
      : await pdfDoc.embedPng(signatureImage.bytes)
    : null;

  const pages = pdfDoc.getPages();
  const signerName = signer?.name || signer?.email || 'Signer';
  const signerEmail = signer?.email || '';
  const dateText = new Date(signedAt).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  signatureFields
    .filter((field) => {
      if (signerKey && field.signerKey) return field.signerKey === signerKey;
      return (field.role || 'candidate') === signerRole;
    })
    .forEach((field) => {
      const page = pages[Math.max(0, Number(field.page || 1) - 1)];
      if (!page) return;

      const rect = fieldRect(field, page);
      page.drawRectangle({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        borderColor: rgb(0.15, 0.2, 0.32),
        borderWidth: 0.4,
        color: rgb(1, 1, 1),
        opacity: 0.02
      });

      if (field.type === 'signature' && embeddedSignature) {
        page.drawImage(embeddedSignature, {
          x: rect.x + 4,
          y: rect.y + 4,
          width: rect.width - 8,
          height: rect.height - 8
        });
        return;
      }

      const value = field.type === 'date'
        ? dateText
        : field.type === 'email'
          ? signerEmail
          : field.type === 'name'
            ? signerName
            : field.type === 'signature'
              ? signerName
              : field.label || signerName;

      page.drawText(String(value).slice(0, 120), {
        x: rect.x + 5,
        y: rect.y + Math.max(4, rect.height / 2 - 5),
        size: Math.min(11, Math.max(7, rect.height * 0.32)),
        font: field.type === 'signature' ? helveticaBold : helvetica,
        color: rgb(0.07, 0.1, 0.18)
      });
    });

  const lastPage = pages[pages.length - 1];
  if (lastPage && auditText) {
    lastPage.drawText(String(auditText).slice(0, 220), {
      x: 36,
      y: 24,
      size: 7,
      font: helvetica,
      color: rgb(0.37, 0.42, 0.5)
    });
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

module.exports = {
  renderBuilderDocumentToBuffer,
  stampSignedPdf,
  downloadPdfBuffer,
  replaceVariables
};
