import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

/**
 * Professional PDF generation service for interview feedback reports
 * Ensures consistent A4 sizing regardless of device
 */

export interface PDFReportData {
  candidateName: string;
  candidateEmail?: string;
  interviewTitle: string;
  interviewDate: string;
  jobTitle?: string;
  stageName?: string;
  stageOrder?: number;
  overallScore: number;
  scoreBreakdown: {
    overall: number;
    technical: number;
    communication: number;
    cultural: number;
    questionSpecific: number;
  };
  recommendation: string;
  totalAssessors: number;
  totalFeedback: number;
  assessorFeedback: Array<{
    assessorName: string;
    assessorRole: string;
    assessorEmail?: string;
    avgScore: number;
    generalFeedback?: Array<{
      content: string;
      rating?: {
        overall?: number;
        technical?: number;
        communication?: number;
        cultural?: number;
      };
      stageName?: string;
      stageOrder?: number;
      createdAt: string;
    }>;
    questionFeedback?: Array<{
      question: string;
      questionType: string;
      content: string;
      rating?: {
        overall?: number;
        technical?: number;
        communication?: number;
        cultural?: number;
      };
      stageName?: string;
      stageOrder?: number;
      createdAt: string;
    }>;
  }>;
  topPerformingQuestions?: Array<{
    question: string;
    score: number;
  }>;
}

class PDFService {
  // A4 dimensions in mm
  private readonly A4_WIDTH = 210;
  private readonly A4_HEIGHT = 297;
  
  // Margins in mm
  private readonly MARGIN = 15;
  private readonly CONTENT_WIDTH = this.A4_WIDTH - (this.MARGIN * 2);

  /**
   * Generate a professional PDF report for interview feedback
   */
  async generateFeedbackReport(data: PDFReportData): Promise<void> {
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    let yPosition = this.MARGIN;

    // Add header
    yPosition = this.addHeader(pdf, data, yPosition);

    // Add summary section
    yPosition = this.addSummarySection(pdf, data, yPosition);

    // Add score breakdown
    yPosition = this.addScoreBreakdown(pdf, data, yPosition);

    // Add assessor feedback (with page breaks as needed)
    yPosition = this.addAssessorFeedback(pdf, data, yPosition);

    // Add top performing questions if available
    if (data.topPerformingQuestions && data.topPerformingQuestions.length > 0) {
      yPosition = this.addTopPerformingQuestions(pdf, data, yPosition);
    }

    // Add footer to all pages
    this.addFooters(pdf, data);

    // Save the PDF
    const fileName = `Interview_Feedback_${data.candidateName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
    pdf.save(fileName);
  }

  /**
   * Add document header
   */
  private addHeader(pdf: jsPDF, data: PDFReportData, startY: number): number {
    let y = startY;

    // Company/System name
    pdf.setFontSize(24);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(37, 99, 235); // Blue color
    pdf.text('SmartHR', this.MARGIN, y);
    y += 10;

    // Document title
    pdf.setFontSize(18);
    pdf.setTextColor(31, 41, 55); // Dark gray
    pdf.text('Interview Feedback Report', this.MARGIN, y);
    y += 3;

    // Underline
    pdf.setDrawColor(226, 232, 240); // Light gray
    pdf.setLineWidth(0.5);
    pdf.line(this.MARGIN, y, this.A4_WIDTH - this.MARGIN, y);
    y += 10;

    // Candidate info
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Candidate:', this.MARGIN, y);
    pdf.setFont('helvetica', 'normal');
    pdf.text(data.candidateName, this.MARGIN + 30, y);
    y += 6;

    if (data.candidateEmail) {
      pdf.setFont('helvetica', 'bold');
      pdf.text('Email:', this.MARGIN, y);
      pdf.setFont('helvetica', 'normal');
      pdf.text(data.candidateEmail, this.MARGIN + 30, y);
      y += 6;
    }

    pdf.setFont('helvetica', 'bold');
    pdf.text('Interview:', this.MARGIN, y);
    pdf.setFont('helvetica', 'normal');
    const interviewText = data.interviewTitle;
    pdf.text(interviewText.length > 50 ? interviewText.substring(0, 47) + '...' : interviewText, this.MARGIN + 30, y);
    y += 6;

    pdf.setFont('helvetica', 'bold');
    pdf.text('Date:', this.MARGIN, y);
    pdf.setFont('helvetica', 'normal');
    pdf.text(new Date(data.interviewDate).toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    }), this.MARGIN + 30, y);
    y += 6;

    if (data.stageName) {
      pdf.setFont('helvetica', 'bold');
      pdf.text('Stage:', this.MARGIN, y);
      pdf.setFont('helvetica', 'normal');
      const stageText = data.stageOrder 
        ? `Round ${data.stageOrder}: ${data.stageName}`
        : data.stageName;
      pdf.text(stageText, this.MARGIN + 30, y);
      y += 6;
    }

    if (data.jobTitle) {
      pdf.setFont('helvetica', 'bold');
      pdf.text('Position:', this.MARGIN, y);
      pdf.setFont('helvetica', 'normal');
      const jobTitleText = data.jobTitle;
      pdf.text(jobTitleText.length > 50 ? jobTitleText.substring(0, 47) + '...' : jobTitleText, this.MARGIN + 30, y);
      y += 6;
    }

    return y + 5;
  }

  /**
   * Add summary section with key metrics
   */
  private addSummarySection(pdf: jsPDF, data: PDFReportData, startY: number): number {
    let y = startY;

    // Section title
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(31, 41, 55);
    pdf.text('Executive Summary', this.MARGIN, y);
    y += 8;

    // Key metrics boxes
    const boxWidth = (this.CONTENT_WIDTH - 10) / 3;
    const boxHeight = 25;
    let xPosition = this.MARGIN;

    // Overall Score Box
    this.drawMetricBox(pdf, xPosition, y, boxWidth, boxHeight, 
      'Overall Score', 
      `${data.overallScore.toFixed(1)}/5.0`,
      this.getScoreColor(data.overallScore));
    
    xPosition += boxWidth + 5;

    // Recommendation Box
    this.drawMetricBox(pdf, xPosition, y, boxWidth, boxHeight,
      'Recommendation',
      data.recommendation.replace('_', ' ').toUpperCase(),
      this.getRecommendationColor(data.recommendation));
    
    xPosition += boxWidth + 5;

    // Assessors Box
    this.drawMetricBox(pdf, xPosition, y, boxWidth, boxHeight,
      'Assessors',
      data.totalAssessors.toString(),
      [99, 102, 241]); // Indigo

    return y + boxHeight + 10;
  }

  /**
   * Add detailed score breakdown
   */
  private addScoreBreakdown(pdf: jsPDF, data: PDFReportData, startY: number): number {
    let y = this.checkPageBreak(pdf, startY, 80);

    // Section title
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(31, 41, 55);
    pdf.text('Score Breakdown', this.MARGIN, y);
    y += 8;

    // Draw score bars
    const scores = [
      { label: 'Overall Assessment', value: data.scoreBreakdown.overall },
      { label: 'Technical Skills', value: data.scoreBreakdown.technical },
      { label: 'Communication', value: data.scoreBreakdown.communication },
      { label: 'Cultural Fit', value: data.scoreBreakdown.cultural },
    ];

    if (data.scoreBreakdown.questionSpecific > 0) {
      scores.push({ label: 'Question-Specific', value: data.scoreBreakdown.questionSpecific });
    }

    scores.forEach(score => {
      if (score.value > 0) {
        y = this.drawScoreBar(pdf, this.MARGIN, y, this.CONTENT_WIDTH, score.label, score.value);
        y += 12;
      }
    });

    return y + 5;
  }

  /**
   * Add assessor feedback section
   */
  private addAssessorFeedback(pdf: jsPDF, data: PDFReportData, startY: number): number {
    let y = this.checkPageBreak(pdf, startY, 40);

    // Section title
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(31, 41, 55);
    pdf.text('Assessor Feedback', this.MARGIN, y);
    y += 8;

    pdf.setFontSize(10);
    pdf.setTextColor(107, 114, 128);
    pdf.text(`${data.totalFeedback} total responses from ${data.totalAssessors} assessors`, this.MARGIN, y);
    y += 10;

    // Iterate through each assessor
    data.assessorFeedback.forEach((assessor, index) => {
      // Check if we need a new page for this assessor
      y = this.checkPageBreak(pdf, y, 60);

      // Assessor header
      pdf.setFillColor(249, 250, 251); // Light gray background
      pdf.rect(this.MARGIN, y - 5, this.CONTENT_WIDTH, 12, 'F');
      
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(31, 41, 55);
      pdf.text(assessor.assessorName, this.MARGIN + 3, y);
      
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(107, 114, 128);
      pdf.text(assessor.assessorRole, this.MARGIN + 3, y + 5);
      
      if (assessor.avgScore > 0) {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10);
        const scoreColor = this.getScoreColor(assessor.avgScore);
        pdf.setTextColor(scoreColor[0], scoreColor[1], scoreColor[2]);
        pdf.text(`${assessor.avgScore.toFixed(1)}/5`, this.A4_WIDTH - this.MARGIN - 15, y + 2);
      }
      
      y += 15;

      // General feedback
      if (assessor.generalFeedback && assessor.generalFeedback.length > 0) {
        assessor.generalFeedback.forEach(feedback => {
          y = this.checkPageBreak(pdf, y, 30);
          
          pdf.setFontSize(9);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(75, 85, 99);
          const assessmentLabel = feedback.stageName 
            ? `Overall Interview Assessment (${feedback.stageOrder ? `R${feedback.stageOrder}: ` : ''}${feedback.stageName}):`
            : 'Overall Interview Assessment:';
          pdf.text(assessmentLabel, this.MARGIN + 5, y);
          y += 5;

          // Feedback content
          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(55, 65, 81);
          const lines = pdf.splitTextToSize(feedback.content, this.CONTENT_WIDTH - 10);
          lines.forEach((line: string) => {
            y = this.checkPageBreak(pdf, y, 10);
            pdf.text(line, this.MARGIN + 5, y);
            y += 4;
          });

          // Ratings if available
          if (feedback.rating) {
            y += 2;
            y = this.addFeedbackRatings(pdf, this.MARGIN + 5, y, feedback.rating);
          }

          y += 5;
        });
      }

      // Question-specific feedback
      if (assessor.questionFeedback && assessor.questionFeedback.length > 0) {
        assessor.questionFeedback.forEach(feedback => {
          y = this.checkPageBreak(pdf, y, 40);
          
          pdf.setFontSize(9);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(75, 85, 99);
          const questionLabel = `Q: ${feedback.question.substring(0, 70)}${feedback.question.length > 70 ? '...' : ''}`;
          pdf.text(questionLabel, this.MARGIN + 5, y);
          y += 4;
          
          // Stage badge if available
          if (feedback.stageName) {
            pdf.setFontSize(7);
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(107, 114, 128);
            const stageLabel = feedback.stageOrder 
              ? `Round ${feedback.stageOrder}: ${feedback.stageName}`
              : feedback.stageName;
            pdf.text(`[${stageLabel}]`, this.MARGIN + 5, y);
            y += 5;
          } else {
            y += 1;
          }

          pdf.setFont('helvetica', 'normal');
          pdf.setTextColor(55, 65, 81);
          const lines = pdf.splitTextToSize(feedback.content, this.CONTENT_WIDTH - 10);
          lines.forEach((line: string) => {
            y = this.checkPageBreak(pdf, y, 10);
            pdf.text(line, this.MARGIN + 5, y);
            y += 4;
          });

          // Ratings if available
          if (feedback.rating) {
            y += 2;
            y = this.addFeedbackRatings(pdf, this.MARGIN + 5, y, feedback.rating);
          }

          y += 5;
        });
      }

      y += 5;
    });

    return y;
  }

  /**
   * Add feedback ratings display
   */
  private addFeedbackRatings(pdf: jsPDF, x: number, y: number, rating: any): number {
    pdf.setFontSize(8);
    pdf.setTextColor(107, 114, 128);
    
    const ratings: string[] = [];
    if (rating.overall) ratings.push(`Overall: ${rating.overall}/5`);
    if (rating.technical) ratings.push(`Technical: ${rating.technical}/5`);
    if (rating.communication) ratings.push(`Communication: ${rating.communication}/5`);
    if (rating.cultural) ratings.push(`Cultural: ${rating.cultural}/5`);
    
    if (ratings.length > 0) {
      pdf.text(ratings.join(' • '), x, y);
      return y + 5;
    }
    
    return y;
  }

  /**
   * Add top performing questions
   */
  private addTopPerformingQuestions(pdf: jsPDF, data: PDFReportData, startY: number): number {
    let y = this.checkPageBreak(pdf, startY, 50);

    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(31, 41, 55);
    pdf.text('Top Performing Questions', this.MARGIN, y);
    y += 10;

    data.topPerformingQuestions?.forEach((item, index) => {
      y = this.checkPageBreak(pdf, y, 20);
      
      // Medal/rank indicator
      const medals = ['🥇', '🥈', '🥉'];
      pdf.setFontSize(10);
      pdf.text(`${index < 3 ? medals[index] : `${index + 1}.`}`, this.MARGIN, y);
      
      // Question text
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(55, 65, 81);
      const questionText = item.question.substring(0, 100) + (item.question.length > 100 ? '...' : '');
      const lines = pdf.splitTextToSize(questionText, this.CONTENT_WIDTH - 25);
      lines.forEach((line: string, lineIndex: number) => {
        pdf.text(line, this.MARGIN + 10, y + (lineIndex * 4));
      });
      
      // Score
      pdf.setFont('helvetica', 'bold');
      const scoreColor = this.getScoreColor(item.score);
      pdf.setTextColor(scoreColor[0], scoreColor[1], scoreColor[2]);
      pdf.text(`${item.score.toFixed(1)}`, this.A4_WIDTH - this.MARGIN - 10, y);
      
      y += Math.max(lines.length * 4, 8) + 3;
    });

    return y;
  }

  /**
   * Add footer to all pages
   */
  private addFooters(pdf: jsPDF, data: PDFReportData): void {
    const pageCount = pdf.getNumberOfPages();
    
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i);
      
      pdf.setFontSize(8);
      pdf.setTextColor(156, 163, 175);
      pdf.setFont('helvetica', 'normal');
      
      // Left side: Generated date
      pdf.text(`Generated on ${new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      })}`, this.MARGIN, this.A4_HEIGHT - 8);
      
      // Center: Confidential notice
      const confidentialText = 'Confidential - Internal Use Only';
      const confidentialWidth = pdf.getTextWidth(confidentialText);
      pdf.text(confidentialText, (this.A4_WIDTH - confidentialWidth) / 2, this.A4_HEIGHT - 8);
      
      // Right side: Page number
      pdf.text(`Page ${i} of ${pageCount}`, this.A4_WIDTH - this.MARGIN - 20, this.A4_HEIGHT - 8);
    }
  }

  /**
   * Helper: Draw metric box
   */
  private drawMetricBox(
    pdf: jsPDF, 
    x: number, 
    y: number, 
    width: number, 
    height: number,
    label: string,
    value: string,
    color: number[]
  ): void {
    // Box background
    pdf.setFillColor(249, 250, 251);
    pdf.roundedRect(x, y, width, height, 2, 2, 'F');
    
    // Box border with color accent
    pdf.setDrawColor(color[0], color[1], color[2]);
    pdf.setLineWidth(0.5);
    pdf.roundedRect(x, y, width, height, 2, 2, 'S');
    
    // Label
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(107, 114, 128);
    const labelWidth = pdf.getTextWidth(label);
    pdf.text(label, x + (width - labelWidth) / 2, y + 8);
    
    // Value
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(color[0], color[1], color[2]);
    const valueWidth = pdf.getTextWidth(value);
    pdf.text(value, x + (width - valueWidth) / 2, y + 18);
  }

  /**
   * Helper: Draw score bar
   */
  private drawScoreBar(
    pdf: jsPDF,
    x: number,
    y: number,
    width: number,
    label: string,
    value: number
  ): number {
    // Label
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(55, 65, 81);
    pdf.text(label, x, y);
    
    // Score value
    pdf.setFont('helvetica', 'bold');
    const scoreColor = this.getScoreColor(value);
    pdf.setTextColor(scoreColor[0], scoreColor[1], scoreColor[2]);
    pdf.text(`${value.toFixed(1)}/5`, x + width - 15, y);
    
    y += 3;
    
    // Bar background
    pdf.setFillColor(229, 231, 235);
    pdf.rect(x, y, width, 5, 'F');
    
    // Bar fill
    const fillWidth = (value / 5) * width;
    pdf.setFillColor(scoreColor[0], scoreColor[1], scoreColor[2]);
    pdf.rect(x, y, fillWidth, 5, 'F');
    
    return y + 5;
  }

  /**
   * Helper: Check if we need a page break
   */
  private checkPageBreak(pdf: jsPDF, currentY: number, requiredSpace: number): number {
    if (currentY + requiredSpace > this.A4_HEIGHT - 20) {
      pdf.addPage();
      return this.MARGIN + 10;
    }
    return currentY;
  }

  /**
   * Helper: Get color for score
   */
  private getScoreColor(score: number): number[] {
    if (score >= 4.5) return [34, 197, 94]; // Green
    if (score >= 4.0) return [16, 185, 129]; // Emerald
    if (score >= 3.5) return [234, 179, 8]; // Yellow
    if (score >= 3.0) return [249, 115, 22]; // Orange
    return [239, 68, 68]; // Red
  }

  /**
   * Helper: Get color for recommendation
   */
  private getRecommendationColor(recommendation: string): number[] {
    if (recommendation.includes('strong_hire')) return [34, 197, 94]; // Green
    if (recommendation.includes('hire')) return [16, 185, 129]; // Emerald
    if (recommendation.includes('maybe')) return [234, 179, 8]; // Yellow
    return [239, 68, 68]; // Red
  }
}

export default new PDFService();

