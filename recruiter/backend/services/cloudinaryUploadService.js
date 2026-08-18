const cloudinary = require('cloudinary').v2;
const { createStorageService } = require('./storageService');

class CloudinaryUploadService {
  constructor() {
    // Configure Cloudinary (ensure these are in your .env file)
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    this.storage = createStorageService();
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
      console.log('Starting managed storage upload...');
      console.log(`File type: ${fileType}`);
      
      const deliveryType = options.privateAsset ? 'authenticated' : 'upload';
      const commonOptions = {
        type: deliveryType,
        overwrite: true,
        timeout: Math.max(
          60_000,
          Number(process.env.CV_CLOUD_UPLOAD_TIMEOUT_MS || 5 * 60 * 1000)
        ),
        ...(options.publicId ? { public_id: String(options.publicId).replace(/[^A-Za-z0-9_-]/g, '_') } : {})
      };

      const image = ['image/jpeg', 'image/png', 'image/tiff'].includes(fileType);
      const document = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'].includes(fileType);
      const resourceType = image ? 'image' : document ? 'raw' : 'auto';
      const folder = image ? 'resumes/images' : document ? 'resumes/documents' : 'resumes/other';
      const stored = await this.storage.uploadFile(filePath, {
        fileName: options.fileName,
        mimeType: fileType,
        folder,
        storageKey: options.publicId ? `${folder}/${String(options.publicId).replace(/[^A-Za-z0-9_-]/g, '_')}` : undefined,
        resourceType,
        cloudinaryOptions: commonOptions
      });
      const resumeUrl = stored.provider === 'cloudinary' && options.privateAsset
        ? this.getSignedUrl(stored.storageKey, { resourceType: stored.resourceType, deliveryType, format: stored.format })
        : stored.url;
      return {
        success: true,
        resumeUrl,
        publicId: stored.storageKey,
        storageKey: stored.storageKey,
        storageProvider: stored.storageProvider,
        storageContainer: stored.storageContainer || null,
        resourceType: stored.resourceType,
        deliveryType: stored.deliveryType || deliveryType,
        format: stored.format,
        bytes: stored.bytes,
        uploadResult: stored
      };
      
    } catch (error) {
      console.error('Managed storage upload failed:', error.message);
      
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
  async deleteFile(publicId, resourceType = 'raw', deliveryType = 'upload', storage = {}) {
    try {
      const result = await this.storage.remove({
        storageKey: publicId,
        resourceType,
        deliveryType,
        ...storage
      });
      return { success: true, result };
      
    } catch (error) {
      console.error('Error deleting managed file:', error.message);
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
