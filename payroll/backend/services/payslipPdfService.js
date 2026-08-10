const PDFDocument = require('pdfkit');

const COLORS = {
  brand: '#d97706',
  brandSoft: '#fff7ed',
  ink: '#172033',
  text: '#344054',
  muted: '#667085',
  faint: '#98a2b3',
  line: '#d0d5dd',
  lineSoft: '#e4e7ec',
  surface: '#f8fafc',
  white: '#ffffff',
  success: '#067647',
  successSoft: '#ecfdf3',
  danger: '#b42318',
};

const LAYOUT = {
  margin: 36,
  contentWidth: 523.28,
  footerY: 808,
  mainItemLimit: 8,
  detailPageItemLimit: 18,
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
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function toAmount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function sumAmounts(rows = []) {
  return rows.reduce((total, row) => total + toAmount(row.amount), 0);
}

function summaryOrLineTotal(summaryValue, rows = []) {
  const summary = Number(summaryValue);
  const lineTotal = sumAmounts(rows);
  if (Number.isFinite(summary) && (summary !== 0 || lineTotal === 0)) return summary;
  return lineTotal;
}

function formatMoney(currency, amount) {
  const code = safeText(currency, 'USD').toUpperCase().slice(0, 3);
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(toAmount(amount)).replace(/\u00a0/g, ' ');
  } catch (_error) {
    return `${code} ${toAmount(amount).toLocaleString('en-GB', {
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
    timeZone: 'UTC',
  }).format(date);
}

function humanizeValue(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getPeriodLabel(payPeriod = {}) {
  const year = Number(payPeriod.year);
  const month = Number(payPeriod.month);
  if (year && month >= 1 && month <= 12) {
    return new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, 1)));
  }
  return `${formatDate(payPeriod.startDate)} - ${formatDate(payPeriod.endDate)}`;
}

function getOrganizationAddress(organization = {}) {
  const formatted = pickFirst(organization, [
    'address.formatted',
    'registeredAddress.formatted',
    'companyAddress.formatted',
    'location.formatted',
  ]);
  if (formatted) return safeText(formatted, '');

  const address = pickFirst(organization, ['address', 'registeredAddress', 'companyAddress', 'location']);
  if (address && typeof address === 'object') {
    return [
      address.line1,
      address.line2,
      address.street,
      address.city,
      address.state,
      address.postalCode || address.zipCode,
      address.country || address.countryCode,
    ].filter((part) => part && String(part).trim()).join(', ');
  }

  return typeof address === 'string' ? address : '';
}

function getOrganizationDetails(organization = {}) {
  return {
    name: safeText(
      organization.name || organization.organizationName || organization.displayName,
      'Seemplify'
    ),
    address: getOrganizationAddress(organization),
    registration: safeText(pickFirst(organization, [
      'registrationNumber',
      'companyRegistrationNumber',
      'businessRegistrationNumber',
      'registrationId',
      'companyNumber',
    ]), ''),
    taxReference: safeText(pickFirst(organization, [
      'taxReference',
      'taxId',
      'taxNumber',
      'tin',
      'vatNumber',
      'taxIdentificationNumber',
      'payrollTaxReference',
    ]), ''),
    email: safeText(pickFirst(organization, ['email', 'contactEmail', 'supportEmail', 'primaryEmail']), ''),
    phone: safeText(pickFirst(organization, ['phone', 'phoneNumber', 'contactPhone', 'supportPhone']), ''),
  };
}

function getAccountPreview(bankAccount = {}) {
  const raw = safeText(bankAccount.accountNumber, 'On file');
  if (raw === 'On file' || /[*xX]/.test(raw)) return raw;
  const compact = raw.replace(/\s/g, '');
  if (compact.length <= 4) return compact;
  return `**** ${compact.slice(-4)}`;
}

function normalizeRows(items = [], kind) {
  return (Array.isArray(items) ? items : []).map((item) => {
    let treatment = '';
    if (kind === 'earnings') {
      if (item.cashPayable === false) treatment = 'Non-cash';
      else treatment = item.taxable === false ? 'Non-taxable' : 'Taxable';
    } else if (kind === 'deductions') {
      treatment = item.isPreTax ? 'Pre-tax' : 'Post-tax';
    } else {
      treatment = 'Employer paid';
    }

    return {
      label: safeText(item.name, humanizeValue(item.type) || 'Payroll item'),
      category: humanizeValue(item.type) || humanizeValue(kind),
      treatment,
      amount: toAmount(item.amount),
    };
  });
}

function buildEarningRows(payslip) {
  const lineRows = normalizeRows(payslip.earnings, 'earnings');
  if (lineRows.length > 0) return lineRows;

  const summary = payslip.earningsSummary || {};
  const fallbackRows = [
    ['Basic salary', 'Basic', summary.basicSalary],
    ['Allowances', 'Allowance', summary.totalAllowances],
    ['Overtime', 'Overtime', summary.overtimePay],
    ['Bonuses', 'Bonus', summary.totalBonuses],
    ['Other earnings', 'Other', summary.otherEarnings],
    ['Taxable benefits', 'Benefit In Kind', summary.taxableBenefits],
  ].filter(([, , amount]) => toAmount(amount) !== 0)
    .map(([label, category, amount]) => ({ label, category, treatment: 'Taxable', amount: toAmount(amount) }));

  if (fallbackRows.length > 0) return fallbackRows;
  const grossPay = toAmount(summary.grossPay);
  return grossPay === 0 ? [] : [{ label: 'Gross earnings', category: 'Earnings', treatment: 'Taxable', amount: grossPay }];
}

function buildDeductionRows(payslip) {
  const lineRows = normalizeRows(payslip.deductions, 'deductions');
  if (lineRows.length > 0) return lineRows;

  const summary = payslip.deductionsSummary || {};
  const taxAmount = toAmount(summary.taxDeductions || payslip.taxBreakdown?.taxAmount);
  const fallbackRows = [
    ['Income tax', 'Income Tax', taxAmount],
    ['Statutory deductions', 'Statutory', summary.statutoryDeductions],
    ['Voluntary deductions', 'Voluntary', summary.voluntaryDeductions],
    ['Loan deductions', 'Loan', summary.loanDeductions],
    ['Other deductions', 'Other', summary.otherDeductions],
  ].filter(([, , amount]) => toAmount(amount) !== 0)
    .map(([label, category, amount]) => ({ label, category, treatment: 'Post-tax', amount: toAmount(amount) }));

  if (fallbackRows.length > 0) return fallbackRows;
  const total = toAmount(summary.totalDeductions);
  return total === 0 ? [] : [{ label: 'Payroll deductions', category: 'Deduction', treatment: 'Post-tax', amount: total }];
}

function fitText(doc, value, x, y, width, options = {}) {
  const text = safeText(value, options.fallback ?? 'N/A');
  const font = options.font || 'Helvetica';
  const minimumSize = options.minimumSize || 6.5;
  let size = options.size || 9;

  doc.font(font);
  while (size > minimumSize && doc.fontSize(size).widthOfString(text) > width) {
    size -= 0.25;
  }

  doc.fillColor(options.color || COLORS.text)
    .font(font)
    .fontSize(size)
    .text(text, x, y, {
      width,
      align: options.align || 'left',
      lineBreak: false,
    });
}

function drawStatus(doc, payslip) {
  const status = humanizeValue(payslip.status || 'issued');
  const isFinal = ['Paid', 'Approved', 'Exported'].includes(status);
  const width = Math.max(52, Math.min(92, doc.font('Helvetica-Bold').fontSize(7.5).widthOfString(status) + 22));
  const x = doc.page.width - LAYOUT.margin - width;

  doc.roundedRect(x, 89, width, 20, 10).fill(isFinal ? COLORS.successSoft : COLORS.brandSoft);
  fitText(doc, status.toUpperCase(), x + 8, 95, width - 16, {
    font: 'Helvetica-Bold',
    size: 7.5,
    minimumSize: 6,
    color: isFinal ? COLORS.success : COLORS.brand,
    align: 'center',
  });
}

function drawHeader(doc, context, continuation = false) {
  const { org, payslip, periodLabel } = context;
  const left = LAYOUT.margin;
  const rightColumnX = 390;

  doc.rect(0, 0, doc.page.width, 6).fill(COLORS.brand);
  doc.rect(left, 37, 42, 4).fill(COLORS.brand);

  fitText(doc, org.name, left, 49, 320, {
    font: 'Helvetica-Bold', size: 17, minimumSize: 12, color: COLORS.ink,
  });

  const companyReferences = [
    org.registration ? `Company no. ${org.registration}` : '',
    org.taxReference ? `Tax ref. ${org.taxReference}` : '',
  ].filter(Boolean).join('  |  ');
  fitText(doc, org.address || [org.email, org.phone].filter(Boolean).join('  |  '), left, 73, 320, {
    size: 8, minimumSize: 6.5, color: COLORS.muted, fallback: '',
  });
  fitText(doc, companyReferences, left, 88, 320, {
    size: 7.5, minimumSize: 6.5, color: COLORS.faint, fallback: '',
  });

  fitText(doc, continuation ? 'PAYSLIP DETAILS' : 'PAYSLIP', rightColumnX, 42, 169, {
    font: 'Helvetica-Bold', size: continuation ? 16 : 22, minimumSize: 13, color: COLORS.ink, align: 'right',
  });
  fitText(doc, periodLabel, rightColumnX, 69, 169, {
    font: 'Helvetica-Bold', size: 9, color: COLORS.text, align: 'right',
  });
  fitText(doc, safeText(payslip.payslipNumber), rightColumnX, 82, 169, {
    size: 8, color: COLORS.muted, align: 'right',
  });

  if (!continuation) drawStatus(doc, payslip);
  else {
    fitText(doc, `${safeText(payslip.employeeSnapshot?.name)}  |  continued`, rightColumnX, 98, 169, {
      size: 7.5, minimumSize: 6, color: COLORS.faint, align: 'right',
    });
  }

  doc.moveTo(left, 118).lineTo(doc.page.width - left, 118).lineWidth(0.7).stroke(COLORS.line);
}

function drawMetaCell(doc, label, value, x, y, width) {
  fitText(doc, String(label).toUpperCase(), x, y, width, {
    font: 'Helvetica-Bold', size: 6.8, minimumSize: 6, color: COLORS.muted,
  });
  fitText(doc, value, x, y + 13, width, {
    font: 'Helvetica-Bold', size: 9.5, minimumSize: 7, color: COLORS.ink,
  });
}

function drawEmployeePanel(doc, context) {
  const { payslip } = context;
  const snapshot = payslip.employeeSnapshot || {};
  const x = LAYOUT.margin;
  const y = 134;
  const width = LAYOUT.contentWidth;
  const height = 100;
  const padding = 14;
  const gap = 12;
  const cellWidth = (width - (padding * 2) - (gap * 2)) / 3;
  const periodRange = `${formatDate(payslip.payPeriod?.startDate)} - ${formatDate(payslip.payPeriod?.endDate)}`;

  doc.roundedRect(x, y, width, height, 8).fillAndStroke(COLORS.surface, COLORS.lineSoft);

  const cells = [
    ['Employee', safeText(snapshot.name)],
    ['Employee number', safeText(snapshot.employeeId || payslip.userId)],
    ['Department', safeText(snapshot.department, 'Unassigned')],
    ['Job title', safeText(snapshot.designation, 'Not specified')],
    ['Pay period', periodRange],
    ['Payment date', formatDate(payslip.payPeriod?.paymentDate || payslip.paymentDetails?.paymentDate)],
  ];

  cells.forEach(([label, value], index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    drawMetaCell(doc, label, value, x + padding + (column * (cellWidth + gap)), y + 15 + (row * 42), cellWidth);
  });
}

function drawMainTable(doc, config) {
  const {
    x, y, width, title, rows, rowCount, totalLabel, totalAmount, currency, remaining,
  } = config;
  const headerHeight = 34;
  const rowHeight = 25;
  const totalHeight = 34;
  const height = headerHeight + (rowCount * rowHeight) + totalHeight;
  const amountWidth = 86;

  doc.roundedRect(x, y, width, height, 8).fillAndStroke(COLORS.white, COLORS.line);
  doc.save();
  doc.roundedRect(x, y, width, headerHeight, 8).fill(COLORS.surface);
  doc.rect(x, y + headerHeight - 8, width, 8).fill(COLORS.surface);
  doc.restore();
  doc.rect(x, y, 4, headerHeight).fill(COLORS.brand);

  fitText(doc, title.toUpperCase(), x + 13, y + 11, width - amountWidth - 22, {
    font: 'Helvetica-Bold', size: 8.5, color: COLORS.ink,
  });
  fitText(doc, `AMOUNT (${safeText(currency)})`, x + width - amountWidth - 10, y + 11, amountWidth, {
    font: 'Helvetica-Bold', size: 7, minimumSize: 6, color: COLORS.muted, align: 'right',
  });

  for (let index = 0; index < rowCount; index += 1) {
    const rowY = y + headerHeight + (index * rowHeight);
    const row = rows[index];
    if (index > 0) {
      doc.moveTo(x + 10, rowY).lineTo(x + width - 10, rowY).lineWidth(0.45).stroke(COLORS.lineSoft);
    }

    if (row) {
      fitText(doc, row.label, x + 13, rowY + 8, width - amountWidth - 28, {
        size: 8.2, minimumSize: 6.4, color: COLORS.text,
      });
      fitText(doc, formatMoney(currency, row.amount), x + width - amountWidth - 10, rowY + 8, amountWidth, {
        font: 'Helvetica-Bold', size: 8.2, minimumSize: 6.2, color: COLORS.ink, align: 'right',
      });
    } else if (index === 0) {
      fitText(doc, title === 'Earnings' ? 'No earnings recorded' : 'No deductions recorded', x + 13, rowY + 8, width - 26, {
        size: 8, color: COLORS.faint,
      });
    }
  }

  const totalY = y + headerHeight + (rowCount * rowHeight);
  doc.rect(x, totalY, width, totalHeight).fill(COLORS.surface);
  fitText(doc, remaining > 0 ? `${totalLabel}  (+${remaining} on next page)` : totalLabel, x + 13, totalY + 12, width - amountWidth - 26, {
    font: 'Helvetica-Bold', size: remaining > 0 ? 6.8 : 7.5, minimumSize: 6, color: COLORS.muted,
  });
  fitText(doc, formatMoney(currency, totalAmount), x + width - amountWidth - 10, totalY + 10, amountWidth, {
    font: 'Helvetica-Bold', size: 9.2, minimumSize: 6.5, color: COLORS.ink, align: 'right',
  });

  return height;
}

function drawPaySummary(doc, context, y) {
  const { payslip, grossPay, totalDeductions, netPay } = context;
  const x = LAYOUT.margin;
  const width = LAYOUT.contentWidth;
  const height = 64;
  const segment = width / 3;

  doc.roundedRect(x, y, width, height, 8).fill(COLORS.ink);
  doc.roundedRect(x + (segment * 2), y, segment, height, 8).fill(COLORS.success);
  doc.rect(x + (segment * 2), y, 8, height).fill(COLORS.success);
  doc.moveTo(x + segment, y + 14).lineTo(x + segment, y + height - 14).lineWidth(0.5).stroke('#475467');

  const metrics = [
    ['Gross pay', grossPay, COLORS.white],
    ['Total deductions', totalDeductions, COLORS.white],
    ['Net pay', netPay, COLORS.white],
  ];

  metrics.forEach(([label, amount, color], index) => {
    const segmentX = x + (segment * index) + 15;
    fitText(doc, String(label).toUpperCase(), segmentX, y + 13, segment - 30, {
      font: 'Helvetica-Bold', size: 6.8, color: index === 2 ? '#d1fadf' : '#d0d5dd',
    });
    fitText(doc, formatMoney(payslip.currency, amount), segmentX, y + 31, segment - 30, {
      font: 'Helvetica-Bold', size: 12.5, minimumSize: 8.5, color,
    });
  });
}

function drawSmallDetail(doc, label, value, x, y, width) {
  fitText(doc, String(label).toUpperCase(), x, y, width, {
    font: 'Helvetica-Bold', size: 6.2, minimumSize: 5.8, color: COLORS.faint,
  });
  fitText(doc, value, x, y + 11, width, {
    font: 'Helvetica-Bold', size: 8.2, minimumSize: 6.2, color: COLORS.text,
  });
}

function drawDetailsPanel(doc, context, y) {
  const { payslip, org, employerContributionTotal } = context;
  const x = LAYOUT.margin;
  const width = LAYOUT.contentWidth;
  const height = 168;
  const rightWidth = 174;
  const leftWidth = width - rightWidth - 12;
  const rightX = x + leftWidth + 12;
  const innerPadding = 14;
  const detailGap = 12;
  const detailWidth = (leftWidth - (innerPadding * 2) - detailGap) / 2;
  const bank = payslip.employeeSnapshot?.bankAccount || {};
  const tax = payslip.taxBreakdown || {};
  const paymentMethod = humanizeValue(payslip.paymentDetails?.method || 'bank_transfer');
  const jurisdiction = safeText(tax.jurisdictionName || tax.jurisdictionCode, 'Not specified');
  const taxablePay = toAmount(tax.netTaxableIncome || payslip.earningsSummary?.taxableGrossPay || context.grossPay);

  doc.roundedRect(x, y, leftWidth, height, 8).fillAndStroke(COLORS.white, COLORS.lineSoft);
  fitText(doc, 'PAYMENT & STATUTORY DETAILS', x + innerPadding, y + 15, leftWidth - (innerPadding * 2), {
    font: 'Helvetica-Bold', size: 7.5, color: COLORS.ink,
  });

  const detailRows = [
    ['Taxable pay', formatMoney(payslip.currency, taxablePay)],
    ['Income tax', formatMoney(payslip.currency, tax.taxAmount || payslip.deductionsSummary?.taxDeductions || 0)],
    ['Payment method', paymentMethod],
    ['Bank account', `${safeText(bank.bankName, 'Bank on file')}  ${getAccountPreview(bank)}`],
    ['Tax jurisdiction', jurisdiction],
    ['Employer paid (not deducted)', formatMoney(payslip.currency, employerContributionTotal)],
  ];

  detailRows.forEach(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    drawSmallDetail(
      doc,
      label,
      value,
      x + innerPadding + (column * (detailWidth + detailGap)),
      y + 38 + (row * 31),
      detailWidth
    );
  });

  const employeeNote = safeText(payslip.employeeNotes, '');
  if (employeeNote) {
    doc.moveTo(x + innerPadding, y + 130).lineTo(x + leftWidth - innerPadding, y + 130)
      .lineWidth(0.45).stroke(COLORS.lineSoft);
    fitText(doc, 'NOTE', x + innerPadding, y + 140, 30, {
      font: 'Helvetica-Bold', size: 6.2, color: COLORS.brand,
    });
    fitText(doc, employeeNote, x + 48, y + 138, leftWidth - 62, {
      size: 7.3, minimumSize: 5.8, color: COLORS.muted,
    });
  } else {
    fitText(doc, [org.email, org.phone].filter(Boolean).join('  |  '), x + innerPadding, y + 143, leftWidth - (innerPadding * 2), {
      size: 7, minimumSize: 6, color: COLORS.faint, fallback: '',
    });
  }

  doc.roundedRect(rightX, y, rightWidth, height, 8).fillAndStroke(COLORS.surface, COLORS.lineSoft);
  fitText(doc, 'YEAR TO DATE', rightX + 14, y + 15, rightWidth - 28, {
    font: 'Helvetica-Bold', size: 7.5, color: COLORS.ink,
  });

  const ytd = payslip.ytdSummary || {};
  const ytdRows = [
    ['Gross earnings', ytd.grossEarnings],
    ['Deductions', ytd.totalDeductions],
    ['Income tax', ytd.totalTax],
    ['Net pay', ytd.netPay],
  ];

  ytdRows.forEach(([label, amount], index) => {
    const rowY = y + 40 + (index * 29);
    fitText(doc, label, rightX + 14, rowY, 74, {
      size: 7.1, minimumSize: 6, color: COLORS.muted,
    });
    fitText(doc, formatMoney(payslip.currency, amount || 0), rightX + 88, rowY, rightWidth - 102, {
      font: 'Helvetica-Bold', size: 7.8, minimumSize: 5.8,
      color: index === ytdRows.length - 1 ? COLORS.success : COLORS.text,
      align: 'right',
    });
  });
}

function drawMainPage(doc, context) {
  drawHeader(doc, context);
  drawEmployeePanel(doc, context);

  const earnings = context.earningRows.slice(0, LAYOUT.mainItemLimit);
  const deductions = context.deductionRows.slice(0, LAYOUT.mainItemLimit);
  const rowCount = Math.max(earnings.length, deductions.length, 1);
  const gap = 14;
  const tableWidth = (LAYOUT.contentWidth - gap) / 2;
  const tableY = 252;

  const tableHeight = drawMainTable(doc, {
    x: LAYOUT.margin,
    y: tableY,
    width: tableWidth,
    title: 'Earnings',
    rows: earnings,
    rowCount,
    totalLabel: 'Total earnings',
    totalAmount: context.grossPay,
    currency: context.payslip.currency,
    remaining: Math.max(0, context.earningRows.length - LAYOUT.mainItemLimit),
  });
  drawMainTable(doc, {
    x: LAYOUT.margin + tableWidth + gap,
    y: tableY,
    width: tableWidth,
    title: 'Deductions',
    rows: deductions,
    rowCount,
    totalLabel: 'Total deductions',
    totalAmount: context.totalDeductions,
    currency: context.payslip.currency,
    remaining: Math.max(0, context.deductionRows.length - LAYOUT.mainItemLimit),
  });

  const summaryY = tableY + tableHeight + 16;
  drawPaySummary(doc, context, summaryY);
  drawDetailsPanel(doc, context, summaryY + 80);
}

function drawDetailTablePage(doc, context, config) {
  doc.addPage();
  drawHeader(doc, context, true);

  const x = LAYOUT.margin;
  const width = LAYOUT.contentWidth;
  const titleY = 145;
  const tableY = 180;
  const headerHeight = 30;
  const rowHeight = 28;
  const amountWidth = 100;
  const treatmentWidth = 88;
  const categoryWidth = 120;
  const labelWidth = width - amountWidth - treatmentWidth - categoryWidth - 44;

  fitText(doc, config.title, x, titleY, 350, {
    font: 'Helvetica-Bold', size: 14, color: COLORS.ink,
  });
  fitText(doc, `Items ${config.startIndex}-${config.startIndex + config.rows.length - 1} of ${config.totalItems}`, x + 355, titleY + 3, width - 355, {
    size: 7.5, color: COLORS.muted, align: 'right',
  });

  doc.roundedRect(x, tableY, width, headerHeight, 6).fill(COLORS.ink);
  const columns = [
    { label: 'DESCRIPTION', x: x + 12, width: labelWidth },
    { label: 'CATEGORY', x: x + 20 + labelWidth, width: categoryWidth },
    { label: 'TREATMENT', x: x + 28 + labelWidth + categoryWidth, width: treatmentWidth },
    { label: `AMOUNT (${safeText(context.payslip.currency)})`, x: x + width - amountWidth - 12, width: amountWidth, align: 'right' },
  ];
  columns.forEach((column) => fitText(doc, column.label, column.x, tableY + 11, column.width, {
    font: 'Helvetica-Bold', size: 6.8, minimumSize: 5.8, color: COLORS.white, align: column.align,
  }));

  config.rows.forEach((row, index) => {
    const rowY = tableY + headerHeight + (index * rowHeight);
    if (index % 2 === 1) doc.rect(x, rowY, width, rowHeight).fill(COLORS.surface);
    doc.moveTo(x, rowY + rowHeight).lineTo(x + width, rowY + rowHeight).lineWidth(0.4).stroke(COLORS.lineSoft);
    fitText(doc, row.label, x + 12, rowY + 10, labelWidth, { size: 8, minimumSize: 6.2 });
    fitText(doc, row.category, x + 20 + labelWidth, rowY + 10, categoryWidth, { size: 7.5, minimumSize: 6, color: COLORS.muted });
    fitText(doc, row.treatment, x + 28 + labelWidth + categoryWidth, rowY + 10, treatmentWidth, { size: 7.2, minimumSize: 6, color: COLORS.muted });
    fitText(doc, formatMoney(context.payslip.currency, row.amount), x + width - amountWidth - 12, rowY + 9, amountWidth, {
      font: 'Helvetica-Bold', size: 8, minimumSize: 6.2, color: COLORS.ink, align: 'right',
    });
  });

  const tableBottom = tableY + headerHeight + (config.rows.length * rowHeight);
  if (config.isFinalChunk) {
    doc.rect(x, tableBottom, width, 36).fill(COLORS.surface);
    fitText(doc, config.totalLabel.toUpperCase(), x + 12, tableBottom + 13, width - amountWidth - 34, {
      font: 'Helvetica-Bold', size: 7.5, color: COLORS.muted,
    });
    fitText(doc, formatMoney(context.payslip.currency, config.totalAmount), x + width - amountWidth - 12, tableBottom + 11, amountWidth, {
      font: 'Helvetica-Bold', size: 9, minimumSize: 6.5, color: COLORS.ink, align: 'right',
    });
  } else {
    fitText(doc, 'Continued on the next page', x, tableBottom + 14, width, {
      size: 7.5, color: COLORS.muted, align: 'right',
    });
  }
}

function appendDetailPages(doc, context, config) {
  if (config.rows.length === 0) return;
  for (let index = 0; index < config.rows.length; index += LAYOUT.detailPageItemLimit) {
    const chunk = config.rows.slice(index, index + LAYOUT.detailPageItemLimit);
    drawDetailTablePage(doc, context, {
      ...config,
      rows: chunk,
      startIndex: config.startIndex + index,
      totalItems: config.totalItems,
      isFinalChunk: index + chunk.length >= config.rows.length,
    });
  }
}

function addFooters(doc, organizationName) {
  const range = doc.bufferedPageRange();
  for (let offset = 0; offset < range.count; offset += 1) {
    doc.switchToPage(range.start + offset);
    const left = LAYOUT.margin;
    const width = LAYOUT.contentWidth;
    doc.moveTo(left, LAYOUT.footerY).lineTo(left + width, LAYOUT.footerY).lineWidth(0.5).stroke(COLORS.lineSoft);
    fitText(doc, `${organizationName}  |  Confidential payroll document`, left, LAYOUT.footerY + 10, 360, {
      size: 6.8, minimumSize: 6, color: COLORS.faint,
    });
    fitText(doc, `Page ${offset + 1} of ${range.count}`, left + 400, LAYOUT.footerY + 10, width - 400, {
      font: 'Helvetica-Bold', size: 6.8, color: COLORS.faint, align: 'right',
    });
  }
}

function createPayslipPdf({ payslip, organization = {} }) {
  if (!payslip) throw new Error('A payslip is required to generate a PDF.');

  const organizationDetails = getOrganizationDetails(organization);
  const legalEmployerName = safeText(payslip.employerEntitySnapshot?.legalName, '');
  if (legalEmployerName) organizationDetails.name = legalEmployerName;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    bufferPages: true,
    compress: true,
    info: {
      Title: `Payslip ${safeText(payslip.payslipNumber, '')}`,
      Author: organizationDetails.name,
      Subject: `Payslip for ${safeText(payslip.employeeSnapshot?.name, 'employee')}`,
      Creator: 'Seemplify Payroll',
    },
  });

  const earningRows = buildEarningRows(payslip);
  const deductionRows = buildDeductionRows(payslip);
  const employerRows = normalizeRows(payslip.employerContributions, 'employer');
  const grossPay = summaryOrLineTotal(payslip.earningsSummary?.grossPay, earningRows);
  const totalDeductions = summaryOrLineTotal(payslip.deductionsSummary?.totalDeductions, deductionRows);
  const storedNetPay = Number(payslip.netPay);
  const netPay = Number.isFinite(storedNetPay) ? storedNetPay : grossPay - totalDeductions;
  const employerContributionTotal = summaryOrLineTotal(payslip.totalEmployerContributions, employerRows);

  const context = {
    payslip,
    org: organizationDetails,
    periodLabel: getPeriodLabel(payslip.payPeriod),
    earningRows,
    deductionRows,
    employerRows,
    grossPay,
    totalDeductions,
    netPay,
    employerContributionTotal,
  };

  drawMainPage(doc, context);

  appendDetailPages(doc, context, {
    title: 'Additional earnings',
    rows: earningRows.slice(LAYOUT.mainItemLimit),
    startIndex: LAYOUT.mainItemLimit + 1,
    totalItems: earningRows.length,
    totalLabel: 'Total earnings',
    totalAmount: grossPay,
  });
  appendDetailPages(doc, context, {
    title: 'Additional deductions',
    rows: deductionRows.slice(LAYOUT.mainItemLimit),
    startIndex: LAYOUT.mainItemLimit + 1,
    totalItems: deductionRows.length,
    totalLabel: 'Total deductions',
    totalAmount: totalDeductions,
  });

  if (employerRows.length > 3) {
    appendDetailPages(doc, context, {
      title: 'Employer contributions (information only)',
      rows: employerRows,
      startIndex: 1,
      totalItems: employerRows.length,
      totalLabel: 'Total employer contributions',
      totalAmount: employerContributionTotal,
    });
  }

  addFooters(doc, context.org.name);
  return doc;
}

module.exports = {
  createPayslipPdf,
};
