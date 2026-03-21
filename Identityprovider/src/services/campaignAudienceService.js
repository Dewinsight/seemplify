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

const FIELD_ALIASES = {
  email: ['email', 'workemail', 'emailaddress'],
  firstName: ['firstname', 'first', 'fname'],
  lastName: ['lastname', 'last', 'lname'],
  role: ['role', 'title', 'position'],
  jobTitle: ['jobtitle'],
  jobLevel: ['joblevel'],
  department: ['department'],
  companyName: ['company', 'companyname', 'organisation', 'organization'],
  industry: ['industry'],
  companyHeadCount: ['companyheadcount', 'headcount', 'employees'],
  location: ['location', 'country', 'region'],
  companyDescription: ['companydescription', 'description'],
  tailoredMessage: ['tailoredmessage', 'custommessage', 'message']
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

function isValidEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
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
  const rows = parseCsv(csvText)
  if (rows.length === 0) {
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
      sourceFileName,
      audienceName,
      errors: ['The uploaded CSV was empty.']
    }
  }

  const headers = rows[0].map((value) => String(value || '').trim())
  const columnMap = detectColumnMap(headers)
  const dedupe = new Set()
  const contacts = []
  let invalidRecipients = 0
  let duplicateRecipients = 0

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    const record = Object.fromEntries(headers.map((header, index) => [header, String(row[index] || '').trim()]))
    const emailValue = record[columnMap.email || ''] || ''
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
    const metadata = {}
    headers.forEach((header) => {
      if (header === columnMap.email) return
      if (Object.values(columnMap).includes(header)) return
      metadata[header] = record[header]
    })

    contacts.push({
      email: normalizedEmail,
      normalizedEmail,
      firstName: record[columnMap.firstName || ''] || '',
      lastName: record[columnMap.lastName || ''] || '',
      role: record[columnMap.role || ''] || '',
      jobTitle: record[columnMap.jobTitle || ''] || '',
      jobLevel: record[columnMap.jobLevel || ''] || '',
      department: record[columnMap.department || ''] || '',
      companyName: record[columnMap.companyName || ''] || '',
      industry: record[columnMap.industry || ''] || '',
      companyHeadCount: record[columnMap.companyHeadCount || ''] || '',
      location: record[columnMap.location || ''] || '',
      companyDescription: record[columnMap.companyDescription || ''] || '',
      tailoredMessage: record[columnMap.tailoredMessage || ''] || '',
      metadata,
      sourceRowNumber: rowIndex + 1
    })
  }

  return {
    contacts,
    columnMap,
    summary: {
      totalRows: Math.max(rows.length - 1, 0),
      validRecipients: contacts.length,
      invalidRecipients,
      duplicateRecipients,
      skippedRecipients: invalidRecipients + duplicateRecipients,
      lastImportedAt: new Date()
    },
    sourceFileName,
    audienceName,
    errors: []
  }
}
