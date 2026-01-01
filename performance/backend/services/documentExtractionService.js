const fs = require('fs');
const path = require('path');

/**
 * Document Extraction Service
 * Extracts text from various document formats (PDF, DOCX, TXT, etc.)
 */
class DocumentExtractionService {
  constructor() {
    this.supportedFormats = ['pdf', 'docx', 'doc', 'txt', 'pptx'];
  }

  /**
   * Extract text from a document
   * @param {string} filePath - Path to the file
   * @param {string} fileType - File extension
   * @returns {Promise<{text: string, pageCount: number, wordCount: number, metadata: object}>}
   */
  async extractText(filePath, fileType) {
    const type = fileType.toLowerCase().replace('.', '');

    switch (type) {
      case 'txt':
        return this.extractFromTxt(filePath);
      case 'pdf':
        return this.extractFromPdf(filePath);
      case 'docx':
      case 'doc':
        return this.extractFromDocx(filePath);
      case 'pptx':
        return this.extractFromPptx(filePath);
      default:
        throw new Error(`Unsupported file type: ${type}`);
    }
  }

  /**
   * Extract text from TXT file
   */
  async extractFromTxt(filePath) {
    const text = await fs.promises.readFile(filePath, 'utf-8');
    const wordCount = this.countWords(text);

    return {
      text,
      pageCount: 1,
      wordCount,
      metadata: {
        encoding: 'utf-8',
        size: text.length
      }
    };
  }

  /**
   * Extract text from PDF file
   * Uses pdf-parse library
   */
  async extractFromPdf(filePath) {
    try {
      const pdfParse = require('pdf-parse');
      const dataBuffer = await fs.promises.readFile(filePath);
      const data = await pdfParse(dataBuffer);

      return {
        text: data.text,
        pageCount: data.numpages,
        wordCount: this.countWords(data.text),
        metadata: {
          title: data.info?.Title || null,
          author: data.info?.Author || null,
          subject: data.info?.Subject || null,
          creator: data.info?.Creator || null,
          creationDate: data.info?.CreationDate || null,
          version: data.version
        }
      };
    } catch (error) {
      console.error('PDF extraction error:', error);
      // Fallback: try OCR if text extraction fails
      if (error.message.includes('no text') || error.message.includes('empty')) {
        return {
          text: '',
          pageCount: 0,
          wordCount: 0,
          metadata: { needsOcr: true },
          error: 'PDF may be image-based, OCR recommended'
        };
      }
      throw error;
    }
  }

  /**
   * Extract text from DOCX file
   * Uses mammoth library
   */
  async extractFromDocx(filePath) {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });

      return {
        text: result.value,
        pageCount: null, // DOCX doesn't have clear page boundaries
        wordCount: this.countWords(result.value),
        metadata: {
          messages: result.messages
        }
      };
    } catch (error) {
      console.error('DOCX extraction error:', error);
      throw error;
    }
  }

  /**
   * Extract text from PPTX file
   */
  async extractFromPptx(filePath) {
    try {
      const AdmZip = require('adm-zip');
      const xml2js = require('xml2js');

      const zip = new AdmZip(filePath);
      const zipEntries = zip.getEntries();
      let allText = [];
      let slideCount = 0;

      for (const entry of zipEntries) {
        if (entry.entryName.match(/ppt\/slides\/slide\d+\.xml$/)) {
          slideCount++;
          const content = zip.readAsText(entry);

          // Parse XML and extract text
          const parser = new xml2js.Parser();
          const result = await parser.parseStringPromise(content);

          // Extract text from all text elements
          const texts = this.extractTextFromXml(result);
          allText.push(`--- Slide ${slideCount} ---\n${texts.join('\n')}`);
        }
      }

      const fullText = allText.join('\n\n');

      return {
        text: fullText,
        pageCount: slideCount,
        wordCount: this.countWords(fullText),
        metadata: {
          slideCount
        }
      };
    } catch (error) {
      console.error('PPTX extraction error:', error);
      throw error;
    }
  }

  /**
   * Recursively extract text from XML object
   */
  extractTextFromXml(obj) {
    const texts = [];

    const traverse = (node) => {
      if (typeof node === 'string') {
        texts.push(node.trim());
      } else if (Array.isArray(node)) {
        node.forEach(traverse);
      } else if (typeof node === 'object' && node !== null) {
        // Look for text elements
        if (node['a:t']) {
          node['a:t'].forEach(t => {
            if (typeof t === 'string') texts.push(t);
            else if (t._) texts.push(t._);
          });
        }
        Object.values(node).forEach(traverse);
      }
    };

    traverse(obj);
    return texts.filter(t => t.length > 0);
  }

  /**
   * Count words in text
   */
  countWords(text) {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Check if file type is supported
   */
  isSupported(fileType) {
    const type = fileType.toLowerCase().replace('.', '');
    return this.supportedFormats.includes(type);
  }

  /**
   * Clean and normalize extracted text
   */
  cleanText(text) {
    if (!text) return '';

    return text
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      // Remove special characters but keep punctuation
      .replace(/[^\w\s.,!?;:'"()-]/g, ' ')
      // Remove multiple spaces
      .replace(/  +/g, ' ')
      // Trim
      .trim();
  }

  /**
   * Split text into chunks for AI processing
   * @param {string} text - Full text
   * @param {number} maxChunkSize - Max characters per chunk
   * @param {number} overlap - Overlap between chunks
   */
  splitIntoChunks(text, maxChunkSize = 4000, overlap = 200) {
    const chunks = [];
    let start = 0;

    while (start < text.length) {
      let end = start + maxChunkSize;

      // Try to end at a sentence boundary
      if (end < text.length) {
        const lastPeriod = text.lastIndexOf('.', end);
        const lastNewline = text.lastIndexOf('\n', end);
        const boundary = Math.max(lastPeriod, lastNewline);

        if (boundary > start + maxChunkSize / 2) {
          end = boundary + 1;
        }
      }

      chunks.push({
        text: text.slice(start, end).trim(),
        startIndex: start,
        endIndex: end
      });

      start = end - overlap;
    }

    return chunks;
  }
}

module.exports = new DocumentExtractionService();
