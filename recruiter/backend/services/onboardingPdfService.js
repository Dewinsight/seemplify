const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLibDocument, rgb, StandardFonts } = require('pdf-lib');
const { decodeHtmlEntities } = require('../utils/htmlDecode');

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN = 54;

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

function drawTable(doc, rows = []) {
  const safeRows = Array.isArray(rows) && rows.length ? rows : [
    ['Field', 'Value'],
    ['Candidate', '{{candidate.name}}']
  ];
  const startX = PAGE_MARGIN;
  const columnWidth = (PAGE_WIDTH - PAGE_MARGIN * 2) / Math.max(safeRows[0]?.length || 2, 1);
  const rowHeight = 28;

  safeRows.forEach((row) => {
    const y = doc.y;
    if (y + rowHeight > PAGE_HEIGHT - PAGE_MARGIN) {
      doc.addPage();
    }
    row.forEach((cell, cellIndex) => {
      doc.rect(startX + cellIndex * columnWidth, doc.y, columnWidth, rowHeight).stroke('#d1d5db');
      doc.fontSize(9).fillColor('#111827').text(String(cell || ''), startX + cellIndex * columnWidth + 8, doc.y + 8, {
        width: columnWidth - 16,
        lineBreak: false
      });
    });
    doc.y = y + rowHeight;
  });
  doc.moveDown(0.8);
}

async function renderBuilderDocumentToBuffer({ title, builderBlocks = [], variables = {} }) {
  const blocks = builderBlocks.length ? builderBlocks : createDefaultBlocks(title);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margin: PAGE_MARGIN,
        info: {
          Title: normalizeText(title || 'Onboarding document'),
          Author: 'Seemplify Recruiter'
        }
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      blocks.forEach((block) => {
        if (block.type === 'pageBreak') {
          doc.addPage();
          return;
        }

        if (block.type === 'heading') {
          const text = normalizeText(replaceVariables(block.content?.text || block.content?.title || title, variables));
          doc.moveDown(0.2);
          doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827').text(text || 'Untitled document', {
            lineGap: 4
          });
          doc.moveDown(0.8);
          return;
        }

        if (block.type === 'section') {
          const titleText = normalizeText(replaceVariables(block.content?.title || 'Section', variables));
          const bodyText = normalizeText(replaceVariables(block.content?.text || block.content?.body || '', variables));
          doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text(titleText);
          doc.moveDown(0.25);
          if (bodyText) {
            doc.font('Helvetica').fontSize(10).fillColor('#374151').text(bodyText, { lineGap: 3 });
          }
          doc.moveDown(0.8);
          return;
        }

        if (block.type === 'table') {
          const rows = (block.content?.rows || []).map((row) =>
            row.map((cell) => normalizeText(replaceVariables(cell, variables)))
          );
          drawTable(doc, rows);
          return;
        }

        if (block.type === 'signature') {
          const label = normalizeText(replaceVariables(block.content?.label || 'Signature', variables));
          doc.moveDown(0.8);
          doc.font('Helvetica').fontSize(10).fillColor('#374151').text(label);
          const y = doc.y + 10;
          doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + 220, y).stroke('#6b7280');
          doc.y = y + 18;
          return;
        }

        if (block.type === 'logo') {
          const text = normalizeText(replaceVariables(block.content?.alt || block.content?.text || 'Company logo', variables));
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(text);
          doc.moveDown(0.6);
          return;
        }

        const text = normalizeText(replaceVariables(block.content?.text || block.content?.body || '', variables));
        if (text) {
          doc.font('Helvetica').fontSize(10).fillColor('#1f2937').text(text, {
            lineGap: 4
          });
          doc.moveDown(0.7);
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
    .filter((field) => (field.role || 'candidate') === signerRole)
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
