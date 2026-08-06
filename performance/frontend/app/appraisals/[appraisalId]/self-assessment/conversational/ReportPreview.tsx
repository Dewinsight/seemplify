'use client';

import { useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Card, CardContent, TextField, Button,
  Accordion, AccordionSummary, AccordionDetails, Chip, Rating,
  Alert, Divider, CircularProgress, Grid, Stack, LinearProgress
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  ExpandMore, Edit, Save, Send, Flag, Assignment, EmojiObjects,
  TrendingUp, Star, Refresh, SmartToy, Person, Close
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
  overallSelfRating?: number;
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
  requireSelfRating?: boolean;
}

const ratingLabels: Record<number, string> = {
  1: 'Needs Improvement',
  2: 'Partially Meets',
  3: 'Meets Expectations',
  4: 'Exceeds Expectations',
  5: 'Outstanding'
};

const countWords = (text: string) =>
  (text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;

const isMeaningfulSummaryText = (text: string) => {
  const normalized = (text || '').trim();
  if (!normalized || /^not provided\.?$/i.test(normalized)) return false;
  return countWords(normalized) >= 4;
};

const SectionEditor = ({
  title,
  icon,
  value,
  fieldName,
  onEdit,
  placeholder,
  guidance,
  starterPrompts,
  targetWords
}: {
  title: string;
  icon: React.ReactNode;
  value: string;
  fieldName: string;
  onEdit: (field: string, value: string) => void;
  placeholder: string;
  guidance: string;
  starterPrompts: string[];
  targetWords: number;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [initialValue, setInitialValue] = useState('');

  const currentText = isEditing ? editValue : (value || '');
  const wordCount = countWords(currentText);
  const completion = Math.min(100, Math.round((wordCount / targetWords) * 100));
  const hasContent = isMeaningfulSummaryText(currentText);

  const commitEditValue = (nextValue: string) => {
    setEditValue(nextValue);
    onEdit(fieldName, nextValue);
  };

  const appendPrompt = (prompt: string) => {
    const nextValue = ((prev: string) => {
      const base = (prev || '').trim();
      return base ? `${base}\n- ${prompt}` : `- ${prompt}`;
    })(editValue);
    commitEditValue(nextValue);
  };

  const handleSave = () => {
    const trimmed = editValue.trim();
    commitEditValue(trimmed);
    setIsEditing(false);
  };

  const handleCancel = () => {
    const resetValue = initialValue || '';
    setEditValue(resetValue);
    onEdit(fieldName, resetValue);
    setIsEditing(false);
  };

  const handleStartEditing = () => {
    const currentValue = value || '';
    setInitialValue(currentValue);
    setEditValue(currentValue);
    setIsEditing(true);
  };

  return (
    <Card
      variant="outlined"
      sx={{
        mb: 2,
        borderColor: isEditing ? 'primary.main' : 'divider',
        bgcolor: isEditing ? 'primary.lighter' : 'background.paper'
      }}
    >
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {icon}
            <Typography variant="subtitle1" fontWeight={700}>
              {title}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              size="small"
              variant="outlined"
              label={`${wordCount} words`}
              color={hasContent ? 'success' : 'default'}
            />
            <Button
              size="small"
              variant={isEditing ? 'contained' : 'text'}
              startIcon={isEditing ? <Save /> : <Edit />}
              onClick={isEditing ? handleSave : handleStartEditing}
            >
              {isEditing ? 'Save' : value ? 'Refine' : 'Add details'}
            </Button>
            {isEditing && (
              <Button size="small" startIcon={<Close />} onClick={handleCancel}>
                Cancel
              </Button>
            )}
          </Stack>
        </Box>

        {!isEditing ? (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: value ? 'text.primary' : 'text.disabled' }}>
            {value || placeholder}
          </Typography>
        ) : (
          <Box>
            <TextField
              fullWidth
              multiline
              minRows={5}
              maxRows={12}
              value={editValue}
              onChange={(e) => commitEditValue(e.target.value)}
              placeholder={placeholder}
              helperText={guidance}
              sx={{ mb: 1.5 }}
            />

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Starter prompts
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
              {starterPrompts.map((prompt) => (
                <Chip
                  key={prompt}
                  size="small"
                  variant="outlined"
                  label={prompt}
                  onClick={() => appendPrompt(prompt)}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Stack>

            <LinearProgress
              variant="determinate"
              value={completion}
              color={completion >= 80 ? 'success' : completion >= 45 ? 'warning' : 'error'}
              sx={{ height: 8, borderRadius: 4 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
              Target depth: ~{targetWords} words for a strong section.
            </Typography>
          </Box>
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
  isRegenerating,
  requireSelfRating = true
}: ReportPreviewProps) {
  const theme = useTheme();
  const aiSuggestedRating = report.aiSuggestedRating?.suggestedRating ?? report.suggestedOverallRating ?? null;
  const aiJustification = report.aiSuggestedRating?.ratingJustification ?? report.ratingJustification;
  const hasInsufficientSignal = (report.missingInfo?.length || 0) > 0;
  const hasAiSuggestedRating = (
    typeof aiSuggestedRating === 'number' &&
    aiSuggestedRating >= 1 &&
    aiSuggestedRating <= 5 &&
    !hasInsufficientSignal
  );

  const completeness = useMemo(() => {
    const requiredFields: Array<keyof ReportData['overallSummary']> = ['achievements', 'challenges', 'learnings', 'goals'];
    const completed = requiredFields.filter((field) => isMeaningfulSummaryText(report.overallSummary?.[field] || '')).length;
    return Math.round((completed / requiredFields.length) * 100);
  }, [report.overallSummary]);

  const overallSelfRating = report.overallSelfRating ?? null;

  const handleSelfRatingChange = (_: unknown, value: number | null) => {
    if (value) {
      onEdit('overallSelfRating', String(value));
    } else {
      onEdit('overallSelfRating', '');
    }
  };

  return (
    <Box sx={{ p: { xs: 1, sm: 2 } }}>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 1.5, sm: 2 },
          mb: 2,
          borderRadius: 2.5,
          borderColor: alpha(theme.palette.primary.main, 0.25),
          backgroundImage: `linear-gradient(145deg, ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.86)} 100%)`
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="overline" color="text.secondary">
              Review Draft
            </Typography>
            <Typography variant="h5" fontWeight={700} sx={{ mt: -0.5 }}>
              Self-Assessment Report
            </Typography>
          </Box>
          <Button
            variant="outlined"
            startIcon={isRegenerating ? <CircularProgress size={16} /> : <Refresh />}
            onClick={onRegenerate}
            disabled={isRegenerating || isSubmitting}
            sx={{ borderRadius: 999 }}
          >
            Regenerate
          </Button>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 3, bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 2 }}>
          <Typography variant="subtitle1" fontWeight={700}>
            Report Completeness
          </Typography>
          <Chip
            label={`${completeness}%`}
            color={completeness >= 75 ? 'success' : completeness >= 40 ? 'warning' : 'error'}
            size="small"
          />
        </Box>
        <LinearProgress
          variant="determinate"
          value={completeness}
          color={completeness >= 75 ? 'success' : completeness >= 40 ? 'warning' : 'error'}
          sx={{ height: 9, borderRadius: 4.5 }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Complete achievements, challenges, learnings, and next goals for a stronger report.
        </Typography>
      </Paper>

      <Alert severity="info" sx={{ mb: 3 }}>
        Review your draft report below. Edit any section that needs more detail before submitting.
      </Alert>

      {report.missingInfo && report.missingInfo.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom>
            Suggested Improvements
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

      <Paper
        sx={{
          p: 3,
          mb: 2,
          bgcolor: 'primary.lighter',
          border: 1,
          borderColor: alpha(theme.palette.primary.main, 0.35),
          borderRadius: 2.5
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Person color="primary" />
          <Typography variant="subtitle1" fontWeight={600}>
            Your Overall Self-Rating
          </Typography>
          <Chip size="small" color={requireSelfRating ? 'warning' : 'default'} label={requireSelfRating ? 'Required' : 'Optional'} />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
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

        {requireSelfRating && !overallSelfRating && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            Choose your self-rating to submit.
          </Alert>
        )}
      </Paper>

      <Paper sx={{ p: 3, mb: 3, border: 1, borderColor: 'divider', bgcolor: 'background.paper', borderRadius: 2.5 }}>
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

      <SectionEditor
        title="Key Achievements"
        icon={<Flag color="success" />}
        value={report.overallSummary.achievements}
        fieldName="achievements"
        onEdit={(field, value) => onEdit(`overallSummary.${field}`, value)}
        placeholder="Describe your key accomplishments..."
        guidance="Include impact, numbers, and who benefited from the result."
        starterPrompts={[
          'What did I deliver?',
          'What measurable outcome did it produce?',
          'What cross-team impact did it create?'
        ]}
        targetWords={70}
      />

      <SectionEditor
        title="Challenges Faced"
        icon={<Assignment color="warning" />}
        value={report.overallSummary.challenges}
        fieldName="challenges"
        onEdit={(field, value) => onEdit(`overallSummary.${field}`, value)}
        placeholder="Describe challenges you faced..."
        guidance="State the challenge, what you tried, and what result or learning came out of it."
        starterPrompts={[
          'The blocker was...',
          'I addressed it by...',
          'The outcome/lesson was...'
        ]}
        targetWords={50}
      />

      <SectionEditor
        title="Key Learnings"
        icon={<EmojiObjects color="info" />}
        value={report.overallSummary.learnings}
        fieldName="learnings"
        onEdit={(field, value) => onEdit(`overallSummary.${field}`, value)}
        placeholder="Describe what you learned..."
        guidance="Capture the specific skill or insight and where you applied it."
        starterPrompts={[
          'A skill I strengthened was...',
          'I applied this by...',
          'This changed how I now...'
        ]}
        targetWords={45}
      />

      <SectionEditor
        title="Areas for Improvement"
        icon={<TrendingUp color="secondary" />}
        value={report.overallSummary.improvements}
        fieldName="improvements"
        onEdit={(field, value) => onEdit(`overallSummary.${field}`, value)}
        placeholder="Describe areas for improvement..."
        guidance="Keep this specific and actionable."
        starterPrompts={[
          'I need to improve...',
          'My plan to improve is...',
          'I need support in...'
        ]}
        targetWords={35}
      />

      <SectionEditor
        title="Goals for Next Period"
        icon={<Star color="primary" />}
        value={report.overallSummary.goals}
        fieldName="goals"
        onEdit={(field, value) => onEdit(`overallSummary.${field}`, value)}
        placeholder="Set your goals for next period..."
        guidance="Each goal should have a clear outcome and timeframe."
        starterPrompts={[
          'Goal 1: ... by ...',
          'Success metric: ...',
          'Dependencies/support needed: ...'
        ]}
        targetWords={55}
      />

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

      <Alert severity="warning" sx={{ mb: 2 }}>
        Once submitted, you cannot make changes. Your manager will be notified to begin their review.
      </Alert>

      {hasInsufficientSignal && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Some areas still need more detail, but you can submit when ready.
        </Alert>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          color="success"
          size="large"
          startIcon={isSubmitting ? <CircularProgress size={20} color="inherit" /> : <Send />}
          onClick={onSubmit}
          disabled={isSubmitting || isRegenerating || (requireSelfRating && !overallSelfRating)}
          sx={{ borderRadius: 999, width: { xs: '100%', sm: 'auto' }, px: 3 }}
        >
          Submit Self-Assessment
        </Button>
      </Box>
    </Box>
  );
}
