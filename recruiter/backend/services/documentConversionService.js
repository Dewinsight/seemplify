const { execFile } = require('child_process');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { promisify } = require('util');
const mammoth = require('mammoth');
const onboardingPdfService = require('./onboardingPdfService');

const execFileAsync = promisify(execFile);
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const COMMON_LIBREOFFICE_PATHS = [
  'soffice',
  'libreoffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
  '/usr/bin/libreoffice',
  '/usr/local/bin/libreoffice'
];

let cachedLibreOfficePath;
let checkedLibreOfficePath = false;

function conversionError(message, { statusCode = 422, cause } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (cause) error.cause = cause;
  return error;
}

function configuredLibreOfficePaths() {
  return [
    process.env.LIBREOFFICE_PATH,
    process.env.SOFFICE_PATH,
    process.env.DOCUMENT_CONVERTER_PATH,
    ...COMMON_LIBREOFFICE_PATHS
  ].filter(Boolean);
}

async function executableWorks(executablePath) {
  try {
    await execFileAsync(executablePath, ['--version'], {
      timeout: 8000,
      windowsHide: true
    });
    return true;
  } catch (error) {
    return false;
  }
}

async function findLibreOfficeExecutable() {
  if (checkedLibreOfficePath) return cachedLibreOfficePath;

  for (const candidate of configuredLibreOfficePaths()) {
    if (await executableWorks(candidate)) {
      cachedLibreOfficePath = candidate;
      checkedLibreOfficePath = true;
      return cachedLibreOfficePath;
    }
  }

  checkedLibreOfficePath = true;
  cachedLibreOfficePath = '';
  return '';
}

async function convertDocxWithLibreOffice(filePath) {
  const executable = await findLibreOfficeExecutable();
  if (!executable) {
    throw conversionError(
      'DOCX layout-preserving conversion is not configured. Install LibreOffice/soffice on the server or set LIBREOFFICE_PATH, or upload a PDF version to preserve the exact document structure.'
    );
  }

  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'seemplify-docx-'));
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'seemplify-lo-'));
  try {
    await execFileAsync(executable, [
      '--headless',
      '--nologo',
      '--nofirststartwizard',
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      '--convert-to',
      'pdf',
      '--outdir',
      outDir,
      filePath
    ], {
      timeout: Number(process.env.DOCX_CONVERSION_TIMEOUT_MS || 90000),
      windowsHide: true
    });

    const expectedPath = path.join(outDir, `${path.basename(filePath, path.extname(filePath))}.pdf`);
    const files = await fs.readdir(outDir);
    const pdfPath = files.includes(path.basename(expectedPath))
      ? expectedPath
      : path.join(outDir, files.find((file) => file.toLowerCase().endsWith('.pdf')) || '');

    if (!pdfPath || !pdfPath.toLowerCase().endsWith('.pdf')) {
      throw conversionError('DOCX conversion did not produce a PDF snapshot.');
    }

    return fs.readFile(pdfPath);
  } catch (error) {
    if (error.statusCode) throw error;
    throw conversionError(
      'DOCX could not be converted while preserving layout. Upload a PDF version of this document, or check the server LibreOffice/soffice installation.',
      { cause: error }
    );
  } finally {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function convertDocxWithLossyFallback(filePath, { title } = {}) {
  const extracted = await mammoth.extractRawText({ path: filePath });
  const builderBlocks = [
    { id: 'heading-upload', type: 'heading', content: { text: title || 'Uploaded document' } },
    { id: 'text-upload', type: 'text', content: { text: extracted.value || '' } }
  ];
  return onboardingPdfService.renderBuilderDocumentToBuffer({
    title,
    builderBlocks,
    variables: {}
  });
}

async function convertUploadedDocxToPdfBuffer(filePath, options = {}) {
  try {
    return await convertDocxWithLibreOffice(filePath);
  } catch (error) {
    if (String(process.env.ALLOW_LOSSY_ONBOARDING_DOCX_RENDER || '').toLowerCase() === 'true') {
      return convertDocxWithLossyFallback(filePath, options);
    }
    throw error;
  }
}

module.exports = {
  DOCX_MIME_TYPE,
  convertUploadedDocxToPdfBuffer,
  findLibreOfficeExecutable
};
