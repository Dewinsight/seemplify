'use client';

import { useEffect, useState } from 'react';
import {
  Box, Typography, Paper, Card, CardContent, TextField, Button,
  Accordion, AccordionSummary, AccordionDetails, Chip, Rating,
  Alert, Divider, CircularProgress, Grid
} from '@mui/material';
import {
  ExpandMore, Edit, Save, Send, Flag, Assignment, EmojiObjects,
  TrendingUp, Star, Refresh, SmartToy, Person
} from '@mui/icons-material';

interface ReportData {
  overallSummary: {
    achievements: string;
    challenges: string;
    learnings: string;
    improvements: string;
    goals: string;
  };
  okrAssessment?: {
    okrId: string;
    okrTitle: string;
    completionPercentage: number;
    selfComments: string;
  }[];
  // AI suggestion (never the final self-rating)
  suggestedOverallRating: number | null;
  ratingJustification: string;
  aiSuggestedRating?: {
    suggestedRating: number | null;
    ratingJustification: string;
    confidence?: number;
    keyStrengths?: string[];
    developmentAreas?: string[];
    calibrationNotes?: string;
  };

  // Employee-provided self-rating (required on submit)
  overallSelfRating?: number;

  // Optional guidance if the report is missing key info
  missingInfo?: string[];
  aiInsights: {
    strengths: string[];
    developmentAreas: string[];
    suggestions: string[];
    sentiment: string;
  };
}

interface ReportPreviewProps {
  report: ReportData;
  onEdit: (field: string, value: string) => void;
  onSubmit: () => Promise<void>;
  onRegenerate: () => Promise<void>;
  isSubmitting: boolean;
  isRegenerating: boolean;
}

const ratingLabels: Record<number, string> = {
  1: 'Needs Improvement',
  2: 'Partially Meets',
  3: 'Meets Expectations',
  4: 'Exceeds Expectations',
  5: 'Outstanding'
};

const SectionEditor = ({
  title,
  icon,
  value,
  fieldName,
  onEdit,
  placeholder
}: {
  title: string;
  icon: React.ReactNode;
  value: string;
  fieldName: string;
  onEdit: (field: string, value: string) => void;
  placeholder: string;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  const handleSave = () => {
    onEdit(fieldName, editValue);
    setIsEditing(false);
  };

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {icon}
            <Typography variant="subtitle1" fontWeight={600}>
              {title}
            </Typography>
          </Box>
          <Button
            size="small"
            startIcon={isEditing ? <Save /> : <Edit />}
            onClick={isEditing ? handleSave : () => setIsEditing(true)}
          >
            {isEditing ? 'Save' : 'Edit'}
          </Button>
        </Box>

        {isEditing ? (
          <TextField
            fullWidth
            multiline
            rows={4}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={placeholder}
          />
        ) : (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: value ? 'text.primary' : 'text.disabled' }}>
            {value || placeholder}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
};

export default function ReportPreview({
  report,
  onEdit,
  onSubmit,
  onRegenerate,
  isSubmitting,
  isRegenerating
}: ReportPreviewProps) {
  const aiSuggestedRating = report.aiSuggestedRating?.suggestedRating ?? report.suggestedOverallRating ?? null;
  const aiJustification = report.aiSuggestedRating?.ratingJustification ?? report.ratingJustification;
  const summaryValues = Object.values(report.overallSummary || {});
  const nonPlaceholderSummaryCount = summaryValues.filter((v) => {
    const normalized = (v || '').trim().toLowerCase();
    return normalized && normalized !== 'not provided.';
  }).length;
  const hasInsufficientSignal = (report.missingInfo?.length || 0) > 0 && nonPlaceholderSummaryCount < 2;
  const hasAiSuggestedRating = (
    typeof aiSuggestedRating === 'number' &&
    aiSuggestedRating >= 1 &&
    aiSuggestedRating <= 5 &&
    !hasInsufficientSignal
  );

  const [overallSelfRating, setOverallSelfRating] = useState<number | null>(report.overallSelfRating ?? null);

  useEffect(() => {
    setOverallSelfRating(report.overallSelfRating ?? null);
  }, [report.overallSelfRating]);

  const handleSelfRatingChange = (_: any, value: number | null) => {
    setOverallSelfRating(value);
    if (value) {
      onEdit('overallSelfRating', String(value));
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" fontWeight={700}>
          Self-Assessment Report
        </Typography>
        <Button
          variant="outlined"
          startIcon={isRegenerating ? <CircularProgress size={16} /> : <Refresh />}
          onClick={onRegenerate}
          disabled={isRegenerating || isSubmitting}
        >
          Regenerate
        </Button>
      </Box>

      <Alert severity="info" sx={{ mb: 3 }}>
        Review your draft report below. It is generated from your conversation and evidence, and may include placeholders.
        Edit any section before submitting.
      </Alert>

      {report.missingInfo && report.missingInfo.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom>
            Missing Information
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {report.missingInfo.map((item, idx) => (
              <li key={idx}>
                <Typography variant="body2">{item}</Typography>
              </li>
            ))}
          </Box>
        </Alert>
      )}

      {/* Employee Self-Rating (Required) */}
      <Paper sx={{ p: 3, mb: 2, bgcolor: 'primary.lighter' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Person color="primary" />
          <Typography variant="subtitle1" fontWeight={600}>
            Your Overall Self-Rating
          </Typography>
          <Chip size="small" color="warning" label="Required" />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <Rating value={overallSelfRating} onChange={handleSelfRatingChange} size="large" />
          {overallSelfRating ? (
            <Chip
              label={ratingLabels[overallSelfRating]}
              color={overallSelfRating >= 4 ? 'success' : overallSelfRating >= 3 ? 'info' : 'warning'}
            />
          ) : (
            <Chip label="Select a rating" variant="outlined" />
          )}
        </Box>

        {!overallSelfRating && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            Choose your self-rating to submit.
          </Alert>
        )}
      </Paper>

      {/* AI Suggested Rating (Informational) */}
      <Paper sx={{ p: 3, mb: 3, border: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <SmartToy color="secondary" />
          <Typography variant="subtitle1" fontWeight={600}>
            AI Suggested Rating (Not Final)
          </Typography>
        </Box>
        {hasAiSuggestedRating ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
              <Rating value={aiSuggestedRating} readOnly size="large" />
              <Chip
                label={ratingLabels[aiSuggestedRating]}
                color={aiSuggestedRating >= 4 ? 'success' : aiSuggestedRating >= 3 ? 'info' : 'warning'}
              />
            </Box>
            <Typography variant="body2" color="text.secondary">
              <strong>Justification:</strong> {aiJustification || 'Not provided'}
            </Typography>
          </>
        ) : (
          <Alert severity="info" sx={{ mb: 1 }}>
            Not enough information yet for AI to suggest a rating.
          </Alert>
        )}
        <Alert severity="warning" sx={{ mt: 2 }}>
          This is a suggestion only. Your self-rating is what will be submitted.
        </Alert>
      </Paper>

      {/* Summary Sections */}
      <SectionEditor
        title="Key Achievements"
        icon={<Flag color="success" />}
        value={report.overallSummary.achievements}
        fieldName="achievements"
        onEdit={(field, value) => onEdit(`overallSummary.${field}`, value)}
        placeholder="Describe your key accomplishments..."
      />

      <SectionEditor
        title="Challenges Faced"
        icon={<Assignment color="warning" />}
        value={report.overallSummary.challenges}
        fieldName="challenges"
        onEdit={(field, value) => onEdit(`overallSummary.${field}`, value)}
        placeholder="Describe challenges you faced..."
      />

      <SectionEditor
        title="Key Learnings"
        icon={<EmojiObjects color="info" />}
        value={report.overallSummary.learnings}
        fieldName="learnings"
        onEdit={(field, value) => onEdit(`overallSummary.${field}`, value)}
        placeholder="Describe what you learned..."
      />

      <SectionEditor
        title="Areas for Improvement"
        icon={<TrendingUp color="secondary" />}
        value={report.overallSummary.improvements}
        fieldName="improvements"
        onEdit={(field, value) => onEdit(`overallSummary.${field}`, value)}
        placeholder="Describe areas for improvement..."
      />

      <SectionEditor
        title="Goals for Next Period"
        icon={<Star color="primary" />}
        value={report.overallSummary.goals}
        fieldName="goals"
        onEdit={(field, value) => onEdit(`overallSummary.${field}`, value)}
        placeholder="Set your goals for next period..."
      />

      {/* OKR Assessment */}
      {report.okrAssessment && report.okrAssessment.length > 0 && (
        <Accordion defaultExpanded sx={{ mb: 2 }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography fontWeight={600}>OKR Assessment ({report.okrAssessment.length})</Typography>
          </AccordionSummary>
          <AccordionDetails>
            {report.okrAssessment.map((okr, index) => (
              <Box key={okr.okrId || index} sx={{ mb: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Typography variant="subtitle2" fontWeight={600}>
                  {okr.okrTitle}
                </Typography>
                <Chip
                  size="small"
                  label={`${okr.completionPercentage}% complete`}
                  color={okr.completionPercentage >= 80 ? 'success' : okr.completionPercentage >= 50 ? 'warning' : 'error'}
                  sx={{ mt: 1 }}
                />
                {okr.selfComments && (
                  <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic' }}>
                    {okr.selfComments}
                  </Typography>
                )}
              </Box>
            ))}
          </AccordionDetails>
        </Accordion>
      )}

      {/* AI Insights */}
      <Accordion sx={{ mb: 3 }}>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography fontWeight={600}>AI Insights</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle2" color="success.main" gutterBottom>
                Strengths
              </Typography>
              {report.aiInsights.strengths?.map((strength, i) => (
                <Chip key={i} label={strength} size="small" sx={{ mr: 0.5, mb: 0.5 }} color="success" variant="outlined" />
              ))}
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle2" color="warning.main" gutterBottom>
                Development Areas
              </Typography>
              {report.aiInsights.developmentAreas?.map((area, i) => (
                <Chip key={i} label={area} size="small" sx={{ mr: 0.5, mb: 0.5 }} color="warning" variant="outlined" />
              ))}
            </Grid>
            {report.aiInsights.suggestions && report.aiInsights.suggestions.length > 0 && (
              <Grid size={{ xs: 12 }}>
                <Typography variant="subtitle2" color="info.main" gutterBottom>
                  Suggestions
                </Typography>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {report.aiInsights.suggestions.map((suggestion, i) => (
                    <li key={i}>
                      <Typography variant="body2">{suggestion}</Typography>
                    </li>
                  ))}
                </ul>
              </Grid>
            )}
          </Grid>
        </AccordionDetails>
      </Accordion>

      <Divider sx={{ my: 3 }} />

      {/* Submit Section */}
      <Alert severity="warning" sx={{ mb: 2 }}>
        Once submitted, you cannot make changes. Your manager will be notified to begin their review.
      </Alert>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          color="success"
          size="large"
          startIcon={isSubmitting ? <CircularProgress size={20} color="inherit" /> : <Send />}
          onClick={onSubmit}
          disabled={isSubmitting || isRegenerating || !overallSelfRating}
        >
          Submit Self-Assessment
        </Button>
      </Box>
    </Box>
  );
}
