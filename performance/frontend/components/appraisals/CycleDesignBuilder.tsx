'use client';

import { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material';
import { Add, ArrowDownward, ArrowUpward, DeleteOutline, SaveOutlined } from '@mui/icons-material';

export type ResponseType = 'short_text' | 'long_text' | 'rating' | 'number' | 'boolean' | 'single_select' | 'multi_select';
export type SectionType = 'goals' | 'competencies' | 'achievements' | 'learning' | 'development' | 'custom';
export type Respondent = 'employee' | 'manager' | 'both';

export interface CycleQuestion {
  id: string;
  prompt: string;
  helpText: string;
  responseType: ResponseType;
  required: boolean;
  options: string[];
  ratingMin: number;
  ratingMax: number;
}

export interface CycleSection {
  id: string;
  title: string;
  description: string;
  type: SectionType;
  respondent: Respondent;
  required: boolean;
  scored: boolean;
  weight: number;
  evidenceRequired: boolean;
  questions: CycleQuestion[];
}

export interface CycleDesign {
  version: number;
  scoring: { goalsWeight: number; competenciesWeight: number };
  stages: Record<string, { enabled: boolean }>;
  sections: CycleSection[];
}

export interface CycleTemplateSummary {
  id: string;
  name: string;
  description?: string;
  category?: string;
  version?: number;
  system?: boolean;
  design: CycleDesign;
}

export function validateCycleDesign(design: CycleDesign): string[] {
  const errors: string[] = [];
  if (!design.sections.length) errors.push('Add at least one assessment section.');

  design.sections.forEach((section) => {
    if (!section.title.trim()) errors.push('Every assessment section needs a title.');
    if (!['goals', 'competencies'].includes(section.type) && section.questions.length === 0) {
      errors.push(`${section.title || 'Custom section'} needs at least one question.`);
    }
    section.questions.forEach((question) => {
      if (!question.prompt.trim()) errors.push(`Every question in ${section.title || 'a custom section'} needs prompt text.`);
      if (['single_select', 'multi_select'].includes(question.responseType) && question.options.length < 2) {
        errors.push(`${question.prompt || 'Choice question'} needs at least two choices.`);
      }
      if (question.responseType === 'rating' && question.ratingMax <= question.ratingMin) {
        errors.push(`${question.prompt || 'Rating question'} needs a maximum above its minimum.`);
      }
    });
    if (section.scored && !['goals', 'competencies'].includes(section.type)) {
      const hasManagerRating = ['manager', 'both'].includes(section.respondent)
        && section.questions.some((question) => question.responseType === 'rating');
      if (!hasManagerRating) errors.push(`${section.title || 'Scored section'} needs a manager rating question.`);
    }
  });

  const scoredWeight = design.sections
    .filter((section) => section.scored)
    .reduce((sum, section) => sum + Number(section.weight || 0), 0);
  if (Math.abs(scoredWeight - 100) >= 0.01) {
    errors.push(`Scored assessment sections must total 100% (currently ${scoredWeight}%).`);
  }
  return Array.from(new Set(errors));
}

export const DEFAULT_CYCLE_DESIGN: CycleDesign = {
  version: 1,
  scoring: { goalsWeight: 40, competenciesWeight: 60 },
  stages: {
    goalSetting: { enabled: true },
    selfAssessment: { enabled: true },
    managerReview: { enabled: true },
    discussion: { enabled: true },
    calibration: { enabled: false },
    finalReview: { enabled: true },
    acknowledgement: { enabled: true }
  },
  sections: [
    { id: 'goals', title: 'Goals and outcomes', description: 'Review approved goal evidence for the period.', type: 'goals', respondent: 'both', required: true, scored: true, weight: 40, evidenceRequired: false, questions: [] },
    { id: 'competencies', title: 'Competencies', description: 'Assess the behaviours and capabilities expected in the role.', type: 'competencies', respondent: 'both', required: true, scored: true, weight: 60, evidenceRequired: false, questions: [] },
    {
      id: 'achievements', title: 'Achievements and challenges', description: 'Capture impact, obstacles, and lessons from the period.', type: 'achievements', respondent: 'employee', required: true, scored: false, weight: 0, evidenceRequired: false,
      questions: [
        { id: 'achievement_impact', prompt: 'What outcomes are you most proud of, and what changed because of your work?', helpText: '', responseType: 'long_text', required: true, options: [], ratingMin: 1, ratingMax: 5 },
        { id: 'challenge_response', prompt: 'What was your most important challenge, and how did you respond?', helpText: '', responseType: 'long_text', required: true, options: [], ratingMin: 1, ratingMax: 5 }
      ]
    },
    {
      id: 'learning', title: 'Learning and application', description: 'Reflect on learning from training, projects, mentoring, or day-to-day work.', type: 'learning', respondent: 'employee', required: true, scored: false, weight: 0, evidenceRequired: false,
      questions: [
        { id: 'learning_gained', prompt: 'What did you learn during this review period?', helpText: '', responseType: 'long_text', required: true, options: [], ratingMin: 1, ratingMax: 5 },
        { id: 'learning_applied', prompt: 'How have you applied that learning in your work?', helpText: '', responseType: 'long_text', required: true, options: [], ratingMin: 1, ratingMax: 5 },
        { id: 'learning_evidence', prompt: 'What evidence or example demonstrates the difference it made?', helpText: '', responseType: 'long_text', required: false, options: [], ratingMin: 1, ratingMax: 5 }
      ]
    },
    {
      id: 'development', title: 'Development and next priorities', description: 'Agree the employee’s next development focus and support needed.', type: 'development', respondent: 'both', required: true, scored: false, weight: 0, evidenceRequired: false,
      questions: [
        { id: 'development_priority', prompt: 'What capability or experience should be developed next?', helpText: '', responseType: 'long_text', required: true, options: [], ratingMin: 1, ratingMax: 5 },
        { id: 'support_needed', prompt: 'What support, opportunity, or resource would help?', helpText: '', responseType: 'long_text', required: false, options: [], ratingMin: 1, ratingMax: 5 }
      ]
    }
  ]
};

const responseTypeLabels: Record<ResponseType, string> = {
  short_text: 'Short text', long_text: 'Long text', rating: 'Rating', number: 'Number', boolean: 'Yes / No', single_select: 'Single choice', multi_select: 'Multiple choice'
};

const sectionTypeLabels: Record<SectionType, string> = {
  goals: 'Goals', competencies: 'Competencies', achievements: 'Achievements', learning: 'Learning', development: 'Development', custom: 'Custom'
};

const stageLabels: Record<string, { label: string; description: string; locked?: boolean }> = {
  goalSetting: { label: 'Goal alignment', description: 'Use approved goals as evidence for the period.' },
  selfAssessment: { label: 'Employee assessment', description: 'The employee completes their part of the review.', locked: true },
  managerReview: { label: 'Manager assessment', description: 'The line manager reviews evidence and responds.', locked: true },
  discussion: { label: 'Performance discussion', description: 'Employee and manager record agreed outcomes.' },
  calibration: { label: 'Calibration', description: 'HR or leaders review rating consistency.' },
  finalReview: { label: 'Final result', description: 'An authorized reviewer confirms the outcome.', locked: true },
  acknowledgement: { label: 'Employee acknowledgement', description: 'The employee confirms they received the result.' }
};

function cloneDesign(design: CycleDesign): CycleDesign {
  return JSON.parse(JSON.stringify(design));
}

function newId(prefix: string) {
  const suffix = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : `${Date.now()}`;
  return `${prefix}_${suffix}`;
}

function newQuestion(): CycleQuestion {
  return { id: newId('question'), prompt: '', helpText: '', responseType: 'long_text', required: true, options: [], ratingMin: 1, ratingMax: 5 };
}

interface Props {
  design: CycleDesign;
  sourceTemplate?: { id: string; name: string; version: number };
  onChange: (design: CycleDesign) => void;
  onTemplateChange: (template: { id: string; name: string; version: number }) => void;
  canSaveTemplate: boolean;
  readOnly?: boolean;
}

export default function CycleDesignBuilder({ design, sourceTemplate, onChange, onTemplateChange, canSaveTemplate, readOnly = false }: Props) {
  const [templates, setTemplates] = useState<CycleTemplateSummary[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templateError, setTemplateError] = useState('');
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    setTemplateError('');
    try {
      const response = await api.get('/appraisals/cycle-templates');
      setTemplates(Array.isArray(response.data?.data) ? response.data.data : []);
    } catch (error: unknown) {
      setTemplateError((error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Templates could not be loaded. You can still customize this cycle.');
    } finally {
      setLoadingTemplates(false);
    }
  };

  useEffect(() => { loadTemplates(); }, []);

  const scoredWeight = useMemo(
    () => design.sections.filter((section) => section.scored).reduce((sum, section) => sum + Number(section.weight || 0), 0),
    [design.sections]
  );
  const designErrors = useMemo(() => validateCycleDesign(design), [design]);

  const patchSection = (index: number, patch: Partial<CycleSection>) => {
    const next = cloneDesign(design);
    next.sections[index] = { ...next.sections[index], ...patch };
    if (next.sections[index].type === 'goals') next.scoring.goalsWeight = Number(next.sections[index].weight || 0);
    if (next.sections[index].type === 'competencies') next.scoring.competenciesWeight = Number(next.sections[index].weight || 0);
    onChange(next);
  };

  const patchQuestion = (sectionIndex: number, questionIndex: number, patch: Partial<CycleQuestion>) => {
    const next = cloneDesign(design);
    next.sections[sectionIndex].questions[questionIndex] = { ...next.sections[sectionIndex].questions[questionIndex], ...patch };
    onChange(next);
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= design.sections.length) return;
    const next = cloneDesign(design);
    const [section] = next.sections.splice(index, 1);
    next.sections.splice(target, 0, section);
    onChange(next);
  };

  const applyTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    onChange(cloneDesign(template.design));
    onTemplateChange({ id: template.id, name: template.name, version: Number(template.version || 1) });
  };

  const saveAsTemplate = async () => {
    setTemplateError('');
    setSavingTemplate(true);
    try {
      const response = await api.post('/appraisals/cycle-templates', {
        name: templateName,
        description: templateDescription,
        category: 'custom',
        design
      });
      const created = response.data?.data;
      setSaveTemplateOpen(false);
      setTemplateName('');
      setTemplateDescription('');
      await loadTemplates();
      if (created?._id) onTemplateChange({ id: created._id, name: created.name, version: created.version || 1 });
    } catch (error: unknown) {
      setTemplateError((error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Template could not be saved.');
    } finally {
      setSavingTemplate(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6">Review design</Typography>
        <Typography variant="body2" color="text.secondary">
          Choose a starting template, then change the stages, sections, questions, evidence, and scoring for this cycle. Learning reflections do not require an LMS connection.
        </Typography>
      </Box>

      {templateError && <Alert severity="warning">{templateError}</Alert>}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 300 }} disabled={loadingTemplates || readOnly}>
          <InputLabel id="cycle-template-label">Starting template</InputLabel>
          <Select labelId="cycle-template-label" id="cycle-template" value={templates.some((template) => template.id === sourceTemplate?.id) ? sourceTemplate?.id : ''} label="Starting template" onChange={(event) => applyTemplate(event.target.value)}>
            {templates.map((template) => (
              <MenuItem key={template.id} value={template.id}>{template.name}{template.system ? '' : ' · Organization'}</MenuItem>
            ))}
          </Select>
        </FormControl>
        {canSaveTemplate && !readOnly && (
          <Button variant="outlined" startIcon={<SaveOutlined />} onClick={() => setSaveTemplateOpen(true)}>
            Save as reusable template
          </Button>
        )}
      </Stack>

      <Box>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>Workflow stages</Typography>
        <Stack divider={<Divider flexItem />} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 2 }}>
          {Object.entries(stageLabels).map(([key, stage]) => (
            <Box key={key} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 1.25 }}>
              <Box>
                <Typography variant="body2" fontWeight={600}>{stage.label}</Typography>
                <Typography variant="caption" color="text.secondary">{stage.description}</Typography>
              </Box>
              <Switch
                checked={design.stages?.[key]?.enabled !== false}
                disabled={readOnly || stage.locked}
                slotProps={{ input: { 'aria-label': `${stage.label} enabled` } }}
                onChange={(event) => onChange({
                  ...cloneDesign(design),
                  stages: { ...design.stages, [key]: { enabled: event.target.checked } }
                })}
              />
            </Box>
          ))}
        </Stack>
      </Box>

      <Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} gap={1} mb={1.5}>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>Assessment sections</Typography>
            <Typography variant="body2" color="text.secondary">Sections appear in this order. Only scored sections contribute to the final calculated rating.</Typography>
          </Box>
          <Chip
            label={`Scored weight ${scoredWeight}%`}
            color={Math.abs(scoredWeight - 100) < 0.01 ? 'success' : 'warning'}
            variant="outlined"
          />
        </Stack>
        {designErrors.length > 0 && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
              {designErrors.slice(0, 4).map((error) => <Typography component="li" variant="body2" key={error}>{error}</Typography>)}
            </Stack>
          </Alert>
        )}

        <Stack spacing={1.5}>
          {design.sections.map((section, sectionIndex) => {
            const protectedSection = ['goals', 'competencies'].includes(section.type);
            return (
              <Box key={section.id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 2 }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} mb={2}>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <IconButton size="small" aria-label={`Move ${section.title} up`} disabled={readOnly || sectionIndex === 0} onClick={() => moveSection(sectionIndex, -1)}><ArrowUpward fontSize="small" /></IconButton>
                    <IconButton size="small" aria-label={`Move ${section.title} down`} disabled={readOnly || sectionIndex === design.sections.length - 1} onClick={() => moveSection(sectionIndex, 1)}><ArrowDownward fontSize="small" /></IconButton>
                    <Typography variant="subtitle2">Section {sectionIndex + 1}</Typography>
                  </Stack>
                  {!protectedSection && (
                    <IconButton size="small" aria-label={`Remove ${section.title}`} disabled={readOnly} onClick={() => onChange({ ...cloneDesign(design), sections: design.sections.filter((_, index) => index !== sectionIndex) })}>
                      <DeleteOutline fontSize="small" />
                    </IconButton>
                  )}
                </Stack>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(220px, 1fr) 180px 180px' }, gap: 1.5 }}>
                  <TextField size="small" label="Section title" value={section.title} disabled={readOnly} onChange={(event) => patchSection(sectionIndex, { title: event.target.value })} />
                  <FormControl size="small">
                    <InputLabel id={`section-type-${section.id}-label`}>Section type</InputLabel>
                    <Select labelId={`section-type-${section.id}-label`} id={`section-type-${section.id}`} value={section.type} label="Section type" disabled={readOnly || protectedSection} onChange={(event) => patchSection(sectionIndex, { type: event.target.value as SectionType })}>
                      {Object.entries(sectionTypeLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl size="small">
                    <InputLabel id={`section-respondent-${section.id}-label`}>Who responds</InputLabel>
                    <Select labelId={`section-respondent-${section.id}-label`} id={`section-respondent-${section.id}`} value={section.respondent} label="Who responds" disabled={readOnly || protectedSection} onChange={(event) => patchSection(sectionIndex, { respondent: event.target.value as Respondent })}>
                      <MenuItem value="employee">Employee</MenuItem>
                      <MenuItem value="manager">Manager</MenuItem>
                      <MenuItem value="both">Employee and manager</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
                <TextField fullWidth multiline minRows={2} size="small" label="Instructions" value={section.description} disabled={readOnly} onChange={(event) => patchSection(sectionIndex, { description: event.target.value })} sx={{ mt: 1.5 }} />

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} mt={1}>
                  <FormControlLabel control={<Checkbox checked={section.required} disabled={readOnly || protectedSection} onChange={(event) => patchSection(sectionIndex, { required: event.target.checked })} />} label="Required section" />
                  <FormControlLabel control={<Checkbox checked={section.evidenceRequired} disabled={readOnly || protectedSection} onChange={(event) => patchSection(sectionIndex, { evidenceRequired: event.target.checked })} />} label="Evidence attachment required" />
                  <FormControlLabel control={<Checkbox checked={section.scored} disabled={readOnly || protectedSection} onChange={(event) => patchSection(sectionIndex, { scored: event.target.checked, weight: event.target.checked ? section.weight : 0 })} />} label="Contributes to rating" />
                  {section.scored && <TextField size="small" type="number" label="Weight %" value={section.weight} disabled={readOnly} inputProps={{ min: 0, max: 100 }} onChange={(event) => patchSection(sectionIndex, { weight: Math.max(0, Math.min(100, Number(event.target.value))) })} sx={{ width: 120 }} />}
                </Stack>

                {!protectedSection && (
                  <Box sx={{ mt: 2, pl: { xs: 0, md: 2 }, borderLeft: { md: '2px solid' }, borderColor: { md: 'divider' } }}>
                    <Typography variant="subtitle2" gutterBottom>Questions</Typography>
                    <Stack spacing={1.5}>
                      {section.questions.map((item, questionIndex) => (
                        <Box key={item.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(240px, 1fr) 170px auto' }, gap: 1, alignItems: 'start' }}>
                          <TextField size="small" label={`Question ${questionIndex + 1}`} value={item.prompt} disabled={readOnly} onChange={(event) => patchQuestion(sectionIndex, questionIndex, { prompt: event.target.value })} />
                          <FormControl size="small">
                            <InputLabel id={`question-type-${section.id}-${item.id}-label`}>Answer type</InputLabel>
                            <Select labelId={`question-type-${section.id}-${item.id}-label`} id={`question-type-${section.id}-${item.id}`} value={item.responseType} label="Answer type" disabled={readOnly} onChange={(event) => patchQuestion(sectionIndex, questionIndex, { responseType: event.target.value as ResponseType })}>
                              {Object.entries(responseTypeLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                            </Select>
                          </FormControl>
                          <Stack direction="row" alignItems="center">
                            <FormControlLabel control={<Checkbox size="small" checked={item.required} disabled={readOnly} onChange={(event) => patchQuestion(sectionIndex, questionIndex, { required: event.target.checked })} />} label="Required" />
                            <IconButton size="small" aria-label="Remove question" disabled={readOnly} onClick={() => patchSection(sectionIndex, { questions: section.questions.filter((_, index) => index !== questionIndex) })}><DeleteOutline fontSize="small" /></IconButton>
                          </Stack>
                          {['single_select', 'multi_select'].includes(item.responseType) && (
                            <TextField size="small" label="Choices (comma separated)" value={item.options.join(', ')} disabled={readOnly} onChange={(event) => patchQuestion(sectionIndex, questionIndex, { options: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} />
                          )}
                          {item.responseType === 'rating' && (
                            <Stack direction="row" spacing={1}>
                              <TextField size="small" type="number" label="Min" value={item.ratingMin} disabled={readOnly} onChange={(event) => patchQuestion(sectionIndex, questionIndex, { ratingMin: Number(event.target.value) })} />
                              <TextField size="small" type="number" label="Max" value={item.ratingMax} disabled={readOnly} onChange={(event) => patchQuestion(sectionIndex, questionIndex, { ratingMax: Number(event.target.value) })} />
                            </Stack>
                          )}
                        </Box>
                      ))}
                    </Stack>
                    <Button size="small" startIcon={<Add />} disabled={readOnly} onClick={() => patchSection(sectionIndex, { questions: [...section.questions, newQuestion()] })} sx={{ mt: 1 }}>
                      Add question
                    </Button>
                  </Box>
                )}
              </Box>
            );
          })}
        </Stack>

        <Button
          variant="outlined"
          startIcon={<Add />}
          disabled={readOnly}
          onClick={() => onChange({
            ...cloneDesign(design),
            sections: [...design.sections, {
              id: newId('section'), title: 'New section', description: '', type: 'custom', respondent: 'employee', required: true, scored: false, weight: 0, evidenceRequired: false, questions: [newQuestion()]
            }]
          })}
          sx={{ mt: 1.5 }}
        >
          Add section
        </Button>
      </Box>

      <Dialog open={saveTemplateOpen} onClose={() => setSaveTemplateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Save reusable cycle template</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField autoFocus label="Template name" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
            <TextField multiline minRows={3} label="Description" value={templateDescription} onChange={(event) => setTemplateDescription(event.target.value)} />
            <Typography variant="caption" color="text.secondary">The template is available only inside this organization. Existing launched appraisals are never changed.</Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveTemplateOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={savingTemplate || templateName.trim().length < 3 || designErrors.length > 0} onClick={saveAsTemplate}>Save template</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
