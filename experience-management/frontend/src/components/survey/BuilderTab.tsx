import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckSquare2, CircleDot, Copy, GripVertical, Hash, ListChecks, MessageSquareText, Minus, Plus, Star, Trash2, Upload, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Question, QuestionType, Survey } from '@/types';

const questionTypes: { type: QuestionType; label: string; icon: typeof CircleDot; defaults?: Partial<Question> }[] = [
  { type: 'single_choice', label: 'Single choice', icon: CircleDot, defaults: { options: ['Option 1', 'Option 2'] } },
  { type: 'multiple_choice', label: 'Multiple choice', icon: CheckSquare2, defaults: { options: ['Option 1', 'Option 2'] } },
  { type: 'dropdown', label: 'Dropdown', icon: CircleDot, defaults: { options: ['Option 1', 'Option 2'] } },
  { type: 'nps', label: 'NPS', icon: Hash }, { type: 'multi_nps', label: 'Multi NPS', icon: Hash, defaults: { options: ['Product', 'Service'] } }, { type: 'csat', label: 'CSAT', icon: Star }, { type: 'ces', label: 'Effort score', icon: Star },
  { type: 'rating', label: 'Rating', icon: Star }, { type: 'graphical_rating', label: 'Graphical rating', icon: Star }, { type: 'slider', label: 'Slider', icon: Minus },
  { type: 'short_text', label: 'Short text', icon: MessageSquareText }, { type: 'multi_text', label: 'Multiple textboxes', icon: MessageSquareText, defaults: { options: ['First item', 'Second item'] } }, { type: 'long_text', label: 'Long text', icon: MessageSquareText },
  { type: 'number', label: 'Number', icon: Hash }, { type: 'email', label: 'Email', icon: MessageSquareText },
  { type: 'ranking', label: 'Ranking', icon: ListChecks, defaults: { options: ['Option 1', 'Option 2', 'Option 3'] } },
  { type: 'matrix', label: 'Matrix', icon: ListChecks, defaults: { options: ['Item 1', 'Item 2'] } },
  { type: 'date', label: 'Date', icon: Hash }, { type: 'contact', label: 'Contact', icon: MessageSquareText },
  { type: 'file', label: 'File upload', icon: Upload }, { type: 'media', label: 'Audio / video', icon: Video },
  { type: 'statement', label: 'Statement', icon: MessageSquareText }
];

const newId = () => crypto.randomUUID();

function QuestionRow({ question, active, number, onSelect }: { question: Question; active: boolean; number: number; onSelect: () => void }) {
  return <button onClick={onSelect} className={cn('flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/30', active && 'bg-secondary/70')}>
    <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{number}. {question.title || 'Untitled question'}</div><div className="mt-1 text-xs text-muted-foreground">{question.type.replaceAll('_', ' ')} · Page {question.page}</div></div>{question.required && <span className="text-xs text-destructive">Required</span>}
  </button>;
}

export function BuilderTab({ survey, onChange }: { survey: Survey; onChange: (survey: Survey) => void }) {
  const questions = survey.questions || [];
  const [selectedId, setSelectedId] = useState(questions[0]?.id || '');
  const selected = questions.find((question) => question.id === selectedId) || questions[0];
  const pages = useMemo(() => Math.max(1, ...questions.map((question) => question.page || 1)), [questions]);
  function replace(next: Question[]) { onChange({ ...survey, questions: next.map((question, index) => ({ ...question, position: index })) }); }
  function add(type: QuestionType, defaults: Partial<Question> = {}) {
    const question: Question = { id: newId(), surveyId: survey.id, page: pages, position: questions.length, type, title: type === 'statement' ? 'Add information for respondents' : 'Untitled question', description: '', required: type !== 'statement', options: defaults.options || [], settings: defaults.settings || {}, logic: [] };
    replace([...questions, question]); setSelectedId(question.id);
  }
  function update(values: Partial<Question>) { if (!selected) return; replace(questions.map((question) => question.id === selected.id ? { ...question, ...values } : question)); }
  function remove() { if (!selected) return; const next = questions.filter((question) => question.id !== selected.id); replace(next); setSelectedId(next[0]?.id || ''); }
  function move(offset: number) { const index = questions.findIndex((question) => question.id === selected?.id); const target = index + offset; if (index < 0 || target < 0 || target >= questions.length) return; const next = [...questions]; [next[index], next[target]] = [next[target], next[index]]; replace(next); }
  function duplicate() { if (!selected) return; const copy = { ...selected, id: newId(), title: `${selected.title} (copy)` }; const index = questions.indexOf(selected); const next = [...questions]; next.splice(index + 1, 0, copy); replace(next); setSelectedId(copy.id); }
  function addOption() { update({ options: [...(selected?.options || []), `Option ${(selected?.options.length || 0) + 1}`] }); }
  function updateOption(index: number, value: string) { update({ options: selected!.options.map((option, optionIndex) => optionIndex === index ? value : option) }); }
  function addRule() {
    if (!selected) return;
    const source = questions.find((question) => question.id !== selected.id) || selected;
    update({ logic: [...(selected.logic || []), { action: 'show', sourceQuestionId: source.id, operator: 'equals', value: source.options?.[0] || '', targetQuestionId: undefined }] });
  }
  function updateRule(index: number, values: Partial<Question['logic'][number]>) { update({ logic: (selected?.logic || []).map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...values } : rule) }); }
  function removeRule(index: number) { update({ logic: (selected?.logic || []).filter((_, ruleIndex) => ruleIndex !== index) }); }
  return <div className="grid min-h-[620px] gap-5 xl:grid-cols-[220px_minmax(340px,1fr)_360px]">
    <Card className="h-fit"><CardHeader className="pb-3"><CardTitle>Question types</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-1 p-2 pt-0 xl:grid-cols-1">{questionTypes.map(({ type, label, icon: Icon, defaults }) => <button key={type} onClick={() => add(type, defaults)} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><Icon className="h-3.5 w-3.5" />{label}</button>)}</CardContent></Card>
    <Card className="overflow-hidden"><div className="flex h-12 items-center justify-between border-b px-4"><div className="text-sm font-semibold">Questions</div><Button size="sm" variant="outline" onClick={() => add('short_text')}><Plus />Add</Button></div>{questions.length ? questions.map((question, index) => <QuestionRow key={question.id} question={question} number={index + 1} active={question.id === selected?.id} onSelect={() => setSelectedId(question.id)} />) : <div className="grid min-h-80 place-items-center px-8 text-center"><div><MessageSquareText className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No questions yet</p><p className="mt-1 text-xs text-muted-foreground">Choose a type from the library to begin.</p></div></div>}</Card>
    <Card className="h-fit xl:sticky xl:top-24">{selected ? <><div className="flex h-12 items-center justify-between border-b px-4"><div className="text-sm font-semibold">Question settings</div><div className="flex"><Button size="icon" variant="ghost" onClick={() => move(-1)} aria-label="Move up"><ArrowUp /></Button><Button size="icon" variant="ghost" onClick={() => move(1)} aria-label="Move down"><ArrowDown /></Button><Button size="icon" variant="ghost" onClick={duplicate} aria-label="Duplicate"><Copy /></Button><Button size="icon" variant="ghost" onClick={remove} aria-label="Delete"><Trash2 /></Button></div></div><CardContent className="space-y-4 pt-5">
      <div><Label className="field-label">Question</Label><Textarea rows={3} value={selected.title} onChange={(event) => update({ title: event.target.value })} /></div>
      <div><Label className="field-label">Help text</Label><Textarea rows={2} value={selected.description} onChange={(event) => update({ description: event.target.value })} placeholder="Optional context for the respondent" /></div>
      <div className="grid grid-cols-2 gap-3"><div><Label className="field-label">Page</Label><Input type="number" min={1} value={selected.page} onChange={(event) => update({ page: Math.max(1, Number(event.target.value)) })} /></div><div><Label className="field-label">Type</Label><select className="h-9 w-full rounded-md border-input bg-background text-sm" value={selected.type} onChange={(event) => update({ type: event.target.value as QuestionType })}>{questionTypes.map((item) => <option value={item.type} key={item.type}>{item.label}</option>)}</select></div></div>
      {['single_choice', 'multiple_choice', 'dropdown', 'multi_nps', 'multi_text', 'ranking', 'matrix'].includes(selected.type) && <div><div className="mb-2 flex items-center justify-between"><Label>{['multi_nps', 'multi_text', 'matrix'].includes(selected.type) ? 'Items' : 'Options'}</Label><Button type="button" variant="ghost" size="sm" onClick={addOption}><Plus />Add</Button></div><div className="space-y-2">{selected.options.map((option, index) => <div className="flex gap-2" key={index}><Input value={option} onChange={(event) => updateOption(index, event.target.value)} /><Button type="button" variant="ghost" size="icon" aria-label={`Remove ${option}`} onClick={() => update({ options: selected.options.filter((_, optionIndex) => optionIndex !== index) })}><Trash2 /></Button></div>)}</div></div>}
      {['rating', 'graphical_rating', 'slider', 'csat', 'ces'].includes(selected.type) && <div className="grid grid-cols-2 gap-3"><div><Label className="field-label">Minimum</Label><Input type="number" value={selected.settings.min ?? 1} onChange={(event) => update({ settings: { ...selected.settings, min: Number(event.target.value) } })} /></div><div><Label className="field-label">Maximum</Label><Input type="number" value={selected.settings.max ?? (selected.type === 'ces' ? 7 : 5)} onChange={(event) => update({ settings: { ...selected.settings, max: Number(event.target.value) } })} /></div></div>}
      <div className="border-t pt-4"><div className="flex items-center justify-between"><div><Label>Logic</Label><p className="mt-1 text-xs text-muted-foreground">Show, hide, branch, or open a recovery case from an answer.</p></div><Button type="button" variant="outline" size="sm" onClick={addRule} disabled={!questions.length}><Plus />Rule</Button></div>
        {(selected.logic || []).length > 0 && <div className="mt-3 space-y-3">{selected.logic.map((rule, index) => <div className="space-y-2 border p-3" key={`${rule.sourceQuestionId}-${index}`}>
          <div className="flex items-center gap-2"><select aria-label={`Rule ${index + 1} action`} className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs" value={rule.action} onChange={(event) => updateRule(index, { action: event.target.value as typeof rule.action })}><option value="show">Show this question</option><option value="hide">Hide this question</option><option value="skip_to">Skip to question</option><option value="create_ticket">Create recovery case</option></select><Button type="button" variant="ghost" size="icon" aria-label={`Remove rule ${index + 1}`} onClick={() => removeRule(index)}><Trash2 /></Button></div>
          <select aria-label={`Rule ${index + 1} source question`} className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs" value={rule.sourceQuestionId} onChange={(event) => updateRule(index, { sourceQuestionId: event.target.value })}>{questions.map((question, questionIndex) => <option value={question.id} key={question.id}>{questionIndex + 1}. {question.title}</option>)}</select>
          <div className="grid grid-cols-[140px_1fr] gap-2"><select aria-label={`Rule ${index + 1} operator`} className="h-9 rounded-md border border-input bg-background px-2 text-xs" value={rule.operator} onChange={(event) => updateRule(index, { operator: event.target.value })}><option value="equals">Equals</option><option value="not_equals">Does not equal</option><option value="contains">Contains</option><option value="less_than">Less than</option><option value="greater_than">Greater than</option></select><Input aria-label={`Rule ${index + 1} value`} value={rule.value} onChange={(event) => updateRule(index, { value: event.target.value })} placeholder="Expected answer" /></div>
          {rule.action === 'skip_to' && <select aria-label={`Rule ${index + 1} target question`} className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs" value={rule.targetQuestionId || ''} onChange={(event) => updateRule(index, { targetQuestionId: event.target.value })}><option value="">Choose destination</option>{questions.filter((question) => question.id !== selected.id).map((question, questionIndex) => <option value={question.id} key={question.id}>{questionIndex + 1}. {question.title}</option>)}</select>}
        </div>)}</div>}
      </div>
      <label className="flex items-center gap-3 border-t pt-4 text-sm"><input type="checkbox" className="rounded border-input text-primary focus:ring-primary" checked={selected.required} disabled={selected.type === 'statement'} onChange={(event) => update({ required: event.target.checked })} /><span><span className="font-medium">Required response</span><span className="block text-xs text-muted-foreground">Respondents must answer before continuing.</span></span></label>
    </CardContent></> : <CardContent className="py-12 text-center text-sm text-muted-foreground">Select a question to edit it.</CardContent>}</Card>
  </div>;
}
