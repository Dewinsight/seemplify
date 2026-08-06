const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const CVParsingService = require('../services/cvParsingService');

// Configure multer for CV file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/cvs/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'cv-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/tiff'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, Word documents, and images are allowed'), false);
    }
  }
});

// CV parsing endpoint (no authentication required for public applications)
router.post('/parse', upload.single('cv'), async (req, res) => {
  // Set a longer timeout for this specific route
  req.setTimeout(600000); // 10 minutes
  
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        msg: 'No CV file provided' 
      });
    }

    console.log(`🚀 Starting CV parsing for file: ${req.file.originalname}, Size: ${req.file.size} bytes`);
    const cvParsingService = new CVParsingService();
    const result = await cvParsingService.parseAndAnalyze(req.file.path, req.file.mimetype);

    if (result.success) {
      // Structure the response for the frontend
      const response = {
        success: true,
        personalInfo: {
          firstName: result.extractedFields.firstName || '',
          lastName: result.extractedFields.lastName || '',
          email: result.extractedFields.email || '',
          phone: result.extractedFields.phone || '',
          location: result.extractedFields.location || '',
        },
        skills: result.extractedFields.skills || [],
        experience: result.workExperience || '',
        education: result.extractedFields.education || '',
        summary: result.aiAnalysis.summary || '',
        strengths: result.aiAnalysis.strengths || [],
        resumeText: result.resumeText,
        parseSuccess: result.parseSuccess,
        aiSuccess: result.aiSuccess
      };

      // Clean up uploaded file
      const fs = require('fs');
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.warn('Failed to cleanup uploaded file:', cleanupError);
      }

      res.json(response);
    } else {
      res.status(500).json({
        success: false,
        msg: result.error || 'Failed to parse CV'
      });
    }
  } catch (error) {
    console.error('Error in CV parsing endpoint:', error);
    res.status(500).json({
      success: false,
      msg: 'Internal server error during CV parsing'
    });
  }
});

module.exports = router; 