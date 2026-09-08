import {
  detectColumnMap,
  extractRowsFromSource,
  normalizeColumnMap,
  parseCsv,
  rowsToRecords,
  summarizeRows
} from '../utils/tabularUpload.js'

export { parseCsv }

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

function isValidEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

function detectAudienceColumnMap(headers = []) {
  return detectColumnMap(headers, FIELD_ALIASES)
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

  const detectedColumnMap = detectAudienceColumnMap(summary.headers)
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
