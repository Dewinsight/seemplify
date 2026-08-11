'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import api from '@/lib/api';
import {
  Alert,
  Box,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import type { CycleDesign, CycleQuestion, CycleSection } from './CycleDesignBuilder';

export interface CustomAssessmentSectionsHandle {
  save: (submit?: boolean) => Promise<boolean>;
  validate: () => string[];
}

interface Props {
  appraisal: AppraisalLike;
  respondentRole: 'employee' | 'manager';
  readOnly?: boolean;
  onSaveError?: (message: string) => void;
  onSaved?: () => void | Promise<void>;
}

type ValueMap = Record<string, unknown>;

interface ExistingResponse {
  sectionId: string;
  questionId: string;
  respondentRole: 'employee' | 'manager';
  value: unknown;
}

interface AppraisalLike {
  _id: string;
  cycleConfigurationSnapshot?: { workflowDefinition?: CycleDesign };
  cycleId?: { workflowDefinition?: CycleDesign };
  customResponses?: ExistingResponse[];
  documents?: unknown[];
}

function responseKey(sectionId: string, questionId: string) {
  return `${sectionId}:${questionId}`;
}

function hasValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  return String(value || '').trim().length > 0;
}

function getDesign(appraisal: AppraisalLike): CycleDesign | null {
  return appraisal?.cycleConfigurationSnapshot?.workflowDefinition || appraisal?.cycleId?.workflowDefinition || null;
}

const CustomAssessmentSections = forwardRef<CustomAssessmentSectionsHandle, Props>(function CustomAssessmentSections(
  { appraisal, respondentRole, readOnly = false, onSaveError, onSaved },
  ref
) {
  const design = getDesign(appraisal);
  const sections = useMemo(() => (design?.sections || []).filter((section: CycleSection) => (
    !['goals', 'competencies'].includes(section.type) &&
    (section.respondent === respondentRole || section.respondent === 'both')
  )), [design, respondentRole]);
  const [values, setValues] = useState<ValueMap>(() => {
    const initial: ValueMap = {};
    (appraisal.customResponses || [])
      .filter((item) => item.respondentRole === respondentRole)
      .forEach((item) => { initial[responseKey(item.sectionId, item.questionId)] = item.value; });
    return initial;
  });
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const dirty = useRef(false);

  const validate = useCallback(() => {
    const missing: string[] = [];
    sections.forEach((section: CycleSection) => {
      section.questions.forEach((question) => {
        if (section.required && question.required && !hasValue(values[responseKey(section.id, question.id)])) missing.push(question.prompt);
      });
      if (section.required && section.evidenceRequired && (!appraisal.documents || appraisal.documents.length === 0)) {
        missing.push(`${section.title}: attach supporting evidence`);
      }
    });
    return missing;
  }, [appraisal.documents, sections, values]);

  const save = useCallback(async (submit = false) => {
    if (!appraisal?._id || readOnly) return true;
    if (submit) {
      const missing = validate();
      if (missing.length > 0) {
        const message = `Complete the required cycle questions: ${missing.join('; ')}`;
        setSaveState('error');
        onSaveError?.(message);
        return false;
      }
    }
    setSaveState('saving');
    try {
      await api.put(`/appraisals/${appraisal._id}/custom-responses`, {
        respondentRole,
        submit,
        responses: sections.flatMap((section: CycleSection) => section.questions.map((question) => ({
          sectionId: section.id,
          questionId: question.id,
          value: values[responseKey(section.id, question.id)]
        })))
      });
      dirty.current = false;
      setSaveState('saved');
      await onSaved?.();
      return true;
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Cycle responses could not be saved.';
      setSaveState('error');
      onSaveError?.(message);
      return false;
    }
  }, [appraisal._id, onSaveError, onSaved, readOnly, respondentRole, sections, validate, values]);

  useImperativeHandle(ref, () => ({ save, validate }));

  useEffect(() => {
    if (!dirty.current || readOnly || !appraisal?._id) return;
    const timer = window.setTimeout(() => { save(false); }, 1000);
    return () => window.clearTimeout(timer);
  }, [values, readOnly, appraisal._id, save]);

  if (sections.length === 0) return null;

  const updateValue = (sectionId: string, questionId: string, value: unknown) => {
    dirty.current = true;
    setSaveState('idle');
    setValues((current) => ({ ...current, [responseKey(sectionId, questionId)]: value }));
  };

  const renderQuestion = (section: CycleSection, question: CycleQuestion) => {
    const key = responseKey(section.id, question.id);
    const value = values[key];
    if (question.responseType === 'rating') {
      const minimum = question.ratingMin || 1;
      const maximum = question.ratingMax || 5;
      const labelId = `rating-${section.id}-${question.id}-label`;
      return (
        <FormControl fullWidth size="small">
          <InputLabel id={labelId}>Rating</InputLabel>
          <Select
            labelId={labelId}
            id={`rating-${section.id}-${question.id}`}
            value={typeof value === 'number' ? value : ''}
            label="Rating"
            disabled={readOnly}
            onChange={(event) => updateValue(section.id, question.id, Number(event.target.value))}
          >
            {Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index)
              .map((rating) => <MenuItem key={rating} value={rating}>{rating} / {maximum}</MenuItem>)}
          </Select>
        </FormControl>
      );
    }
    if (question.responseType === 'boolean') {
      return <FormControlLabel control={<Checkbox checked={value === true} disabled={readOnly} onChange={(event) => updateValue(section.id, question.id, event.target.checked)} />} label="Yes" />;
    }
    if (['single_select', 'multi_select'].includes(question.responseType)) {
      const multiple = question.responseType === 'multi_select';
      const labelId = `answer-${section.id}-${question.id}-label`;
      return (
        <FormControl fullWidth size="small">
          <InputLabel id={labelId}>Answer</InputLabel>
          <Select
            labelId={labelId}
            id={`answer-${section.id}-${question.id}`}
            multiple={multiple}
            value={multiple ? (Array.isArray(value) ? value : []) : (value || '')}
            label="Answer"
            disabled={readOnly}
            onChange={(event) => updateValue(section.id, question.id, event.target.value)}
          >
            {question.options.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
          </Select>
        </FormControl>
      );
    }
    return (
      <TextField
        fullWidth
        size="small"
        type={question.responseType === 'number' ? 'number' : 'text'}
        multiline={question.responseType === 'long_text'}
        minRows={question.responseType === 'long_text' ? 3 : undefined}
        value={value ?? ''}
        disabled={readOnly}
        placeholder="Enter your response"
        onChange={(event) => updateValue(
          section.id,
          question.id,
          question.responseType === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value
        )}
      />
    );
  };

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: { xs: 2, md: 2.5 }, mb: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={1} mb={2}>
        <Box>
          <Typography variant="h6">Cycle-specific questions</Typography>
          <Typography variant="body2" color="text.secondary">These questions were configured for this review and are frozen for its full history.</Typography>
        </Box>
        {saveState === 'saving' && <Chip size="small" label="Saving…" variant="outlined" />}
        {saveState === 'saved' && <Chip size="small" label="Saved" color="success" variant="outlined" />}
        {saveState === 'error' && <Chip size="small" label="Needs attention" color="error" variant="outlined" />}
      </Stack>

      <Stack spacing={3}>
        {sections.map((section: CycleSection) => (
          <Box key={section.id}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="subtitle1" fontWeight={700}>{section.title}</Typography>
              {section.required && <Chip size="small" label="Required" variant="outlined" />}
              {section.scored && <Chip size="small" label={`${section.weight}% of rating`} color="info" variant="outlined" />}
            </Stack>
            {section.description && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{section.description}</Typography>}
            {section.evidenceRequired && <Alert severity="info" sx={{ mt: 1 }}>This section requires at least one supporting document on the appraisal.</Alert>}
            <Stack spacing={2} sx={{ mt: 2 }}>
              {section.questions.map((question) => (
                <Box key={question.id}>
                  <Typography component="label" variant="body2" fontWeight={600} display="block" mb={0.75}>
                    {question.prompt}{section.required && question.required ? ' *' : ''}
                  </Typography>
                  {question.helpText && <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>{question.helpText}</Typography>}
                  {renderQuestion(section, question)}
                </Box>
              ))}
            </Stack>
          </Box>
        ))}
      </Stack>
    </Box>
  );
});

export default CustomAssessmentSections;
