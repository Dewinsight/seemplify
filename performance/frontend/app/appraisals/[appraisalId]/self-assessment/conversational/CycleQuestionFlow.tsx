'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { AttachFile, Check, EditOutlined } from '@mui/icons-material';

export type CycleQuestionResponseType =
  | 'short_text'
  | 'long_text'
  | 'rating'
  | 'number'
  | 'boolean'
  | 'single_select'
  | 'multi_select';

export type CycleQuestionValue = string | number | boolean | string[] | null | undefined;

export interface CycleQuestionDefinition {
  key: string;
  sectionId: string;
  sectionTitle: string;
  sectionDescription?: string;
  sectionType?: string;
  questionId: string;
  prompt: string;
  helpText?: string;
  responseType: CycleQuestionResponseType;
  required: boolean;
  options: string[];
  ratingMin: number;
  ratingMax: number;
  evidenceRequired?: boolean;
}

export interface CycleQuestionResponse extends CycleQuestionDefinition {
  value: CycleQuestionValue;
  skipped?: boolean;
  answered?: boolean;
  lastSavedAt?: string;
  submittedAt?: string;
}

export interface CycleQuestionProgress {
  currentIndex: number;
  total: number;
  answered: number;
  skipped: number;
  requiredTotal: number;
  requiredAnswered: number;
  complete: boolean;
  currentQuestion: CycleQuestionDefinition | null;
  questions: CycleQuestionDefinition[];
  responses: CycleQuestionResponse[];
}

type UnknownRecord = Record<string, unknown>;

function recordOf(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function textOf(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function numberOf(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanOf(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function questionKey(sectionId: string, questionId: string) {
  return `${sectionId}:${questionId}`;
}

function normalizeQuestion(value: unknown): CycleQuestionDefinition | null {
  const source = recordOf(value);
  const nested = recordOf(source.question);
  const raw = Object.keys(nested).length > 0 ? { ...source, ...nested } : source;
  const sectionId = textOf(raw.sectionId);
  const questionId = textOf(raw.questionId || raw.id);
  const prompt = textOf(raw.prompt);
  if (!sectionId || !questionId || !prompt) return null;

  const rawType = textOf(raw.responseType) as CycleQuestionResponseType;
  const responseTypes: CycleQuestionResponseType[] = [
    'short_text', 'long_text', 'rating', 'number', 'boolean', 'single_select', 'multi_select',
  ];
  const responseType = responseTypes.includes(rawType) ? rawType : 'long_text';

  return {
    key: textOf(raw.key) || questionKey(sectionId, questionId),
    sectionId,
    sectionTitle: textOf(raw.sectionTitle || recordOf(raw.section).title) || 'Cycle questions',
    sectionDescription: textOf(raw.sectionDescription || recordOf(raw.section).description),
    sectionType: textOf(raw.sectionType || recordOf(raw.section).type),
    questionId,
    prompt,
    helpText: textOf(raw.helpText),
    responseType,
    required: raw.required !== false,
    options: Array.isArray(raw.options) ? raw.options.map(String) : [],
    ratingMin: numberOf(raw.ratingMin, 1),
    ratingMax: numberOf(raw.ratingMax, 5),
    evidenceRequired: booleanOf(raw.evidenceRequired),
  };
}

function responseHasValue(value: CycleQuestionValue) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeResponse(value: unknown, definitions: Map<string, CycleQuestionDefinition>): CycleQuestionResponse | null {
  const source = recordOf(value);
  const sectionId = textOf(source.sectionId || recordOf(source.question).sectionId);
  const questionId = textOf(source.questionId || recordOf(source.question).questionId || recordOf(source.question).id);
  const definition = definitions.get(questionKey(sectionId, questionId)) || normalizeQuestion(source);
  if (!definition) return null;

  return {
    ...definition,
    value: source.value as CycleQuestionValue,
    skipped: source.skipped === true,
    answered: source.answered === true || source.skipped === true || responseHasValue(source.value as CycleQuestionValue),
    lastSavedAt: textOf(source.lastSavedAt),
    submittedAt: textOf(source.submittedAt),
  };
}

/**
 * The backend exposes the canonical fields at the response-data level. During
 * rollout we also accept the same fields nested under cycleQuestionProgress,
 * so an older frontend and newer backend can overlap safely.
 */
export function normalizeCycleQuestionProgress(payload: unknown): CycleQuestionProgress | null {
  const source = recordOf(payload);
  const rawProgress = recordOf(source.cycleQuestionProgress);
  const rawQuestions = Array.isArray(source.cycleQuestions)
    ? source.cycleQuestions
    : Array.isArray(rawProgress.questions)
      ? rawProgress.questions
      : [];
  const questions = rawQuestions.map(normalizeQuestion).filter((item): item is CycleQuestionDefinition => Boolean(item));
  const definitions = new Map(questions.map((question) => [questionKey(question.sectionId, question.questionId), question]));
  const rawResponses = Array.isArray(source.cycleResponses)
    ? source.cycleResponses
    : Array.isArray(rawProgress.responses)
      ? rawProgress.responses
      : [];
  const responses = rawResponses
    .map((response) => normalizeResponse(response, definitions))
    .filter((item): item is CycleQuestionResponse => Boolean(item));
  const skippedKeys = Array.isArray(rawProgress.skippedKeys) ? rawProgress.skippedKeys.map(String) : [];
  questions.forEach((question) => {
    if (!skippedKeys.includes(question.key)) return;
    if (responses.some((response) => response.key === question.key)) return;
    responses.push({ ...question, value: undefined, skipped: true, answered: true });
  });
  const active = normalizeQuestion(
    source.activeCycleQuestion
      || rawProgress.currentQuestion
      || rawProgress.activeCycleQuestion
      || source.currentQuestion
  );

  const hasContract = questions.length > 0
    || responses.length > 0
    || Boolean(active)
    || Object.keys(rawProgress).length > 0;
  if (!hasContract) return null;

  const answeredFromRows = responses.filter((response) => response.answered || response.skipped).length;
  const requiredQuestions = questions.filter((question) => question.required);
  const requiredAnsweredFromRows = requiredQuestions.filter((question) => {
    const response = responses.find((item) => item.sectionId === question.sectionId && item.questionId === question.questionId);
    return Boolean(response?.answered && !response.skipped);
  }).length;
  const total = numberOf(rawProgress.total, questions.length);
  const answered = numberOf(rawProgress.answered, answeredFromRows);
  const skipped = numberOf(rawProgress.skipped, skippedKeys.length);
  const requiredTotal = numberOf(rawProgress.requiredTotal, requiredQuestions.length);
  const requiredAnswered = numberOf(rawProgress.requiredAnswered, requiredAnsweredFromRows);

  return {
    currentIndex: numberOf(rawProgress.currentIndex, active ? Math.min(answered + skipped, total) : total),
    total,
    answered,
    skipped,
    requiredTotal,
    requiredAnswered,
    complete: booleanOf(
      rawProgress.complete ?? rawProgress.completed,
      total > 0 && answered + skipped >= total && requiredAnswered >= requiredTotal
    ),
    currentQuestion: active,
    questions,
    responses,
  };
}

export function formatCycleQuestionValue(value: CycleQuestionValue, skipped = false) {
  if (skipped) return 'Skipped';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined || value === '') return 'No response';
  return String(value);
}

function emptyValueFor(question: CycleQuestionDefinition): CycleQuestionValue {
  if (question.responseType === 'multi_select') return [];
  return '';
}

export function CycleQuestionInput({
  question,
  value,
  onChange,
  disabled = false,
  error = false,
  idPrefix = 'cycle-question',
}: {
  question: CycleQuestionDefinition;
  value: CycleQuestionValue;
  onChange: (value: CycleQuestionValue) => void;
  disabled?: boolean;
  error?: boolean;
  idPrefix?: string;
}) {
  const labelId = `${idPrefix}-${question.sectionId}-${question.questionId}-label`;

  if (question.responseType === 'boolean') {
    return (
      <FormControl error={error} disabled={disabled}>
        <FormLabel id={labelId} sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {question.prompt}
        </FormLabel>
        <RadioGroup
          row
          aria-labelledby={labelId}
          value={typeof value === 'boolean' ? String(value) : ''}
          onChange={(event) => onChange(event.target.value === 'true')}
        >
          <FormControlLabel value="true" control={<Radio />} label="Yes" />
          <FormControlLabel value="false" control={<Radio />} label="No" />
        </RadioGroup>
      </FormControl>
    );
  }

  if (question.responseType === 'rating' || question.responseType === 'single_select') {
    const choices = question.responseType === 'rating'
      ? Array.from({ length: Math.max(0, question.ratingMax - question.ratingMin + 1) }, (_, index) => question.ratingMin + index)
      : question.options;
    return (
      <FormControl fullWidth error={error} disabled={disabled}>
        <FormLabel id={labelId} sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {question.prompt}
        </FormLabel>
        <RadioGroup
          row={question.responseType === 'rating'}
          aria-labelledby={labelId}
          value={value ?? ''}
          onChange={(event) => onChange(question.responseType === 'rating' ? Number(event.target.value) : event.target.value)}
          sx={{ gap: question.responseType === 'rating' ? 0.5 : 0 }}
        >
          {choices.map((choice) => (
            <FormControlLabel
              key={String(choice)}
              value={choice}
              control={<Radio />}
              label={question.responseType === 'rating' ? `${choice} / ${question.ratingMax}` : String(choice)}
              sx={{ mr: question.responseType === 'rating' ? 1.5 : 2 }}
            />
          ))}
        </RadioGroup>
      </FormControl>
    );
  }

  if (question.responseType === 'multi_select') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <FormControl fullWidth error={error} disabled={disabled}>
        <FormLabel id={labelId} sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {question.prompt}
        </FormLabel>
        <FormGroup aria-labelledby={labelId}>
          {question.options.map((option) => (
            <FormControlLabel
              key={option}
              label={option}
              control={(
                <Checkbox
                  checked={selected.includes(option)}
                  onChange={(event) => onChange(
                    event.target.checked
                      ? [...selected, option]
                      : selected.filter((item) => item !== option)
                  )}
                />
              )}
            />
          ))}
        </FormGroup>
      </FormControl>
    );
  }

  return (
    <TextField
      fullWidth
      type={question.responseType === 'number' ? 'number' : 'text'}
      multiline={question.responseType === 'long_text'}
      minRows={question.responseType === 'long_text' ? 4 : undefined}
      value={value ?? ''}
      disabled={disabled}
      error={error}
      inputProps={{ 'aria-label': question.prompt }}
      placeholder={question.responseType === 'long_text' ? 'Add a specific response with context and examples.' : 'Enter your response'}
      onChange={(event) => onChange(
        question.responseType === 'number' && event.target.value !== ''
          ? Number(event.target.value)
          : event.target.value
      )}
    />
  );
}

export function CycleQuestionCard({
  progress,
  busy,
  onSubmit,
  onUploadEvidence,
}: {
  progress: CycleQuestionProgress;
  busy: boolean;
  onSubmit: (question: CycleQuestionDefinition, value: CycleQuestionValue, skip?: boolean) => Promise<void>;
  onUploadEvidence?: () => void;
}) {
  const question = progress.currentQuestion;
  const existing = useMemo(() => question
    ? progress.responses.find((response) => response.sectionId === question.sectionId && response.questionId === question.questionId)
    : undefined, [progress.responses, question]);
  const [value, setValue] = useState<CycleQuestionValue>(question ? existing?.value ?? emptyValueFor(question) : '');
  const [showError, setShowError] = useState(false);

  if (!question) return null;

  const save = async () => {
    if (!responseHasValue(value)) {
      setShowError(true);
      return;
    }
    setShowError(false);
    await onSubmit(question, value, false);
  };

  const ordinal = Math.min(progress.total, Math.max(1, progress.currentIndex + 1));
  return (
    <Paper
      component="section"
      variant="outlined"
      data-testid="cycle-question-card"
      aria-labelledby="active-cycle-question"
      sx={{ p: { xs: 2, sm: 2.5 }, m: { xs: 1.5, sm: 2 }, borderRadius: 2, borderColor: 'divider' }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1} mb={1.5}>
        <Box>
          <Typography variant="subtitle2" fontWeight={700}>{question.sectionTitle}</Typography>
          {question.sectionDescription && (
            <Typography variant="body2" color="text.secondary">{question.sectionDescription}</Typography>
          )}
        </Box>
        <Chip size="small" variant="outlined" label={`Question ${ordinal} of ${progress.total}`} sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, borderRadius: 1 }} />
      </Stack>

      <Typography id="active-cycle-question" variant="body1" fontWeight={650} mb={0.5}>
        {question.prompt}{question.required ? ' *' : ''}
      </Typography>
      {question.helpText && <Typography variant="body2" color="text.secondary" mb={1.5}>{question.helpText}</Typography>}
      <CycleQuestionInput question={question} value={value} onChange={setValue} disabled={busy} error={showError} />
      {showError && <Alert severity="warning" sx={{ mt: 1.5 }}>Enter a response, or use Skip when this question is optional.</Alert>}

      {question.evidenceRequired && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
          gap={1}
          sx={{ mt: 1.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1.5, bgcolor: 'action.hover' }}
        >
          <Box>
            <Typography variant="body2" fontWeight={650}>Supporting evidence required</Typography>
            <Typography variant="caption" color="text.secondary">Attach a document before this appraisal is submitted.</Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={<AttachFile />}
            disabled={busy || !onUploadEvidence}
            onClick={onUploadEvidence}
            sx={{ flexShrink: 0, borderRadius: 1.25 }}
          >
            Attach evidence
          </Button>
        </Stack>
      )}

      <Stack direction={{ xs: 'column-reverse', sm: 'row' }} justifyContent="flex-end" gap={1} mt={2}>
        {!question.required && (
          <Button
            color="inherit"
            disabled={busy}
            onClick={() => onSubmit(question, undefined, true)}
            sx={{ borderRadius: 1.25 }}
          >
            Skip
          </Button>
        )}
        <Button
          variant="contained"
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <Check />}
          disabled={busy || !responseHasValue(value)}
          onClick={save}
          sx={{ borderRadius: 1.25 }}
        >
          Save and continue
        </Button>
      </Stack>
    </Paper>
  );
}

export function CycleResponsesReview({
  progress,
  busy,
  onSave,
}: {
  progress: CycleQuestionProgress;
  busy: boolean;
  onSave: (question: CycleQuestionDefinition, value: CycleQuestionValue) => Promise<boolean>;
}) {
  const [editingKey, setEditingKey] = useState('');
  const [draft, setDraft] = useState<CycleQuestionValue>('');
  const orderedRows = progress.questions.map((question) => ({
    question,
    response: progress.responses.find((item) => item.sectionId === question.sectionId && item.questionId === question.questionId),
  }));

  return (
    <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, mb: 2.5, borderRadius: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1} mb={2}>
        <Box>
          <Typography variant="h6">Cycle-specific responses</Typography>
          <Typography variant="body2" color="text.secondary">Review the exact answers that will remain with this appraisal.</Typography>
        </Box>
        <Chip
          size="small"
          color={progress.requiredAnswered >= progress.requiredTotal ? 'success' : 'warning'}
          variant="outlined"
          label={`${progress.requiredAnswered} of ${progress.requiredTotal} required answered`}
          sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, borderRadius: 1 }}
        />
      </Stack>

      <Stack divider={<Divider flexItem />}>
        {orderedRows.map(({ question, response }) => {
          const isEditing = editingKey === question.key;
          return (
            <Box key={question.key} sx={{ py: 2, '&:first-of-type': { pt: 0 }, '&:last-of-type': { pb: 0 } }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1.5}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">{question.sectionTitle}</Typography>
                  <Typography variant="body2" fontWeight={650}>{question.prompt}</Typography>
                  {!isEditing && (
                    <Typography variant="body2" sx={{ mt: 0.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {formatCycleQuestionValue(response?.value, response?.skipped)}
                    </Typography>
                  )}
                </Box>
                {!isEditing && (
                  <Button
                    size="small"
                    startIcon={<EditOutlined />}
                    disabled={busy}
                    onClick={() => {
                      setEditingKey(question.key);
                      setDraft(response?.value ?? emptyValueFor(question));
                    }}
                    sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, borderRadius: 1.25 }}
                  >
                    {responseHasValue(response?.value) && !response?.skipped ? 'Edit answer' : 'Add answer'}
                  </Button>
                )}
              </Stack>

              {isEditing && (
                <Box sx={{ mt: 1.5 }}>
                  <CycleQuestionInput question={question} value={draft} onChange={setDraft} disabled={busy} idPrefix="cycle-review" />
                  <Stack direction="row" justifyContent="flex-end" gap={1} mt={1.5}>
                    <Button color="inherit" disabled={busy} onClick={() => setEditingKey('')} sx={{ borderRadius: 1.25 }}>Cancel</Button>
                    <Button
                      variant="contained"
                      disabled={busy || !responseHasValue(draft)}
                      onClick={async () => {
                        const saved = await onSave(question, draft);
                        if (saved) setEditingKey('');
                      }}
                      sx={{ borderRadius: 1.25 }}
                    >
                      Save change
                    </Button>
                  </Stack>
                </Box>
              )}
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}
