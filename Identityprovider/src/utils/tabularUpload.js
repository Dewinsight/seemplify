/**
 * Shared CSV / Excel upload parsing.
 *
 * Every uploaded sheet in the identity provider (campaign audiences, member
 * imports) goes through the same three steps: read the raw grid, work out the
 * header row, then match headers to the fields the feature expects.
 */
import XLSX from 'xlsx'

export function normalizeHeader(value = '') {
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

export function toCsvCell(value = '') {
  const cell = String(value ?? '')
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

export function buildCsv(rows = []) {
  return rows.map((row) => (Array.isArray(row) ? row : []).map(toCsvCell).join(',')).join('\r\n')
}

export function trimCell(value) {
  return String(value ?? '').trim()
}

export function rowHasValues(row = []) {
  return row.some((cell) => String(cell || '').trim() !== '')
}

export function normalizeSheetRows(rows = []) {
  return rows.map((row) => (Array.isArray(row) ? row.map(trimCell) : []))
}

export function buildUniqueHeaders(rawHeaders = []) {
  const seen = new Map()
  return rawHeaders.map((value, index) => {
    const base = trimCell(value) || `Column ${index + 1}`
    const count = seen.get(base) || 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base} (${count + 1})`
  })
}

export function getFileExtension(fileName = '') {
  const match = String(fileName || '').trim().toLowerCase().match(/\.([a-z0-9]+)$/)
  return match ? match[1] : ''
}

export function isExcelFile(fileName = '') {
  const extension = getFileExtension(fileName)
  return extension === 'xlsx' || extension === 'xls'
}

export function detectColumnMap(headers = [], fieldAliases = {}) {
  const normalizedHeaders = headers.map((header) => ({
    raw: header,
    normalized: normalizeHeader(header)
  }))

  const result = {}
  for (const [field, aliases] of Object.entries(fieldAliases || {})) {
    const match = normalizedHeaders.find((header) => aliases.includes(header.normalized))
    if (match) {
      result[field] = match.raw
    }
  }

  return result
}

export function normalizeColumnMap(columnMap = {}, headers = []) {
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

export function rowsToRecords(rows = [], headers = []) {
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, trimCell(row[index])])))
}

export function extractRowsFromWorkbook(buffer, requestedSheetName = '') {
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

export function extractRowsFromSource({
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

/**
 * Split a normalized grid into its header row and the data rows below it.
 * Fully blank rows are dropped so an exported sheet with spacer rows still
 * lines up with its header.
 */
export function summarizeRows(rows = []) {
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
