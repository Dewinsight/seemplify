const fs = require('fs');
const Tesseract = require('tesseract.js');
const mammoth = require('mammoth');
const AzureOpenAIService = require('./azureOpenAIService');
const { normalizeCvExtractedFields } = require('../utils/normalizeCvExtraction');

// ✅ UPGRADED: Using PDF.js instead of pdf-parse for better text extraction
// Note: pdfjs-dist uses ES modules, so we need dynamic import
let pdfjsLib = null;

class CVParsingService {
  constructor() {
    this.azureOpenAIService = new AzureOpenAIService();
  }

  /**
   * Load PDF.js library dynamically (ES module)
   */
  async loadPdfJs() {
    if (!pdfjsLib) {
      pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    }
    return pdfjsLib;
  }

  /**
   * Parse CV content from file based on file type
   * @param {string} filePath - Path to the uploaded file
   * @param {string} fileType - MIME type of the file
   * @returns {Promise<string>} - Extracted text content
   */
  async parseCV(filePath, fileType) {
    let textContent = '';
    
    try {
      console.log(`Starting CV parsing for file type: ${fileType}`);
      
      if (fileType === 'application/pdf') {
        // ✅ UPGRADED: Using PDF.js for better text extraction
        const pdfjs = await this.loadPdfJs();
        const dataBuffer = fs.readFileSync(filePath);
        
        // Load the PDF document
        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(dataBuffer),
          useSystemFonts: true,
        });
        
        const pdfDocument = await loadingTask.promise;
        console.log(`📄 PDF loaded: ${pdfDocument.numPages} page(s)`);
        
        // Extract text from all pages
        let fullText = '';
        for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
          const page = await pdfDocument.getPage(pageNum);
          const textContentObj = await page.getTextContent();
          
          // Combine text items with proper spacing
          const pageText = textContentObj.items
            .map(item => item.str)
            .join(' ')
            .replace(/\s+/g, ' '); // Normalize whitespace
          
          fullText += pageText + '\n\n';
          console.log(`✅ Page ${pageNum}/${pdfDocument.numPages} extracted (${pageText.length} chars)`);
        }
        
        textContent = fullText.trim();
        console.log(`✅ PDF parsed successfully with PDF.js (${textContent.length} total characters)`);
        
      } else if (['image/jpeg', 'image/png', 'image/tiff'].includes(fileType)) {
        const { data: { text } } = await Tesseract.recognize(filePath, 'eng');
        textContent = text;
        console.log('✅ Image OCR completed successfully');
        
      } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const result = await mammoth.extractRawText({ path: filePath });
        textContent = result.value;
        console.log('✅ DOCX parsed successfully');
        
      } else if (fileType === 'application/msword') {
        console.warn('⚠️ .doc files are not directly supported. Consider converting to DOCX or PDF first.');
        // For .doc files, we'll return empty text and rely on manual input
        textContent = '';
        
      } else {
        console.warn(`⚠️ Unsupported file type for parsing: ${fileType}`);
        textContent = '';
      }
      
    } catch (error) {
      console.error(`❌ Error parsing CV content for ${fileType}:`, error.message);
      // Don't throw here, allow to continue with empty text
      textContent = '';
    }
    
    return textContent;
  }

  /**
   * Parse CV and analyze with Azure OpenAI
   * @param {string} filePath - Path to the uploaded file
   * @param {string} fileType - MIME type of the file
   * @returns {Promise<Object>} - Combined parsing and AI analysis result
   */
  async parseAndAnalyze(filePath, fileType) {
    try {
      console.log('🔍 Starting CV parsing and AI analysis...');
      
      // Step 1: Parse CV content
      const resumeText = await this.parseCV(filePath, fileType);
      
      // ✅ CRITICAL FIX: Validate CV text before AI analysis to prevent hallucinations
      if (!resumeText || resumeText.trim().length < 50) {
        console.warn('⚠️ CV parsing returned insufficient text. Aborting AI analysis to prevent hallucinations.');
        console.warn(`Resume text length: ${resumeText?.length || 0} characters`);
        console.warn(`File type: ${fileType}, File path: ${filePath}`);
        
        return {
          success: false,
          error: 'IMAGE_BASED_CV: Do NOT use image-based or scanned CVs — we cannot extract text from them. Please upload a text-based PDF or DOCX file with selectable text, or enter your information manually. Ensure the email in your CV is correct — a wrong email can cause issues.',
          resumeText: resumeText || '',
          aiAnalysis: {
            summary: "Text extraction failed - manual review required",
            strengths: [],
            potentialFlags: ["CV text extraction failed - please verify file format and try again"],
          },
          extractedFields: {},
          parseSuccess: false,
          aiSuccess: false
        };
      }
      
      console.log(`✅ CV text extracted successfully (${resumeText.length} characters). Proceeding with AI analysis...`);
      
      // Step 2: Analyze with Azure OpenAI
      const aiAnalysisResult = await this.azureOpenAIService.analyzeCV(resumeText);
      const extractedFields = normalizeCvExtractedFields(aiAnalysisResult.extractedFields || {});
      
      console.log('✅ CV parsing and AI analysis completed');
      
      return {
        success: true,
        resumeText,
        aiAnalysis: {
          summary: aiAnalysisResult.summary || "N/A",
          strengths: aiAnalysisResult.strengths || [],
          potentialFlags: aiAnalysisResult.potentialFlags || [],
        },
        workExperience: extractedFields.workExperience || null,
        extractedFields,
        parseSuccess: resumeText.length > 0,
        aiSuccess: aiAnalysisResult.success
      };
      
    } catch (error) {
      console.error('❌ Error in CV parsing and analysis:', error.message);
      console.error('Stack trace:', error.stack);
      
      return {
        success: false,
        error: error.message || 'Failed to process CV. Please try again or enter information manually.',
        resumeText: '',
        aiAnalysis: {
          summary: "Error during CV analysis",
          strengths: [],
          potentialFlags: ["Processing error occurred"],
        },
        extractedFields: {},
        parseSuccess: false,
        aiSuccess: false
      };
    }
  }
}

module.exports = CVParsingService; 
