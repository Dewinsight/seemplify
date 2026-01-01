const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const Plan = require('../models/Plan');

/**
 * Generate an invoice PDF
 * @param {Object} request - Subscription request details
 * @param {Object} user - User details
 * @param {Object} organization - Organization details (optional)
 * @returns {Promise<{filePath: string, fileName: string}>} - Path to generated PDF
 */
const generateInvoicePdf = async (request, user, organization = null) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Create uploads directory if it doesn't exist
      const uploadsDir = path.join(__dirname, '..', 'uploads');
      const invoicesDir = path.join(uploadsDir, 'invoices');
      
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      
      if (!fs.existsSync(invoicesDir)) {
        fs.mkdirSync(invoicesDir, { recursive: true });
      }

      // Set up the PDF document
      const invoiceId = request.invoiceDetails?.invoiceNumber || `INV-${Date.now()}`;
      const fileName = `invoice-${invoiceId}-${request._id}.pdf`;
      const filePath = path.join(invoicesDir, fileName);
      
      // Get plan details from the database
      // Look up the plans in the database
      const currentPlanDoc = await Plan.findOne({ code: request.currentPlan });
      const requestedPlanDoc = await Plan.findOne({ code: request.requestedPlan });
      
      // Use the database values or fallback to defaults
      const currentPlanDetails = currentPlanDoc ? {
        name: currentPlanDoc.name,
        price: currentPlanDoc.price
      } : { name: request.currentPlan.charAt(0).toUpperCase() + request.currentPlan.slice(1), price: 0 };
      
      const requestedPlanDetails = requestedPlanDoc ? {
        name: requestedPlanDoc.name,
        price: requestedPlanDoc.price
      } : { name: request.requestedPlan.charAt(0).toUpperCase() + request.requestedPlan.slice(1), price: 0 };
      
      const doc = new PDFDocument({ margin: 50 });
      const writeStream = fs.createWriteStream(filePath);
      
      doc.pipe(writeStream);
      
      // Set up document metadata
      doc.info.Title = `Invoice ${invoiceId}`;
      doc.info.Author = 'SmartHR';
      
      // Add header
      doc.fontSize(25).text('SmartHR', { align: 'right' });
      doc.fontSize(10).text('Smart Hiring, Smarter Results', { align: 'right' });
      doc.moveDown();
      
      // Add horizontal line
      doc.moveTo(50, doc.y)
        .lineTo(550, doc.y)
        .stroke();
      doc.moveDown();
      
      // Add invoice details
      doc.fontSize(20).text('INVOICE', { align: 'center' });
      doc.moveDown();
      
      doc.fontSize(10).text(`Invoice Number: ${invoiceId}`);
      doc.text(`Date: ${new Date().toLocaleDateString()}`);
      if (request.invoiceDetails?.dueDate) {
        doc.text(`Due Date: ${new Date(request.invoiceDetails.dueDate).toLocaleDateString()}`);
      }
      doc.moveDown();
      
      // Add customer info
      doc.fontSize(12).text('Billed To:');
      doc.fontSize(10).text(`${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`);
      doc.text(user.email);
      
      if (organization && request.requestType === 'organization') {
        doc.text(`Organization: ${organization.name}`);
      }
      doc.moveDown();
      
      // Add subscription details
      doc.fontSize(12).text('Subscription Upgrade:');
      doc.fontSize(10).text(`From: ${currentPlanDetails.name} Plan`);
      doc.text(`To: ${requestedPlanDetails.name} Plan`);
      doc.moveDown();
      
      // Add pricing table
      const tableTop = doc.y;
      const tableLeft = 50;
      const tableRight = 550;
      const colWidth = (tableRight - tableLeft) / 4;
      
      // Add table header
      doc.font('Helvetica-Bold');
      doc.text('Description', tableLeft, tableTop);
      doc.text('Plan Price', tableLeft + colWidth * 2, tableTop, { width: colWidth, align: 'right' });
      doc.text('Amount', tableLeft + colWidth * 3, tableTop, { width: colWidth, align: 'right' });
      
      // Add horizontal line
      doc.moveTo(tableLeft, doc.y + 15)
        .lineTo(tableRight, doc.y + 15)
        .stroke();
      
      // Add table row
      doc.font('Helvetica');
      doc.text(`${requestedPlanDetails.name} Plan Subscription`, tableLeft, doc.y + 25);
      doc.text(`$${requestedPlanDetails.price}`, tableLeft + colWidth * 2, doc.y, { width: colWidth, align: 'right' });
      doc.text(`$${requestedPlanDetails.price}`, tableLeft + colWidth * 3, doc.y, { width: colWidth, align: 'right' });
      
      // Add horizontal line
      doc.moveTo(tableLeft, doc.y + 15)
        .lineTo(tableRight, doc.y + 15)
        .stroke();
      
      // Add total
      doc.font('Helvetica-Bold');
      doc.text('Total:', tableLeft + colWidth * 2, doc.y + 25, { width: colWidth, align: 'right' });
      doc.text(`$${request.invoiceDetails?.amount || requestedPlanDetails.price}`, tableLeft + colWidth * 3, doc.y, { width: colWidth, align: 'right' });
      
      // Add currency note if different from USD
      if (request.invoiceDetails?.currency && request.invoiceDetails.currency !== 'USD') {
        doc.font('Helvetica');
        doc.moveDown();
        doc.text(`* Amount shown in ${request.invoiceDetails.currency}`, tableLeft);
      }
      
      doc.moveDown(2);
      
      // Add payment instructions
      doc.fontSize(12).text('Payment Instructions:', { underline: true });
      doc.fontSize(10).text('Please include the invoice number with your payment.');
      doc.moveDown();
      
      // Add notes
      if (request.adminNotes) {
        doc.fontSize(12).text('Notes:', { underline: true });
        doc.fontSize(10).text(request.adminNotes);
        doc.moveDown();
      }
      
      // Add footer
      doc.fontSize(8).text('SmartHR - Invoice generated automatically', { align: 'center' });
      
      // Finalize the document
      doc.end();
      
      // Wait for PDF to be fully written
      writeStream.on('finish', () => {
        resolve({
          filePath: filePath,
          fileName: fileName,
          invoiceId: invoiceId
        });
      });
      
      writeStream.on('error', (error) => {
        console.error('Error writing invoice PDF:', error);
        reject(error);
      });
      
    } catch (error) {
      console.error('Error generating invoice PDF:', error);
      reject(error);
    }
  });
};

module.exports = {
  generateInvoicePdf
};