import { jsPDF } from 'jspdf';
import type { JobFeedbackData, FeedbackComment } from './leaderboardService';

class FeedbackExportService {
  /**
   * Generate PDF report of all feedback
   */
  async generatePDF(feedbackData: JobFeedbackData): Promise<void> {
    const pdf = new jsPDF();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20;
    let y = margin;

    // Header
    pdf.setFontSize(20);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(37, 99, 235); // Blue
    pdf.text('Interview Feedback Report', margin, y);
    y += 10;

    // Job Title
    pdf.setFontSize(14);
    pdf.setTextColor(75, 85, 99); // Gray
    pdf.text(feedbackData.jobTitle, margin, y);
    y += 8;

    // Stats
    pdf.setFontSize(10);
    pdf.setTextColor(107, 114, 128);
    pdf.text(`Total Feedback: ${feedbackData.totalFeedback} | Generated: ${new Date().toLocaleDateString()}`, margin, y);
    y += 12;

    // Separator
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.5);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 10;

    // Group feedback by stage
    const feedbackByStage = this.groupFeedbackByStage(feedbackData);

    // Iterate through stages
    Object.entries(feedbackByStage).forEach(([stageName, stageFeedback], stageIndex) => {
      if (y > pageHeight - 40) {
        pdf.addPage();
        y = margin;
      }

      // Stage header
      pdf.setFontSize(14);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(31, 41, 55);
      pdf.text(`${stageName} (${stageFeedback.length} feedback)`, margin, y);
      y += 10;

      // Feedback items
      stageFeedback.forEach((feedback, index) => {
        const candidate = feedback.interviewId?.candidateId;
        if (!candidate) return;

        // Check if we need a new page
        if (y > pageHeight - 50) {
          pdf.addPage();
          y = margin;
        }

        // Candidate name
        pdf.setFontSize(11);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(55, 65, 81);
        pdf.text(`${candidate.firstName} ${candidate.lastName}`, margin + 5, y);
        y += 6;

        // Assessor and date
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(107, 114, 128);
        const assessorName = feedback.authorId?.profile?.firstName 
          ? `${feedback.authorId.profile.firstName} ${feedback.authorId.profile.lastName || ''}`
          : 'Anonymous';
        const date = new Date(feedback.createdAt).toLocaleDateString();
        pdf.text(`By: ${assessorName} | Date: ${date}`, margin + 5, y);
        y += 6;

        // Question if exists
        if (feedback.questionId) {
          pdf.setFont('helvetica', 'italic');
          pdf.setTextColor(75, 85, 99);
          const question = pdf.splitTextToSize(`Q: ${feedback.questionId.question}`, pageWidth - margin * 2 - 10);
          question.forEach((line: string) => {
            if (y > pageHeight - 20) {
              pdf.addPage();
              y = margin;
            }
            pdf.text(line, margin + 5, y);
            y += 4;
          });
          y += 2;
        }

        // Feedback content
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(55, 65, 81);
        const content = pdf.splitTextToSize(feedback.content, pageWidth - margin * 2 - 10);
        content.forEach((line: string) => {
          if (y > pageHeight - 20) {
            pdf.addPage();
            y = margin;
          }
          pdf.text(line, margin + 5, y);
          y += 4;
        });

        // Ratings
        if (feedback.rating) {
          y += 2;
          pdf.setFontSize(8);
          pdf.setTextColor(107, 114, 128);
          const ratings: string[] = [];
          if (feedback.rating.overall) ratings.push(`Overall: ${feedback.rating.overall}/5`);
          if (feedback.rating.technical) ratings.push(`Technical: ${feedback.rating.technical}/5`);
          if (feedback.rating.communication) ratings.push(`Communication: ${feedback.rating.communication}/5`);
          if (feedback.rating.cultural) ratings.push(`Cultural: ${feedback.rating.cultural}/5`);
          pdf.text(ratings.join(' • '), margin + 5, y);
          y += 6;
        }

        y += 8; // Space between feedback items
      });

      y += 5; // Space between stages
    });

    // Footer on all pages
    const pageCount = pdf.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setTextColor(156, 163, 175);
      pdf.text(
        `Page ${i} of ${pageCount} | Confidential`,
        pageWidth / 2,
        pageHeight - 10,
        { align: 'center' }
      );
    }

    // Save
    const fileName = `Feedback_Report_${feedbackData.jobTitle.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
    pdf.save(fileName);
  }

  /**
   * Export feedback to CSV
   */
  async exportCSV(feedbackData: JobFeedbackData): Promise<void> {
    const headers = [
      'Candidate Name',
      'Email',
      'Stage',
      'Assessor',
      'Date',
      'Question',
      'Feedback',
      'Overall Rating',
      'Technical Rating',
      'Communication Rating',
      'Cultural Rating'
    ];

    const rows = feedbackData.feedback.map(feedback => {
      const candidate = feedback.interviewId?.candidateId;
      const stage = feedback.interviewId?.stageId;
      const assessor = feedback.authorId;

      return [
        candidate ? `${candidate.firstName} ${candidate.lastName}` : 'N/A',
        candidate?.email || 'N/A',
        stage?.name || feedback.interviewId?.stageName || 'N/A',
        assessor?.profile?.firstName 
          ? `${assessor.profile.firstName} ${assessor.profile.lastName || ''}`
          : 'Anonymous',
        new Date(feedback.createdAt).toLocaleString(),
        feedback.questionId?.question || 'General Feedback',
        `"${feedback.content.replace(/"/g, '""')}"`, // Escape quotes
        feedback.rating?.overall || '',
        feedback.rating?.technical || '',
        feedback.rating?.communication || '',
        feedback.rating?.cultural || ''
      ];
    });

    const csv = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Feedback_Data_${feedbackData.jobTitle.replace(/\s+/g, '_')}_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Export feedback to JSON
   */
  async exportJSON(feedbackData: JobFeedbackData): Promise<void> {
    const json = JSON.stringify(feedbackData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Feedback_Data_${feedbackData.jobTitle.replace(/\s+/g, '_')}_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Print feedback view
   */
  printFeedback(): void {
    window.print();
  }

  /**
   * Helper: Group feedback by stage
   */
  private groupFeedbackByStage(feedbackData: JobFeedbackData): Record<string, FeedbackComment[]> {
    const grouped: Record<string, FeedbackComment[]> = {};

    feedbackData.feedback.forEach(feedback => {
      const stageName = feedback.interviewId?.stageId?.name 
        || feedback.interviewId?.stageName 
        || 'Unknown Stage';

      if (!grouped[stageName]) {
        grouped[stageName] = [];
      }
      grouped[stageName].push(feedback);
    });

    return grouped;
  }
}

export default new FeedbackExportService();

