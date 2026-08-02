const cloudinary = require('cloudinary').v2;

class CloudinaryUploadService {
  constructor() {
    // Configure Cloudinary (ensure these are in your .env file)
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  /**
   * Upload file to Cloudinary
   * @param {string} filePath - Path to the uploaded file
   * @param {string} fileType - MIME type of the file
   * @param {Object} options - Optional delivery controls
   * @returns {Promise<Object>} - Cloudinary upload result with URL
   */
  async uploadFile(filePath, fileType, options = {}) {
    try {
      console.log('☁️ Starting Cloudinary upload...');
      console.log(`File type: ${fileType}`);
      console.log(`File path: ${filePath}`);
      
      let cloudinaryUploadResult;
      
      const deliveryType = options.privateAsset ? 'authenticated' : 'upload';
      const commonOptions = {
        type: deliveryType,
        overwrite: true,
        ...(options.publicId ? { public_id: String(options.publicId).replace(/[^A-Za-z0-9_-]/g, '_') } : {})
      };

      // Handle different file types with appropriate resource_type
      if (['image/jpeg', 'image/png', 'image/tiff'].includes(fileType)) {
        cloudinaryUploadResult = await cloudinary.uploader.upload(filePath, { 
          ...commonOptions,
          resource_type: 'image',
          folder: 'resumes/images' // Organize files in folders
        });
        
      } else if (fileType === 'application/pdf') {
        cloudinaryUploadResult = await cloudinary.uploader.upload(filePath, {
          ...commonOptions,
          resource_type: 'raw',
          folder: 'resumes/documents',
          format: 'pdf' // Explicitly set format for PDFs
        });
        
      } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        cloudinaryUploadResult = await cloudinary.uploader.upload(filePath, {
          ...commonOptions,
          resource_type: 'raw',
          folder: 'resumes/documents',
          format: 'docx'
        });
        
      } else if (fileType === 'application/msword') {
        cloudinaryUploadResult = await cloudinary.uploader.upload(filePath, {
          ...commonOptions,
          resource_type: 'raw',
          folder: 'resumes/documents',
          format: 'doc'
        });
        
      } else {
        // Fallback for any other file types
        cloudinaryUploadResult = await cloudinary.uploader.upload(filePath, {
          ...commonOptions,
          resource_type: 'auto', // Let Cloudinary detect
          folder: 'resumes/other'
        });
      }
      
      console.log('✅ Cloudinary upload successful!');
      console.log(`Resume URL: ${cloudinaryUploadResult.secure_url}`);
      
      const resumeUrl = options.privateAsset
        ? this.getSignedUrl(cloudinaryUploadResult.public_id, {
            resourceType: cloudinaryUploadResult.resource_type,
            deliveryType,
            format: cloudinaryUploadResult.format
          })
        : cloudinaryUploadResult.secure_url;
      return {
        success: true,
        resumeUrl,
        publicId: cloudinaryUploadResult.public_id,
        resourceType: cloudinaryUploadResult.resource_type,
        deliveryType,
        format: cloudinaryUploadResult.format,
        bytes: cloudinaryUploadResult.bytes,
        uploadResult: cloudinaryUploadResult
      };
      
    } catch (error) {
      console.error('❌ Cloudinary upload failed:', error.message);
      
      return {
        success: false,
        error: error.message,
        resumeUrl: null,
        publicId: null
      };
    }
  }

  /**
   * Delete file from Cloudinary
   * @param {string} publicId - Cloudinary public ID
   * @param {string} resourceType - Resource type (image, raw, video, etc.)
   * @param {string} deliveryType - Delivery type (upload, authenticated, private)
   * @returns {Promise<Object>} - Deletion result
   */
  async deleteFile(publicId, resourceType = 'raw', deliveryType = 'upload') {
    try {
      console.log(`🗑️ Deleting file from Cloudinary: ${publicId}`);
      
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        type: deliveryType
      });
      
      console.log('✅ File deleted from Cloudinary');
      return { success: true, result };
      
    } catch (error) {
      console.error('❌ Error deleting file from Cloudinary:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get file info from Cloudinary
   * @param {string} publicId - Cloudinary public ID
   * @param {string} resourceType - Resource type
   * @returns {Promise<Object>} - File information
   */
  async getFileInfo(publicId, resourceType = 'raw') {
    try {
      const result = await cloudinary.api.resource(publicId, {
        resource_type: resourceType
      });
      
      return { success: true, info: result };
      
    } catch (error) {
      console.error('❌ Error getting file info from Cloudinary:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate accessible URL for PDF files using signed URLs
   * @param {string} publicId - Cloudinary public ID
   * @returns {string} - Signed, accessible PDF URL
   */
  getAccessiblePdfUrl(publicId, deliveryType = 'upload') {
    // Generate signed URL that works on Free Plan
    // Use the same approach as getDownloadUrl but with secure flag
    return cloudinary.url(publicId, {
      resource_type: 'raw',
      type: deliveryType,
      secure: true,
      sign_url: true
    });
  }

  /**
   * Generate direct download URL for PDF
   * @param {string} publicId - Cloudinary public ID
   * @returns {string} - Direct download URL
   */
  getDownloadUrl(publicId, deliveryType = 'upload') {
    return cloudinary.url(publicId, {
      resource_type: 'raw',
      type: deliveryType,
      flags: 'attachment',
      secure: true,
      sign_url: deliveryType !== 'upload'
    });
  }

  getSignedUrl(publicId, { resourceType = 'raw', deliveryType = 'authenticated', format } = {}) {
    return cloudinary.url(publicId, {
      resource_type: resourceType,
      type: deliveryType,
      secure: true,
      sign_url: true,
      ...(format ? { format } : {})
    });
  }

  /**
   * Generate preview URL for PDF (first page as image)
   * @param {string} publicId - Cloudinary public ID  
   * @returns {string} - Preview image URL
   */
  getPdfPreviewUrl(publicId, deliveryType = 'upload') {
    // Convert first page of PDF to image for preview
    return cloudinary.url(publicId, {
      resource_type: 'image',
      type: deliveryType,
      format: 'jpg',
      page: 1, // First page
      secure: true,
      sign_url: deliveryType !== 'upload'
    });
  }
}

module.exports = CloudinaryUploadService;
