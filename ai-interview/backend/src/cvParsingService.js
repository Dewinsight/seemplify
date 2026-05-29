const mammoth = require('mammoth');
const { chatCompletion, extractJsonObject } = require('./llmClient');

let pdfjsLib = null;

async function loadPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsLib;
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractEmail(text) {
  return String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
}

function extractPhone(text) {
  return String(text || '').match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() || '';
}

function splitNameFromText(text) {
  const firstLine = String(text || '').split(/\r?\n/).map((line) => compactWhitespace(line)).find((line) => line && !line.includes('@')) || '';
  const words = firstLine.split(/\s+/).filter((word) => /^[A-Za-z'-]+$/.test(word)).slice(0, 4);
  return words.length >= 2 ? words.join(' ') : '';
}

function normalizeProfile(value = {}, resumeText = '') {
  const name = compactWhitespace(value.name || [value.firstName, value.lastName].filter(Boolean).join(' ')) || splitNameFromText(resumeText);
  const [firstName = '', ...rest] = name.split(/\s+/).filter(Boolean);
  return {
    firstName: compactWhitespace(value.firstName || firstName),
    lastName: compactWhitespace(value.lastName || rest.join(' ')),
    name: name || compactWhitespace([value.firstName, value.lastName].filter(Boolean).join(' ')),
    email: compactWhitespace(value.email || extractEmail(resumeText)).toLowerCase(),
    phone: compactWhitespace(value.phone || extractPhone(resumeText)),
    location: compactWhitespace(value.location),
    currentTitle: compactWhitespace(value.currentTitle),
    yearsOfExperience: value.yearsOfExperience !== undefined ? Number(value.yearsOfExperience) || null : null,
    skills: Array.isArray(value.skills) ? value.skills.map((item) => compactWhitespace(item)).filter(Boolean).slice(0, 40) : [],
    education: Array.isArray(value.education) ? value.education.map((item) => compactWhitespace(item)).filter(Boolean).slice(0, 12) : [],
    workExperience: Array.isArray(value.workExperience) ? value.workExperience.map((item) => ({
      title: compactWhitespace(item?.title),
      company: compactWhitespace(item?.company),
      duration: compactWhitespace(item?.duration),
      summary: compactWhitespace(item?.summary)
    })).filter((item) => item.title || item.company || item.summary).slice(0, 16) : [],
    summary: compactWhitespace(value.summary),
    strengths: Array.isArray(value.strengths) ? value.strengths.map((item) => compactWhitespace(item)).filter(Boolean).slice(0, 12) : [],
    risks: Array.isArray(value.risks) ? value.risks.map((item) => compactWhitespace(item)).filter(Boolean).slice(0, 12) : []
  };
}

class CvParsingService {
  async extractText(file) {
    const mimeType = file.mimetype || '';
    const fileName = String(file.originalname || '').toLowerCase();
    const buffer = file.buffer;

    if (!buffer?.length) throw new Error('Uploaded file is empty.');

    if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
      const pdfjs = await loadPdfJs();
      const document = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str).join(' '));
      }
      return pages.join('\n\n').trim();
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileName.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer });
      return String(result.value || '').trim();
    }

    if (mimeType.startsWith('text/') || fileName.endsWith('.txt')) {
      return buffer.toString('utf8').trim();
    }

    throw new Error('Only text-based PDF, DOCX, and TXT CV files are supported.');
  }

  async analyzeResumeText(resumeText) {
    if (!resumeText || resumeText.trim().length < 50) {
      throw new Error('Could not extract enough text from this CV. Upload a text-based PDF/DOCX or enter the candidate manually.');
    }

    const result = await chatCompletion([
      {
        role: 'system',
        content: `Extract candidate profile data from a CV.
Return JSON only.
Do not invent missing facts. Use null or empty arrays for unavailable data.`
      },
      {
        role: 'user',
        content: `CV TEXT:
${resumeText.slice(0, 18000)}

Return:
{
  "name": "",
  "firstName": "",
  "lastName": "",
  "email": "",
  "phone": "",
  "location": "",
  "currentTitle": "",
  "yearsOfExperience": number | null,
  "skills": [],
  "education": [],
  "workExperience": [{"title":"","company":"","duration":"","summary":""}],
  "summary": "",
  "strengths": [],
  "risks": []
}`
      }
    ], {
      temperature: 0.2,
      maxTokens: 1600,
      response_format: { type: 'json_object' }
    });

    const parsed = extractJsonObject(result.content) || {};
    return {
      profile: normalizeProfile(parsed, resumeText),
      resumeText,
      ai: { model: result.model, analyzedAt: new Date().toISOString() }
    };
  }

  async parseAndAnalyze(file) {
    const resumeText = await this.extractText(file);
    return this.analyzeResumeText(resumeText);
  }
}

module.exports = new CvParsingService();
