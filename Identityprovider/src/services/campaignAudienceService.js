import XLSX from 'xlsx'

export const CAMPAIGN_AUDIENCE_FIELDS = [
  { key: 'email', label: 'Email', required: true, description: 'Primary recipient email address.' },
  { key: 'firstName', label: 'First Name', description: 'Used for personalization tokens.' },
  { key: 'lastName', label: 'Last Name', description: 'Used for personalization tokens.' },
  { key: 'role', label: 'Role', description: 'Primary role or position label.' },
  { key: 'jobTitle', label: 'Job Title', description: 'Specific job title for the contact.' },
  { key: 'jobLevel', label: 'Job Level', description: 'Seniority or level data.' },
  { key: 'department', label: 'Department', description: 'Department or function.' },
  { key: 'companyName', label: 'Company Name', description: 'Organization name for the recipient.' },
  { key: 'industry', label: 'Industry', description: 'Industry or sector for the company.' },
  { key: 'companyHeadCount', label: 'Company Headcount', description: 'Employee count or size band.' },
  { key: 'location', label: 'Location', description: 'Country, region, or office.' },
  { key: 'companyDescription', label: 'Company Description', description: 'Short description or notes.' },
  { key: 'tailoredMessage', label: 'Tailored Message', description: 'Custom message used for personalization.' }
]

const FIELD_ALIASES = {
  email: ['email', 'workemail', 'emailaddress'],
  firstName: ['firstname', 'first', 'fname', 'givenname'],
  lastName: ['lastname', 'last', 'lname', 'surname', 'familyname'],
  role: ['role', 'title', 'position'],
  jobTitle: ['jobtitle'],
  jobLevel: ['joblevel', 'seniority', 'level'],
  department: ['department', 'function', 'team'],
  companyName: ['company', 'companyname', 'organisation', 'organization'],
  industry: ['industry', 'sector'],
  companyHeadCount: ['companyheadcount', 'headcount', 'employees', 'employeecount'],
  location: ['location', 'country', 'region', 'city'],
  companyDescription: ['companydescription', 'description', 'aboutcompany'],
  tailoredMessage: ['tailoredmessage', 'custommessage', 'message', 'intro']
}

function normalizeHeader(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function parseCsvLine(line = '') {
  const cells = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      cells.push(current)
      current = ''
      continue
    }

    current += char
  }

  cells.push(current)
  return cells
}

export function parseCsv(text = '') {
  const rows = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '""'
        index += 1
      } else {
        inQuotes = !inQuotes
        current += char
      }
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1
      }
      if (current.trim()) {
        rows.push(parseCsvLine(current))
      }
      current = ''
      continue
    }

    current += char
  }

  if (current.trim()) {
    rows.push(parseCsvLine(current))
  }

  return rows
}

function isValidEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function getFileExtension(fileName = '') {
  const match = String(fileName || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/)
  return match ? match[1] : ''
}

function isExcelFile(fileName = '') {
  const extension = getFileExtension(fileName)
  return extension === 'xlsx' || extension === 'xls'
}

function trimCell(value) {
  return String(value ?? '').trim()
}

function normalizeSheetRows(rows = []) {
  return rows.map((row) => (Array.isArray(row) ? row.map(trimCell) : []))
}

function rowHasValues(row = []) {
  return row.some((cell) => String(cell || '').trim() !== '')
}

function buildUniqueHeaders(rawHeaders = []) {
  const seen = new Map()
  return rawHeaders.map((value, index) => {
    const base = trimCell(value) || `Column ${index + 1}`
    const count = seen.get(base) || 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base} (${count + 1})`
  })
}

function detectColumnMap(headers = []) {
  const normalizedHeaders = headers.map((header) => ({
    raw: header,
    normalized: normalizeHeader(header)
  }))

  const result = {}
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const match = normalizedHeaders.find((header) => aliases.includes(header.normalized))
    if (match) {
      result[field] = match.raw
    }
  }

  return result
}

function normalizeColumnMap(columnMap = {}, headers = []) {
  const allowedHeaders = new Set(headers)
  const normalized = {}

  Object.entries(columnMap || {}).forEach(([field, header]) => {
    const nextHeader = String(header || '').trim()
    if (!nextHeader) return
    if (!allowedHeaders.has(nextHeader)) return
    normalized[field] = nextHeader
  })

  return normalized
}

function rowsToRecords(rows = [], headers = []) {
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, trimCell(row[index])])))
}

function extractRowsFromWorkbook(buffer, requestedSheetName = '') {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    raw: false,
    cellDates: false
  })

  const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : []
  if (sheetNames.length === 0) {
    return {
      sheetNames: [],
      selectedSheetName: '',
      rows: []
    }
  }

  const preferredName = requestedSheetName && sheetNames.includes(requestedSheetName)
    ? requestedSheetName
    : sheetNames.find((sheetName) => {
        const worksheet = workbook.Sheets[sheetName]
        const rows = normalizeSheetRows(XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
          raw: false
        }))
        return rows.some(rowHasValues)
      }) || sheetNames[0]

  const worksheet = workbook.Sheets[preferredName]
  const rows = normalizeSheetRows(XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false
  }))

  return {
    sheetNames,
    selectedSheetName: preferredName,
    rows
  }
}

function extractRowsFromSource({
  buffer = null,
  csvText = '',
  sourceFileName = '',
  sheetName = ''
} = {}) {
  if (buffer && isExcelFile(sourceFileName)) {
    const workbook = extractRowsFromWorkbook(buffer, sheetName)
    return {
      sourceType: 'excel',
      sourceFileName,
      ...workbook
    }
  }

  const text = csvText || (buffer ? buffer.toString('utf-8') : '')
  return {
    sourceType: 'csv',
    sourceFileName,
    sheetNames: [],
    selectedSheetName: '',
    rows: normalizeSheetRows(parseCsv(text))
  }
}

function summarizeRows(rows = []) {
  const normalizedRows = normalizeSheetRows(rows)
  if (normalizedRows.length === 0) {
    return {
      headers: [],
      dataRows: [],
      totalRows: 0
    }
  }

  const nonEmptyRows = normalizedRows.filter(rowHasValues)
  if (nonEmptyRows.length === 0) {
    return {
      headers: [],
      dataRows: [],
      totalRows: 0
    }
  }

  const headers = buildUniqueHeaders(nonEmptyRows[0])
  const dataRows = nonEmptyRows
    .slice(1)
    .map((row) => headers.map((_, index) => trimCell(row[index])))
    .filter(rowHasValues)

  return {
    headers,
    dataRows,
    totalRows: dataRows.length
  }
}

export function previewAudienceUpload({
  buffer = null,
  csvText = '',
  sourceFileName = '',
  sheetName = '',
  columnMap = {}
} = {}) {
  const extracted = extractRowsFromSource({
    buffer,
    csvText,
    sourceFileName,
    sheetName
  })

  const summary = summarizeRows(extracted.rows)
  if (summary.headers.length === 0) {
    return {
      sourceType: extracted.sourceType,
      sourceFileName,
      sheetNames: extracted.sheetNames,
      selectedSheetName: extracted.selectedSheetName,
      headers: [],
      sampleRows: [],
      totalRows: 0,
      columnMap: {},
      errors: ['The uploaded file did not contain a usable header row.']
    }
  }

  const detectedColumnMap = detectColumnMap(summary.headers)
  const mappedColumns = normalizeColumnMap(Object.keys(columnMap || {}).length > 0 ? columnMap : detectedColumnMap, summary.headers)

  return {
    sourceType: extracted.sourceType,
    sourceFileName,
    sheetNames: extracted.sheetNames,
    selectedSheetName: extracted.selectedSheetName,
    headers: summary.headers,
    sampleRows: summary.dataRows.slice(0, 6),
    totalRows: summary.totalRows,
    columnMap: mappedColumns,
    errors: []
  }
}

function buildAudienceContacts({ headers = [], dataRows = [], columnMap = {} } = {}) {
  const effectiveColumnMap = normalizeColumnMap(columnMap, headers)
  const records = rowsToRecords(dataRows, headers)
  const dedupe = new Set()
  const contacts = []
  let invalidRecipients = 0
  let duplicateRecipients = 0

  for (let rowIndex = 0; rowIndex < records.length; rowIndex += 1) {
    const record = records[rowIndex]
    const emailValue = record[effectiveColumnMap.email || ''] || ''
    const normalizedEmail = String(emailValue || '').trim().toLowerCase()

    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      invalidRecipients += 1
      continue
    }

    if (dedupe.has(normalizedEmail)) {
      duplicateRecipients += 1
      continue
    }

    dedupe.add(normalizedEmail)

    const mappedHeaders = new Set(Object.values(effectiveColumnMap))
    const metadata = {}
    headers.forEach((header) => {
      if (mappedHeaders.has(header)) return
      metadata[header] = record[header]
    })

    contacts.push({
      email: normalizedEmail,
      normalizedEmail,
      firstName: record[effectiveColumnMap.firstName || ''] || '',
      lastName: record[effectiveColumnMap.lastName || ''] || '',
      role: record[effectiveColumnMap.role || ''] || '',
      jobTitle: record[effectiveColumnMap.jobTitle || ''] || '',
      jobLevel: record[effectiveColumnMap.jobLevel || ''] || '',
      department: record[effectiveColumnMap.department || ''] || '',
      companyName: record[effectiveColumnMap.companyName || ''] || '',
      industry: record[effectiveColumnMap.industry || ''] || '',
      companyHeadCount: record[effectiveColumnMap.companyHeadCount || ''] || '',
      location: record[effectiveColumnMap.location || ''] || '',
      companyDescription: record[effectiveColumnMap.companyDescription || ''] || '',
      tailoredMessage: record[effectiveColumnMap.tailoredMessage || ''] || '',
      metadata,
      sourceRowNumber: rowIndex + 2
    })
  }

  return {
    contacts,
    columnMap: effectiveColumnMap,
    summary: {
      totalRows: records.length,
      validRecipients: contacts.length,
      invalidRecipients,
      duplicateRecipients,
      skippedRecipients: invalidRecipients + duplicateRecipients,
      lastImportedAt: new Date()
    }
  }
}

export function importAudienceFromUpload({
  buffer = null,
  csvText = '',
  audienceName = 'Uploaded Audience',
  sourceFileName = '',
  sheetName = '',
  columnMap = {}
} = {}) {
  const preview = previewAudienceUpload({
    buffer,
    csvText,
    sourceFileName,
    sheetName,
    columnMap
  })

  if (preview.errors.length > 0) {
    return {
      contacts: [],
      columnMap: {},
      summary: {
        totalRows: 0,
        validRecipients: 0,
        invalidRecipients: 0,
        duplicateRecipients: 0,
        skippedRecipients: 0
      },
      sourceType: preview.sourceType,
      sourceFileName,
      audienceName,
      selectedSheetName: preview.selectedSheetName,
      errors: preview.errors
    }
  }

  if (!preview.columnMap.email) {
    return {
      contacts: [],
      columnMap: preview.columnMap,
      summary: {
        totalRows: preview.totalRows,
        validRecipients: 0,
        invalidRecipients: 0,
        duplicateRecipients: 0,
        skippedRecipients: 0
      },
      sourceType: preview.sourceType,
      sourceFileName,
      audienceName,
      selectedSheetName: preview.selectedSheetName,
      errors: ['Map the Email field before importing the audience.']
    }
  }

  const extracted = extractRowsFromSource({
    buffer,
    csvText,
    sourceFileName,
    sheetName: preview.selectedSheetName || sheetName
  })
  const { headers, dataRows } = summarizeRows(extracted.rows)
  const imported = buildAudienceContacts({
    headers,
    dataRows,
    columnMap: preview.columnMap
  })

  return {
    ...imported,
    sourceType: preview.sourceType,
    sourceFileName,
    audienceName,
    selectedSheetName: preview.selectedSheetName,
    errors: []
  }
}

export function slugifyValue(value = '', fallback = 'campaign-audience') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || fallback
}

export function importAudienceFromCsv({
  csvText = '',
  audienceName = 'Uploaded Audience',
  sourceFileName = ''
} = {}) {
  return importAudienceFromUpload({
    csvText,
    audienceName,
    sourceFileName
  })
}
