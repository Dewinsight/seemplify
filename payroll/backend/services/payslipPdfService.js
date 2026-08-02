const PDFDocument = require('pdfkit');

const COLORS = {
  page: '#f4f4f5',
  ink: '#111827',
  text: '#374151',
  muted: '#6b7280',
  line: '#e5e7eb',
  panel: '#ffffff',
  panelAlt: '#f8fafc',
  hero: '#18181b',
  heroSoft: '#27272a',
  brand: '#f59e0b',
  brandSoft: '#fef3c7',
  success: '#059669',
  successSoft: '#d1fae5',
  danger: '#dc2626',
  dangerSoft: '#fee2e2',
  info: '#0369a1',
  infoSoft: '#e0f2fe',
  purple: '#7c3aed',
  purpleSoft: '#ede9fe',
};

const PAGE = {
  margin: 40,
  footerReserve: 36,
};

function pickFirst(source, candidates = []) {
  for (const candidate of candidates) {
    const value = candidate
      .split('.')
      .reduce((current, key) => (current && current[key] !== undefined ? current[key] : undefined), source);

    if (value !== undefined && value !== null && String(value).trim()) {
      return value;
    }
  }

  return '';
}

function safeText(value, fallback = 'N/A') {
  const text = String(value || '').trim();
  return text || fallback;
}

function formatMoney(currency, amount) {
  const numericAmount = Number(amount || 0);
  const code = String(currency || 'USD').trim().toUpperCase() || 'USD';

  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numericAmount);
  } catch (error) {
    return `${code} ${numericAmount.toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

function formatDate(value) {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return 'N/A';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function humanizeValue(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getStatusPalette(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (['paid', 'approved', 'exported'].includes(normalized)) {
    return { fill: COLORS.successSoft, text: COLORS.success };
  }
  if (['disputed', 'cancelled'].includes(normalized)) {
    return { fill: COLORS.dangerSoft, text: COLORS.danger };
  }
  return { fill: COLORS.brandSoft, text: '#92400e' };
}

function getOrganizationName(organization = {}) {
  return safeText(organization?.name || organization?.organizationName || organization?.displayName, 'Seemplify');
}

function getOrganizationId(organization = {}) {
  return safeText(organization?.id || organization?._id || organization?.organizationId, 'N/A');
}

function getOrganizationAddress(organization = {}) {
  const formatted = pickFirst(organization, [
    'address.formatted',
    'registeredAddress.formatted',
    'location.formatted',
  ]);
  if (formatted) return formatted;

  const address = pickFirst(organization, ['address', 'registeredAddress', 'location']);
  if (address && typeof address === 'object') {
    const parts = [
      address.line1,
      address.line2,
      address.street,
      address.city,
      address.state,
      address.postalCode || address.zipCode,
      address.country,
    ].filter((part) => part && String(part).trim());

    if (parts.length > 0) {
      return parts.join(', ');
    }
  }

  return 'N/A';
}

function getOrganizationDetails(organization = {}) {
  return {
    name: getOrganizationName(organization),
    id: getOrganizationId(organization),
    email: safeText(pickFirst(organization, ['email', 'contactEmail', 'supportEmail', 'primaryEmail']), 'N/A'),
    phone: safeText(pickFirst(organization, ['phone', 'phoneNumber', 'contactPhone', 'supportPhone']), 'N/A'),
    website: safeText(pickFirst(organization, ['website', 'websiteUrl', 'portalUrl', 'domain']), 'N/A'),
    registration: safeText(pickFirst(organization, ['registrationNumber', 'registrationId', 'companyNumber']), 'N/A'),
    taxReference: safeText(pickFirst(organization, ['taxId', 'taxNumber', 'tin', 'vatNumber']), 'N/A'),
    address: getOrganizationAddress(organization),
  };
}

function getAccountPreview(bankAccount = {}) {
  const accountNumber = String(bankAccount?.accountNumber || '').trim();
  if (!accountNumber) return 'On file';
  if (accountNumber.includes('*')) return accountNumber;
  return `****${accountNumber.slice(-4)}`;
}

function ensureSpace(doc, state, height) {
  const bottomBoundary = doc.page.height - PAGE.margin - PAGE.footerReserve;
  if (doc.y + height <= bottomBoundary) return;
  doc.addPage();
  state.pageCount += 1;
  doc.y = PAGE.margin;
}

function drawChip(doc, x, y, text, palette, width = null) {
  const label = String(text || '').trim();
  if (!label) return;

  const chipWidth = width || Math.max(80, doc.widthOfString(label) + 24);
  doc.save();
  doc.roundedRect(x, y, chipWidth, 24, 12).fill(palette.fill);
  doc.restore();
  doc.fillColor(palette.text).font('Helvetica-Bold').fontSize(9).text(label, x, y + 8, {
    width: chipWidth,
    align: 'center',
  });
}

function drawSectionHeading(doc, state, title, subtitle = '') {
  ensureSpace(doc, state, subtitle ? 40 : 26);
  const y = doc.y;

  doc.save();
  doc.roundedRect(PAGE.margin, y + 2, 4, subtitle ? 28 : 18, 2).fill(COLORS.brand);
  doc.restore();

  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(13).text(title, PAGE.margin + 12, y);
  if (subtitle) {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text(subtitle, PAGE.margin + 12, y + 17);
  }

  doc.y = y + (subtitle ? 34 : 22);
}

function drawInfoCard(doc, x, y, width, title, items = []) {
  const validItems = items.filter((item) => item && item.value !== undefined && item.value !== null);
  const rowGap = 24;
  const padding = 14;
  const bodyHeight = validItems.reduce((sum, item) => {
    const valueHeight = Math.max(12, doc.heightOfString(String(item.value), { width: width - (padding * 2) }));
    return sum + 10 + valueHeight + 8;
  }, 0);
  const height = Math.max(80, padding + 18 + bodyHeight + 8);

  doc.save();
  doc.roundedRect(x, y, width, height, 14).fillAndStroke(COLORS.panel, COLORS.line);
  doc.roundedRect(x, y, 5, height, 14).fill(COLORS.brandSoft);
  doc.restore();

  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11).text(title, x + padding, y + padding, {
    width: width - (padding * 2),
  });

  let cursorY = y + padding + 22;
  validItems.forEach((item, index) => {
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(item.label, x + padding, cursorY, {
      width: width - (padding * 2),
    });
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(10).text(String(item.value), x + padding, cursorY + 9, {
      width: width - (padding * 2),
    });
    cursorY = doc.y + (index === validItems.length - 1 ? 0 : 6);
  });

  return height;
}

function drawSummaryCards(doc, state, metrics = []) {
  const gap = 14;
  const width = doc.page.width - (PAGE.margin * 2);
  const cardWidth = (width - (gap * (metrics.length - 1))) / metrics.length;
  const height = 88;

  ensureSpace(doc, state, height + 10);
  const y = doc.y;

  metrics.forEach((metric, index) => {
    const x = PAGE.margin + index * (cardWidth + gap);
    const border = metric.accent || COLORS.line;
    const fill = metric.emphasis ? COLORS.panel : COLORS.panelAlt;

    doc.save();
    doc.roundedRect(x, y, cardWidth, height, 16).fillAndStroke(fill, border);
    doc.roundedRect(x, y, cardWidth, 8, 16).fill(border);
    doc.restore();

    doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(8).text(metric.label.toUpperCase(), x + 14, y + 18, {
      width: cardWidth - 28,
    });
    doc.fillColor(metric.accent || COLORS.ink).font('Helvetica-Bold').fontSize(metric.emphasis ? 20 : 17).text(metric.value, x + 14, y + 36, {
      width: cardWidth - 28,
    });
    if (metric.subtext) {
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(metric.subtext, x + 14, y + 62, {
        width: cardWidth - 28,
      });
    }
  });

  doc.y = y + height + 18;
}

function drawTable(doc, state, config) {
  const {
    title,
    subtitle,
    columns,
    rows,
    emptyMessage,
    accentColor = COLORS.brand,
    totalLabel,
    totalValue,
  } = config;

  drawSectionHeading(doc, state, title, subtitle);

  const tableWidth = doc.page.width - (PAGE.margin * 2);
  const headerHeight = 24;
  const rowPadding = 8;

  const drawHeader = () => {
    ensureSpace(doc, state, headerHeight + 4);
    const y = doc.y;
    doc.save();
    doc.roundedRect(PAGE.margin, y, tableWidth, headerHeight, 10).fill(accentColor);
    doc.restore();

    let cursorX = PAGE.margin;
    columns.forEach((column) => {
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text(column.label, cursorX + 8, y + 8, {
        width: column.width - 16,
        align: column.align || 'left',
      });
      cursorX += column.width;
    });

    doc.y = y + headerHeight + 8;
  };

  drawHeader();

  if (!Array.isArray(rows) || rows.length === 0) {
    ensureSpace(doc, state, 48);
    const y = doc.y;
    doc.save();
    doc.roundedRect(PAGE.margin, y, tableWidth, 42, 12).fillAndStroke(COLORS.panel, COLORS.line);
    doc.restore();
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(10).text(emptyMessage || 'No items available for this section.', PAGE.margin + 12, y + 15, {
      width: tableWidth - 24,
      align: 'center',
    });
    doc.y = y + 56;
  } else {
    rows.forEach((row, index) => {
      const rowHeight = Math.max(28, ...columns.map((column) => {
        doc.font(column.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
        return doc.heightOfString(String(row[column.key] || ''), {
          width: column.width - 16,
          align: column.align || 'left',
        }) + rowPadding;
      }));

      ensureSpace(doc, state, rowHeight + 2);
      if (doc.y + rowHeight > doc.page.height - PAGE.margin - PAGE.footerReserve) {
        doc.addPage();
        state.pageCount += 1;
        doc.y = PAGE.margin;
        drawHeader();
      }

      const y = doc.y;
      doc.save();
      doc.roundedRect(PAGE.margin, y, tableWidth, rowHeight, 10).fillAndStroke(index % 2 === 0 ? COLORS.panel : COLORS.panelAlt, COLORS.line);
      doc.restore();

      let cursorX = PAGE.margin;
      columns.forEach((column) => {
        doc.fillColor(column.color || COLORS.text).font(column.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(String(row[column.key] || ''), cursorX + 8, y + 8, {
          width: column.width - 16,
          align: column.align || 'left',
        });
        cursorX += column.width;
      });

      doc.y = y + rowHeight + 6;
    });
  }

  if (totalLabel) {
    ensureSpace(doc, state, 28);
    const y = doc.y;
    doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(9).text(totalLabel.toUpperCase(), PAGE.margin, y);
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(12).text(totalValue, PAGE.margin, y - 2, {
      width: tableWidth,
      align: 'right',
    });
    doc.y = y + 24;
  }

  doc.y += 6;
}

function drawTaxSummary(doc, state, payslip) {
  const taxBreakdown = payslip.taxBreakdown || {};
  const statutoryRows = (Array.isArray(payslip.deductions) ? payslip.deductions : [])
    .filter((item) => ['social_security', 'pension'].includes(item.type))
    .map((item) => ({
      label: item.name || humanizeValue(item.type),
      value: formatMoney(payslip.currency, item.amount || 0),
    }));

  const notes = Array.isArray(taxBreakdown.notes) ? taxBreakdown.notes.filter(Boolean) : [];
  drawSectionHeading(doc, state, 'Tax & Statutory Overview', 'Built from the finalized payroll calculation used for this payslip.');

  const width = doc.page.width - (PAGE.margin * 2);
  const gap = 14;
  const cardWidth = (width - gap) / 2;
  const leftItems = [
    { label: 'Jurisdiction', value: safeText(taxBreakdown.jurisdictionName || taxBreakdown.jurisdictionCode) },
    { label: 'Taxable Income', value: formatMoney(payslip.currency, taxBreakdown.netTaxableIncome || 0) },
    { label: 'Income Tax', value: formatMoney(payslip.currency, taxBreakdown.taxAmount || 0) },
    { label: 'Effective Tax Rate', value: `${Number(taxBreakdown.taxRate || 0).toFixed(2)}%` },
    { label: 'Tax Year', value: safeText(taxBreakdown.taxYearLabel, 'Current period') },
  ];
  const rightItems = statutoryRows.length > 0
    ? statutoryRows
    : [{ label: 'Statutory Deductions', value: formatMoney(payslip.currency, payslip.deductionsSummary?.statutoryDeductions || 0) }];

  ensureSpace(doc, state, 180);
  const y = doc.y;
  const leftHeight = drawInfoCard(doc, PAGE.margin, y, cardWidth, 'Tax Snapshot', leftItems);
  const rightHeight = drawInfoCard(doc, PAGE.margin + cardWidth + gap, y, cardWidth, 'Statutory Contributions', rightItems);
  doc.y = y + Math.max(leftHeight, rightHeight) + 14;

  if (notes.length > 0) {
    ensureSpace(doc, state, 70);
    const noteHeight = 28 + (notes.length * 14);
    const noteY = doc.y;

    doc.save();
    doc.roundedRect(PAGE.margin, noteY, width, noteHeight, 14).fillAndStroke(COLORS.brandSoft, '#fcd34d');
    doc.restore();

    doc.fillColor('#92400e').font('Helvetica-Bold').fontSize(10).text('Calculation Notes', PAGE.margin + 14, noteY + 12);
    doc.fillColor('#78350f').font('Helvetica').fontSize(9);
    notes.forEach((note, index) => {
      doc.text(`- ${note}`, PAGE.margin + 14, noteY + 28 + (index * 14), {
        width: width - 28,
      });
    });

    doc.y = noteY + noteHeight + 12;
  }
}

function addFooters(doc, organizationName) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const footerY = doc.page.height - 26;

    doc.save();
    doc.moveTo(PAGE.margin, footerY - 8).lineTo(doc.page.width - PAGE.margin, footerY - 8).strokeColor(COLORS.line).stroke();
    doc.restore();

    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(
      `${organizationName} payroll document. This is a computer-generated file and does not require a signature.`,
      PAGE.margin,
      footerY,
      { width: 320 }
    );
    doc.text(
      `Generated ${formatDateTime(new Date())} | Page ${i + 1} of ${range.count}`,
      doc.page.width - PAGE.margin - 220,
      footerY,
      { width: 220, align: 'right' }
    );
  }
}

function buildRows(items = [], currency) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    item: safeText(item.name || humanizeValue(item.type)),
    type: humanizeValue(item.type || 'other'),
    details: item.description || (item.taxable === false ? 'Non-taxable' : item.isPreTax ? 'Pre-tax' : 'Standard'),
    amount: formatMoney(currency, item.amount || 0),
  }));
}

function createPayslipPdf({ payslip, organization = {} }) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    bufferPages: true,
  });

  const state = { pageCount: 1 };
  const org = getOrganizationDetails(organization);
  const statusPalette = getStatusPalette(payslip.status);
  const pageWidth = doc.page.width - (PAGE.margin * 2);
  const periodLabel = safeText(payslip.periodDisplay, `${payslip.payPeriod?.month}/${payslip.payPeriod?.year}`);
  const paymentMethod = safeText(
    payslip.paymentDetails?.method ? humanizeValue(payslip.paymentDetails.method) : 'Bank transfer',
    'Bank transfer'
  );
  const companyMeta = [org.email, org.phone, org.website].filter((value) => value && value !== 'N/A').join(' | ');

  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.page);
  doc.fillColor(COLORS.text);

  doc.save();
  doc.roundedRect(PAGE.margin, PAGE.margin, pageWidth, 142, 22).fill(COLORS.hero);
  doc.roundedRect(PAGE.margin + 16, PAGE.margin + 18, pageWidth - 32, 106, 18).fill(COLORS.heroSoft);
  doc.roundedRect(PAGE.margin, PAGE.margin, 8, 142, 22).fill(COLORS.brand);
  doc.restore();

  doc.save();
  doc.roundedRect(PAGE.margin + 30, PAGE.margin + 35, 48, 48, 16).fill(COLORS.brand);
  doc.restore();
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(22).text('S', PAGE.margin + 46, PAGE.margin + 49, {
    width: 16,
    align: 'center',
  });

  doc.fillColor(COLORS.brandSoft).font('Helvetica-Bold').fontSize(9).text('PAYROLL STATEMENT', PAGE.margin + 96, PAGE.margin + 28);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text(org.name, PAGE.margin + 96, PAGE.margin + 43, {
    width: 270,
  });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(24).text('Payslip', PAGE.margin + 96, PAGE.margin + 70);
  doc.fillColor('#d4d4d8').font('Helvetica').fontSize(10).text(
    `${periodLabel} | Payslip ${safeText(payslip.payslipNumber)}`,
    PAGE.margin + 96,
    PAGE.margin + 100
  );
  doc.text(`Payment Date ${formatDate(payslip.payPeriod?.paymentDate)}`, PAGE.margin + 96, PAGE.margin + 114);

  if (companyMeta) {
    doc.fillColor('#cbd5e1').font('Helvetica').fontSize(8).text(companyMeta, PAGE.margin + 96, PAGE.margin + 16, {
      width: 320,
    });
  }

  drawChip(doc, doc.page.width - PAGE.margin - 116, PAGE.margin + 24, humanizeValue(payslip.status), statusPalette, 116);
  doc.fillColor('#d1d5db').font('Helvetica-Bold').fontSize(9).text('Net Pay', doc.page.width - PAGE.margin - 186, PAGE.margin + 60, {
    width: 156,
    align: 'right',
  });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text(
    formatMoney(payslip.currency, payslip.netPay || 0),
    doc.page.width - PAGE.margin - 186,
    PAGE.margin + 74,
    { width: 156, align: 'right' }
  );
  doc.fillColor('#d4d4d8').font('Helvetica').fontSize(9).text(
    `${paymentMethod} | ${safeText(payslip.currency)}`,
    doc.page.width - PAGE.margin - 186,
    PAGE.margin + 100,
    { width: 156, align: 'right' }
  );

  doc.y = PAGE.margin + 162;

  drawSummaryCards(doc, state, [
    {
      label: 'Gross Pay',
      value: formatMoney(payslip.currency, payslip.earningsSummary?.grossPay || 0),
      subtext: `${(payslip.earnings || []).length} earning item${(payslip.earnings || []).length === 1 ? '' : 's'}`,
      accent: COLORS.ink,
    },
    {
      label: 'Total Deductions',
      value: formatMoney(payslip.currency, payslip.deductionsSummary?.totalDeductions || 0),
      subtext: `${(payslip.deductions || []).length} deduction item${(payslip.deductions || []).length === 1 ? '' : 's'}`,
      accent: COLORS.danger,
    },
    {
      label: 'Net Pay',
      value: formatMoney(payslip.currency, payslip.netPay || 0),
      subtext: paymentMethod,
      accent: COLORS.success,
      emphasis: true,
    },
  ]);

  drawSectionHeading(doc, state, 'Company & Employee', 'Snapshot details captured when this payslip was generated.');
  ensureSpace(doc, state, 240);
  const gap = 14;
  const cardWidth = (pageWidth - gap) / 2;
  const topY = doc.y;

  const companyHeight = drawInfoCard(doc, PAGE.margin, topY, cardWidth, 'Company', [
    { label: 'Organization', value: org.name },
    { label: 'Organization ID', value: org.id },
    { label: 'Registration', value: org.registration },
    { label: 'Tax Reference', value: org.taxReference },
    { label: 'Email', value: org.email },
    { label: 'Phone', value: org.phone },
    { label: 'Website', value: org.website },
    { label: 'Address', value: org.address },
    { label: 'Payroll Run', value: safeText(payslip.payrollRunId?.runNumber, 'N/A') },
    { label: 'Currency', value: safeText(payslip.currency) },
  ]);

  const employeeHeight = drawInfoCard(doc, PAGE.margin + cardWidth + gap, topY, cardWidth, 'Employee', [
    { label: 'Name', value: safeText(payslip.employeeSnapshot?.name) },
    { label: 'Email', value: safeText(payslip.employeeSnapshot?.email) },
    { label: 'Employee ID', value: safeText(payslip.employeeSnapshot?.employeeId) },
    { label: 'Department', value: safeText(payslip.employeeSnapshot?.department) },
    { label: 'Designation', value: safeText(payslip.employeeSnapshot?.designation) },
    { label: 'Team', value: safeText(payslip.employeeSnapshot?.teamName, 'Unassigned') },
    { label: 'Employment Type', value: humanizeValue(payslip.employeeSnapshot?.employmentType || 'full_time') },
    { label: 'Location', value: safeText(payslip.employeeSnapshot?.location) },
    { label: 'Cost Center', value: safeText(payslip.employeeSnapshot?.costCenter) },
    { label: 'Manager', value: safeText(payslip.employeeSnapshot?.managerName, 'N/A') },
  ]);

  doc.y = topY + Math.max(companyHeight, employeeHeight) + 14;

  ensureSpace(doc, state, 180);
  const paymentY = doc.y;
  const paymentHeight = drawInfoCard(doc, PAGE.margin, paymentY, cardWidth, 'Payment', [
    { label: 'Pay Period', value: periodLabel },
    { label: 'Period Start', value: formatDate(payslip.payPeriod?.startDate) },
    { label: 'Period End', value: formatDate(payslip.payPeriod?.endDate) },
    { label: 'Payment Date', value: formatDate(payslip.payPeriod?.paymentDate) },
    { label: 'Method', value: paymentMethod },
    { label: 'Transaction ID', value: safeText(payslip.paymentDetails?.transactionId) },
    { label: 'Bank Reference', value: safeText(payslip.paymentDetails?.bankReference) },
  ]);

  const bankHeight = drawInfoCard(doc, PAGE.margin + cardWidth + gap, paymentY, cardWidth, 'Bank on File', [
    { label: 'Bank Name', value: safeText(payslip.employeeSnapshot?.bankAccount?.bankName, 'On file') },
    { label: 'Account', value: getAccountPreview(payslip.employeeSnapshot?.bankAccount) },
    { label: 'Routing / Branch', value: safeText(payslip.employeeSnapshot?.bankAccount?.routingNumber, 'On file') },
    { label: 'Manager', value: safeText(payslip.employeeSnapshot?.managerName, 'N/A') },
  ]);

  doc.y = paymentY + Math.max(paymentHeight, bankHeight) + 14;

  drawTable(doc, state, {
    title: 'Earnings',
    subtitle: 'Recurring pay, allowances, bonuses, overtime, and approved additions included in this period.',
    columns: [
      { key: 'item', label: 'Item', width: 220, bold: true },
      { key: 'type', label: 'Type', width: 105 },
      { key: 'details', label: 'Tax / Notes', width: 135 },
      { key: 'amount', label: 'Amount', width: 100, align: 'right', bold: true },
    ],
    rows: buildRows(payslip.earnings, payslip.currency),
    emptyMessage: 'No earnings items were recorded for this payslip.',
    totalLabel: 'Total earnings',
    totalValue: formatMoney(payslip.currency, payslip.earningsSummary?.grossPay || 0),
    accentColor: COLORS.brand,
  });

  drawTable(doc, state, {
    title: 'Deductions',
    subtitle: 'Taxes, statutory deductions, loans, insurance, and other payroll recoveries.',
    columns: [
      { key: 'item', label: 'Item', width: 220, bold: true },
      { key: 'type', label: 'Type', width: 105 },
      { key: 'details', label: 'Treatment', width: 135 },
      { key: 'amount', label: 'Amount', width: 100, align: 'right', bold: true },
    ],
    rows: buildRows(payslip.deductions, payslip.currency),
    emptyMessage: 'No deductions were recorded for this payslip.',
    totalLabel: 'Total deductions',
    totalValue: formatMoney(payslip.currency, payslip.deductionsSummary?.totalDeductions || 0),
    accentColor: COLORS.purple,
  });

  drawTaxSummary(doc, state, payslip);

  if (Array.isArray(payslip.employerContributions) && payslip.employerContributions.length > 0) {
    drawTable(doc, state, {
      title: 'Employer Contributions',
      subtitle: 'Employer-paid benefits and statutory amounts that do not reduce employee take-home pay.',
      columns: [
        { key: 'item', label: 'Item', width: 240, bold: true },
        { key: 'type', label: 'Type', width: 140 },
        { key: 'details', label: 'Details', width: 80 },
        { key: 'amount', label: 'Amount', width: 100, align: 'right', bold: true },
      ],
      rows: buildRows(payslip.employerContributions, payslip.currency),
      emptyMessage: 'No employer contributions were recorded for this payslip.',
      totalLabel: 'Total employer contributions',
      totalValue: formatMoney(payslip.currency, payslip.totalEmployerContributions || 0),
      accentColor: COLORS.info,
    });
  }

  drawSectionHeading(doc, state, 'Year-To-Date Summary', 'Cumulative payroll totals recorded up to this pay period.');
  drawSummaryCards(doc, state, [
    {
      label: 'YTD Gross',
      value: formatMoney(payslip.currency, payslip.ytdSummary?.grossEarnings || 0),
      accent: COLORS.ink,
    },
    {
      label: 'YTD Tax',
      value: formatMoney(payslip.currency, payslip.ytdSummary?.totalTax || 0),
      accent: COLORS.danger,
    },
    {
      label: 'YTD Net',
      value: formatMoney(payslip.currency, payslip.ytdSummary?.netPay || 0),
      accent: COLORS.success,
    },
  ]);

  const noteText = [safeText(payslip.employeeNotes, ''), safeText(payslip.notes, '')].filter(Boolean);
  if (noteText.length > 0) {
    drawSectionHeading(doc, state, 'Notes', 'Additional information attached to this payslip.');
    ensureSpace(doc, state, 72);
    const noteY = doc.y;
    const noteHeight = 26 + noteText.reduce((sum, note) => sum + Math.max(18, doc.heightOfString(note, {
      width: pageWidth - 28,
    })), 0);

    doc.save();
    doc.roundedRect(PAGE.margin, noteY, pageWidth, noteHeight, 14).fillAndStroke(COLORS.panel, COLORS.line);
    doc.restore();

    let cursorY = noteY + 14;
    noteText.forEach((note) => {
      doc.fillColor(COLORS.text).font('Helvetica').fontSize(9).text(note, PAGE.margin + 14, cursorY, {
        width: pageWidth - 28,
      });
      cursorY = doc.y + 8;
    });
    doc.y = noteY + noteHeight + 10;
  }

  addFooters(doc, org.name);
  return doc;
}

module.exports = {
  createPayslipPdf,
};
