import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type CollisionDetection
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, Check, CheckSquare2, CircleDot, Copy, GripVertical, Hash, ListChecks, MessageSquareText, Minus, Plus, Star, Trash2, Upload, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Question, QuestionType, Survey } from '@/types';

type QuestionTypeDefinition = { type: QuestionType; label: string; icon: typeof CircleDot; defaults?: Partial<Question> };
type DragData =
  | { kind: 'question'; questionId: string }
  | { kind: 'question-type'; type: QuestionType; defaults?: Partial<Question> };

const QUESTION_LIST_DROP_ID = 'survey-question-list';

const questionTypes: QuestionTypeDefinition[] = [
  { type: 'single_choice', label: 'Single choice', icon: CircleDot, defaults: { options: ['Option 1', 'Option 2'] } },
  { type: 'multiple_choice', label: 'Multiple choice', icon: CheckSquare2, defaults: { options: ['Option 1', 'Option 2'] } },
  { type: 'dropdown', label: 'Dropdown', icon: CircleDot, defaults: { options: ['Option 1', 'Option 2'] } },
  { type: 'nps', label: 'NPS', icon: Hash },
  { type: 'multi_nps', label: 'Multi NPS', icon: Hash, defaults: { options: ['Product', 'Service'] } },
  { type: 'csat', label: 'CSAT', icon: Star },
  { type: 'ces', label: 'Effort score', icon: Star },
  { type: 'rating', label: 'Rating', icon: Star },
  { type: 'graphical_rating', label: 'Graphical rating', icon: Star },
  { type: 'slider', label: 'Slider', icon: Minus },
  { type: 'short_text', label: 'Short text', icon: MessageSquareText },
  { type: 'multi_text', label: 'Multiple textboxes', icon: MessageSquareText, defaults: { options: ['First item', 'Second item'] } },
  { type: 'long_text', label: 'Long text', icon: MessageSquareText },
  { type: 'number', label: 'Number', icon: Hash },
  { type: 'email', label: 'Email', icon: MessageSquareText },
  { type: 'ranking', label: 'Ranking', icon: ListChecks, defaults: { options: ['Option 1', 'Option 2', 'Option 3'] } },
  { type: 'matrix', label: 'Matrix', icon: ListChecks, defaults: { options: ['Item 1', 'Item 2'] } },
  { type: 'date', label: 'Date', icon: Hash },
  { type: 'contact', label: 'Contact', icon: MessageSquareText },
  { type: 'file', label: 'File upload', icon: Upload },
  { type: 'media', label: 'Audio / video', icon: Video },
  { type: 'statement', label: 'Statement', icon: MessageSquareText }
];

const newId = () => crypto.randomUUID();

function QuestionTypeItem({ definition, onAdd }: { definition: QuestionTypeDefinition; onAdd: () => void }) {
  const { attributes, isDragging, listeners, setActivatorNodeRef, setNodeRef } = useDraggable({
    id: `question-type:${definition.type}`,
    data: { kind: 'question-type', type: definition.type, defaults: definition.defaults } satisfies DragData
  });
  const Icon = definition.icon;
  return <div ref={setNodeRef} className={cn('group flex min-w-0 items-center rounded-md transition-colors hover:bg-muted', isDragging && 'opacity-35')}>
    <button type="button" onClick={onAdd} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground" aria-label={`Add ${definition.label} question`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{definition.label}</span>
    </button>
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      className="mr-1 grid h-7 w-7 shrink-0 cursor-grab place-items-center rounded-sm text-muted-foreground opacity-50 transition-colors hover:bg-background hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      aria-label={`Drag ${definition.label} into the question list`}
      title={`Drag ${definition.label} into the question list`}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  </div>;
}

function SortableQuestionRow({ question, active, number, typeDropTarget, onSelect }: { question: Question; active: boolean; number: number; typeDropTarget: boolean; onSelect: () => void }) {
  const { attributes, isDragging, listeners, setActivatorNodeRef, setNodeRef, transform, transition } = useSortable({
    id: question.id,
    data: { kind: 'question', questionId: question.id } satisfies DragData
  });
  return <li
    ref={setNodeRef}
    style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
    className={cn(
      'relative flex min-w-0 items-stretch border-b bg-card transition-colors last:border-b-0 hover:bg-muted/30',
      active && 'bg-accent shadow-[inset_3px_0_0_hsl(var(--primary))] hover:bg-accent',
      typeDropTarget && 'before:absolute before:inset-x-3 before:top-0 before:z-10 before:h-0.5 before:bg-primary'
    )}
    data-selected={active ? 'true' : 'false'}
  >
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'grid w-10 shrink-0 cursor-grab place-items-center text-muted-foreground transition-colors hover:text-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing',
        active && 'text-primary'
      )}
      aria-label={`Reorder question ${number}: ${question.title || 'Untitled question'}`}
      title="Drag to reorder. Keyboard: Space, arrow keys, Space."
    >
      <GripVertical className="h-4 w-4" />
    </button>
    <button
      type="button"
      onClick={onSelect}
      className="flex min-w-0 flex-1 items-start gap-3 px-1 py-3 pr-4 text-left focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      aria-pressed={active}
      aria-controls="selected-question-settings"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{number}. {question.title || 'Untitled question'}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{question.type.replaceAll('_', ' ')} · Page {question.page}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {question.required && <span className="text-xs text-destructive">Required</span>}
        {active && <span className="inline-flex items-center gap-1 text-xs font-medium text-primary"><Check className="h-3.5 w-3.5" />Selected</span>}
      </span>
    </button>
  </li>;
}

function DragPreview({ drag, questions }: { drag: DragData; questions: Question[] }) {
  if (drag.kind === 'question-type') {
    const definition = questionTypes.find((item) => item.type === drag.type);
    if (!definition) return null;
    const Icon = definition.icon;
    return <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs font-medium shadow-panel"><Icon className="h-3.5 w-3.5 text-muted-foreground" />{definition.label}</div>;
  }
  const question = questions.find((item) => item.id === drag.questionId);
  if (!question) return null;
  return <div className="flex max-w-sm items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium shadow-panel"><GripVertical className="h-4 w-4 text-primary" /><span className="truncate">{question.title || 'Untitled question'}</span></div>;
}

function QuestionDropZone({ children, className }: { children: ReactNode; className?: string }) {
  const { setNodeRef } = useDroppable({ id: QUESTION_LIST_DROP_ID, data: { kind: 'question-list' } });
  return <div ref={setNodeRef} className={className} aria-label="Question drop zone">{children}</div>;
}

export function BuilderTab({ survey, onChange }: { survey: Survey; onChange: (survey: Survey) => void }) {
  const questions = survey.questions || [];
  const [selectedId, setSelectedId] = useState(questions[0]?.id || '');
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const selected = questions.find((question) => question.id === selectedId) || questions[0];
  const selectedIndex = selected ? questions.findIndex((question) => question.id === selected.id) : -1;
  const pages = useMemo(() => Math.max(1, ...questions.map((question) => question.page || 1)), [questions]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const collisionDetection: CollisionDetection = (args) => {
    const drag = args.active.data.current as DragData | undefined;
    if (drag?.kind !== 'question-type') return closestCenter(args);
    const collisions = pointerWithin(args);
    const questionCollision = collisions.find((collision) => questions.some((question) => question.id === collision.id));
    if (questionCollision) return [questionCollision];
    return collisions.length ? collisions : closestCenter(args);
  };

  useEffect(() => {
    if (!questions.length) {
      if (selectedId) setSelectedId('');
      return;
    }
    if (!questions.some((question) => question.id === selectedId)) setSelectedId(questions[0].id);
  }, [questions, selectedId]);

  function replace(next: Question[]) {
    onChange({ ...survey, questions: next.map((question, index) => ({ ...question, position: index })) });
  }

  function add(type: QuestionType, defaults: Partial<Question> = {}, insertionIndex = questions.length, page = pages) {
    const question: Question = {
      id: newId(), surveyId: survey.id, page, position: insertionIndex, type,
      title: type === 'statement' ? 'Add information for respondents' : 'Untitled question',
      description: '', required: type !== 'statement', options: defaults.options || [], settings: defaults.settings || {}, logic: []
    };
    const next = [...questions];
    next.splice(insertionIndex, 0, question);
    replace(next);
    setSelectedId(question.id);
  }

  function update(values: Partial<Question>) {
    if (!selected) return;
    replace(questions.map((question) => question.id === selected.id ? { ...question, ...values } : question));
  }

  function remove() {
    if (!selected) return;
    const index = questions.findIndex((question) => question.id === selected.id);
    const next = questions.filter((question) => question.id !== selected.id);
    replace(next);
    setSelectedId(next[Math.min(index, next.length - 1)]?.id || '');
  }

  function move(offset: number) {
    const index = questions.findIndex((question) => question.id === selected?.id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= questions.length) return;
    const destinationPage = questions[target].page;
    const next = [...questions];
    [next[index], next[target]] = [next[target], { ...next[index], page: destinationPage }];
    replace(next);
  }

  function duplicate() {
    if (!selected) return;
    const copy = { ...selected, id: newId(), title: `${selected.title} (copy)` };
    const index = questions.indexOf(selected);
    const next = [...questions];
    next.splice(index + 1, 0, copy);
    replace(next);
    setSelectedId(copy.id);
  }

  function handleDragStart(event: DragStartEvent) {
    const drag = event.active.data.current as DragData | undefined;
    if (drag) setActiveDrag(drag);
  }

  function handleDragOver(event: DragOverEvent) {
    setOverId(event.over ? String(event.over.id) : null);
  }

  function resetDragState() {
    setActiveDrag(null);
    setOverId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const drag = event.active.data.current as DragData | undefined;
    const targetId = event.over ? String(event.over.id) : null;
    resetDragState();
    if (!drag || !targetId) return;

    if (drag.kind === 'question') {
      const from = questions.findIndex((question) => question.id === drag.questionId);
      const to = targetId === QUESTION_LIST_DROP_ID ? questions.length - 1 : questions.findIndex((question) => question.id === targetId);
      if (from < 0 || to < 0 || from === to) return;
      const destinationPage = questions[to].page;
      const next = arrayMove(questions, from, to);
      next[to] = { ...next[to], page: destinationPage };
      replace(next);
      setSelectedId(drag.questionId);
      return;
    }

    const insertionIndex = targetId === QUESTION_LIST_DROP_ID ? questions.length : questions.findIndex((question) => question.id === targetId);
    if (insertionIndex < 0) return;
    const page = questions[insertionIndex]?.page || questions[insertionIndex - 1]?.page || pages;
    add(drag.type, drag.defaults, insertionIndex, page);
  }

  function addOption() { update({ options: [...(selected?.options || []), `Option ${(selected?.options.length || 0) + 1}`] }); }
  function updateOption(index: number, value: string) { update({ options: selected!.options.map((option, optionIndex) => optionIndex === index ? value : option) }); }
  function addRule() {
    if (!selected) return;
    const source = questions.find((question) => question.id !== selected.id) || selected;
    update({ logic: [...(selected.logic || []), { action: 'show', sourceQuestionId: source.id, operator: 'equals', value: source.options?.[0] || '', targetQuestionId: undefined }] });
  }
  function updateRule(index: number, values: Partial<Question['logic'][number]>) { update({ logic: (selected?.logic || []).map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...values } : rule) }); }
  function removeRule(index: number) { update({ logic: (selected?.logic || []).filter((_, ruleIndex) => ruleIndex !== index) }); }

  const draggingTypeOverList = activeDrag?.kind === 'question-type' && Boolean(overId && (overId === QUESTION_LIST_DROP_ID || questions.some((question) => question.id === overId)));

  return <DndContext
    sensors={sensors}
    collisionDetection={collisionDetection}
    onDragStart={handleDragStart}
    onDragOver={handleDragOver}
    onDragCancel={resetDragState}
    onDragEnd={handleDragEnd}
  >
    <div className="grid min-h-[620px] gap-5 xl:grid-cols-[220px_minmax(340px,1fr)_360px]">
      <Card className="h-fit">
        <CardHeader className="pb-3"><CardTitle>Question types</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-1 p-2 pt-0 xl:grid-cols-1">
          {questionTypes.map((definition) => <QuestionTypeItem key={definition.type} definition={definition} onAdd={() => add(definition.type, definition.defaults)} />)}
        </CardContent>
      </Card>

      <Card className={cn('overflow-hidden transition-colors', draggingTypeOverList && 'border-primary ring-1 ring-primary/20')}>
        <div className="flex h-12 items-center justify-between border-b px-4"><div className="text-sm font-semibold">Questions</div><Button size="sm" variant="outline" onClick={() => add('short_text')}><Plus />Add</Button></div>
        <QuestionDropZone className={cn('min-h-80', !questions.length && 'grid place-items-center')}>
          {questions.length ? <SortableContext items={questions.map((question) => question.id)} strategy={verticalListSortingStrategy}>
            <ol aria-label="Survey questions">
              {questions.map((question, index) => <SortableQuestionRow
                key={question.id}
                question={question}
                number={index + 1}
                active={question.id === selected?.id}
                typeDropTarget={activeDrag?.kind === 'question-type' && overId === question.id}
                onSelect={() => setSelectedId(question.id)}
              />)}
            </ol>
          </SortableContext> : <div className={cn('px-8 text-center', draggingTypeOverList && 'text-primary')}>
            <MessageSquareText className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">{draggingTypeOverList ? 'Drop to add this question' : 'No questions yet'}</p>
            <p className="mt-1 text-xs text-muted-foreground">Choose a type or drag one here to begin.</p>
          </div>}
        </QuestionDropZone>
      </Card>

      <Card id="selected-question-settings" className="h-fit xl:sticky xl:top-24">
        {selected ? <>
          <div className="flex h-12 items-center justify-between border-b px-4">
            <div className="text-sm font-semibold">Question {selectedIndex + 1} settings</div>
            <div className="flex"><Button size="icon" variant="ghost" onClick={() => move(-1)} aria-label="Move up" disabled={selectedIndex <= 0}><ArrowUp /></Button><Button size="icon" variant="ghost" onClick={() => move(1)} aria-label="Move down" disabled={selectedIndex < 0 || selectedIndex >= questions.length - 1}><ArrowDown /></Button><Button size="icon" variant="ghost" onClick={duplicate} aria-label="Duplicate"><Copy /></Button><Button size="icon" variant="ghost" onClick={remove} aria-label="Delete"><Trash2 /></Button></div>
          </div>
          <CardContent className="space-y-4 pt-5">
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
          </CardContent>
        </> : <CardContent className="py-12 text-center text-sm text-muted-foreground">Select a question to edit it.</CardContent>}
      </Card>
    </div>
    <DragOverlay>{activeDrag ? <DragPreview drag={activeDrag} questions={questions} /> : null}</DragOverlay>
  </DndContext>;
}
