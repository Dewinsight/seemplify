import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { CheckSquare2, ChevronDown, CircleDot, FileText, GripVertical, Mail, PenLine, TextCursorInput, Trash2, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { adminDocumentContentUrl, esignFieldDefinitions, newField, recipientLabel } from '@/lib/esign';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ESignDocument, ESignField, ESignFieldType, ESignRecipient } from '@/types';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type DragData = { kind: 'new-field'; type: ESignFieldType } | { kind: 'field'; fieldId: string };
const recipientColors = [
  { border: '#496a58', background: '#e7efe9' }, { border: '#826b38', background: '#f4eedf' },
  { border: '#73536e', background: '#f1e8ef' }, { border: '#3f6871', background: '#e5eff1' },
  { border: '#76534a', background: '#f2e8e4' }, { border: '#5f627e', background: '#e9eaf2' }
];

function fieldIcon(type: ESignFieldType) {
  if (type === 'signature' || type === 'initials') return PenLine;
  if (type === 'checkbox') return CheckSquare2;
  if (type === 'radio') return CircleDot;
  if (type === 'dropdown') return ChevronDown;
  if (type === 'name') return UserRound;
  if (type === 'email') return Mail;
  return TextCursorInput;
}

function PageDropZone({ documentId, page, children, className, onPlace }: { documentId: string; page: number; children: ReactNode; className?: string; onPlace: (event: ReactMouseEvent<HTMLDivElement>) => void }) {
  const { isOver, setNodeRef } = useDroppable({ id: `esign-page:${documentId}:${page}`, data: { documentId, page } });
  return <div ref={setNodeRef} data-page-number={page} className={cn('relative bg-white shadow-panel', isOver && 'ring-2 ring-primary/60', className)} onClick={onPlace}>{children}</div>;
}

function FieldOverlay({ field, recipient, selected, color, onSelect }: { field: ESignField; recipient?: ESignRecipient; selected: boolean; color: { border: string; background: string }; onSelect: () => void }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, isDragging } = useDraggable({ id: `esign-field:${field.id}`, data: { kind: 'field', fieldId: field.id } satisfies DragData });
  const Icon = fieldIcon(field.type);
  const style: CSSProperties = {
    left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.width * 100}%`, height: `${field.height * 100}%`,
    borderColor: color.border, background: color.background, transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.35 : 1
  };
  return <button type="button" style={style} onClick={(event) => { event.stopPropagation(); onSelect(); }} className={cn('absolute z-10 flex min-h-7 min-w-7 cursor-grab items-center gap-1.5 overflow-hidden border-2 px-1.5 text-left text-[11px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing', selected && 'ring-2 ring-foreground/50')} ref={(node) => { setNodeRef(node); setActivatorNodeRef(node); }} {...attributes} {...listeners} aria-label={`${field.label || field.type.replaceAll('_', ' ')} for ${recipient ? recipientLabel(recipient) : 'unassigned recipient'}`} aria-pressed={selected}>
    <Icon className="h-3 w-3 shrink-0" /><span className="truncate">{field.label || field.type.replaceAll('_', ' ')}</span>{field.required && <span className="ml-auto" aria-label="Required">*</span>}
  </button>;
}

function PdfPageCanvas({ page, zoom, fields, recipients, selectedId, recipientColor, onSelect, onPlace }: {
  page: PDFPageProxy; zoom: number; fields: ESignField[]; recipients: ESignRecipient[]; selectedId: string;
  recipientColor: (recipientId: string) => { border: string; background: string }; onSelect: (id: string) => void;
  onPlace: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const viewport = useMemo(() => page.getViewport({ scale: zoom }), [page, zoom]);
  useEffect(() => { const canvas = canvasRef.current; if (!canvas) return; const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setNearViewport(true); observer.disconnect(); } }, { rootMargin: '1000px 0px' }); observer.observe(canvas); return () => observer.disconnect(); }, []);
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || !nearViewport) return;
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`; canvas.style.height = `${Math.floor(viewport.height)}px`;
    const task = page.render({ canvas, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
    return () => { task.cancel(); };
  }, [nearViewport, page, viewport]);
  return <PageDropZone documentId={(page as any).__documentId} page={page.pageNumber} onPlace={onPlace} className="mx-auto" ><canvas ref={canvasRef} style={{ width: Math.floor(viewport.width), height: Math.floor(viewport.height) }} aria-label={`Document page ${page.pageNumber}`} /><div className="absolute inset-0" aria-label={`Fields on page ${page.pageNumber}`}>{fields.map((field) => <FieldOverlay key={field.id} field={field} recipient={recipients.find((item) => item.id === field.recipientId)} selected={selectedId === field.id} color={recipientColor(field.recipientId)} onSelect={() => onSelect(field.id)} />)}</div></PageDropZone>;
}

function PdfDocumentPages({ envelopeId, document, zoom, fields, recipients, selectedId, recipientColor, onSelect, onPlace }: {
  envelopeId: string; document: ESignDocument; zoom: number; fields: ESignField[]; recipients: ESignRecipient[]; selectedId: string;
  recipientColor: (recipientId: string) => { border: string; background: string }; onSelect: (id: string) => void;
  onPlace: (documentId: string, page: number, event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null); const [pages, setPages] = useState<PDFPageProxy[]>([]); const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false; const task = getDocument({ url: adminDocumentContentUrl(envelopeId, document.id), withCredentials: true });
    task.promise.then(async (next) => {
      if (cancelled) return; setPdf(next);
      const loaded = await Promise.all(Array.from({ length: next.numPages }, (_, index) => next.getPage(index + 1)));
      for (const page of loaded) (page as any).__documentId = document.id;
      if (!cancelled) setPages(loaded);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'The PDF could not be rendered.'); });
    return () => { cancelled = true; void task.destroy(); };
  }, [document.id, envelopeId]);
  if (error) return <div className="mx-auto max-w-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{document.name}: {error}</div>;
  if (!pdf || !pages.length) return <div className="mx-auto h-[700px] w-[560px] max-w-full animate-pulse bg-muted" />;
  return <section aria-label={document.name} className="space-y-6"><div className="mx-auto flex max-w-[760px] items-center gap-2 border-b pb-2 text-xs text-muted-foreground"><FileText className="h-3.5 w-3.5" />{document.name} / {pages.length} page{pages.length === 1 ? '' : 's'}</div>{pages.map((page) => <PdfPageCanvas key={page.pageNumber} page={page} zoom={zoom} fields={fields.filter((field) => field.page === page.pageNumber)} recipients={recipients} selectedId={selectedId} recipientColor={recipientColor} onSelect={onSelect} onPlace={(event) => onPlace(document.id, page.pageNumber, event)} />)}</section>;
}

function PaletteItem({ type, label, active, onChoose }: { type: ESignFieldType; label: string; active: boolean; onChoose: () => void }) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, isDragging } = useDraggable({ id: `esign-new:${type}`, data: { kind: 'new-field', type } satisfies DragData });
  const Icon = fieldIcon(type);
  return <div ref={setNodeRef} className={cn('flex items-center border-b last:border-b-0', active && 'bg-accent', isDragging && 'opacity-40')}><button type="button" className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-xs font-medium hover:bg-muted/40" onClick={onChoose}><Icon className="h-3.5 w-3.5 text-muted-foreground" /><span>{label}</span></button><button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag ${label} onto a document page`} className="mr-1 grid h-8 w-8 cursor-grab place-items-center text-muted-foreground hover:text-foreground active:cursor-grabbing"><GripVertical className="h-3.5 w-3.5" /></button></div>;
}

export function PdfAgreementEditor({ envelopeId, documents, recipients, fields, onChange, selectedId, onSelectedIdChange, zoom }: {
  envelopeId: string; documents: ESignDocument[]; recipients: ESignRecipient[]; fields: ESignField[]; onChange: (fields: ESignField[]) => void;
  selectedId: string; onSelectedIdChange: (id: string) => void; zoom: number;
}) {
  const signingRecipients = recipients.filter((recipient) => ['signer', 'approver'].includes(recipient.role));
  const [recipientId, setRecipientId] = useState(signingRecipients[0]?.id || ''); const [placementType, setPlacementType] = useState<ESignFieldType | null>(null); const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  useEffect(() => { if (!signingRecipients.some((item) => item.id === recipientId)) setRecipientId(signingRecipients[0]?.id || ''); }, [recipientId, signingRecipients]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  function recipientColor(id: string) { const index = Math.max(0, signingRecipients.findIndex((item) => item.id === id)); return recipientColors[index % recipientColors.length]; }
  function place(type: ESignFieldType, documentId: string, page: number, x: number, y: number) {
    if (!recipientId) return;
    const field = newField({ envelopeId, documentId, recipientId, type, page, x: Math.max(0, Math.min(0.94, x)), y: Math.max(0, Math.min(0.94, y)) });
    field.x = Math.min(field.x, 1 - field.width); field.y = Math.min(field.y, 1 - field.height);
    onChange([...fields, field]); onSelectedIdChange(field.id); setPlacementType(null);
  }
  function pageClick(documentId: string, page: number, event: ReactMouseEvent<HTMLDivElement>) {
    if (!placementType || !recipientId) return;
    const bounds = event.currentTarget.getBoundingClientRect(); place(placementType, documentId, page, (event.clientX - bounds.left) / bounds.width - 0.04, (event.clientY - bounds.top) / bounds.height - 0.02);
  }
  function dragEnd(event: DragEndEvent) {
    const drag = event.active.data.current as DragData | undefined; const target = event.over?.data.current as { documentId?: string; page?: number } | undefined; setActiveDrag(null);
    if (!drag || !target?.documentId || !target.page || !event.over) return;
    const rect = event.active.rect.current.translated || event.active.rect.current.initial; if (!rect) return;
    const x = (rect.left - event.over.rect.left) / event.over.rect.width; const y = (rect.top - event.over.rect.top) / event.over.rect.height;
    if (drag.kind === 'new-field') return place(drag.type, target.documentId, target.page, x, y);
    onChange(fields.map((field) => field.id === drag.fieldId ? { ...field, documentId: target.documentId!, page: target.page!, x: Math.max(0, Math.min(1 - field.width, x)), y: Math.max(0, Math.min(1 - field.height, y)) } : field)); onSelectedIdChange(drag.fieldId);
  }
  return <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={(event: DragStartEvent) => setActiveDrag(event.active.data.current as DragData)} onDragCancel={() => setActiveDrag(null)} onDragEnd={dragEnd}>
    <div className="grid min-h-0 flex-1 md:grid-cols-[210px_minmax(0,1fr)]">
      <aside className="border-b bg-card md:border-b-0 md:border-r"><div className="border-b p-3"><Label className="field-label" htmlFor="field-recipient">Assign new fields to</Label><select id="field-recipient" className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs" value={recipientId} onChange={(event) => setRecipientId(event.target.value)}><option value="">Choose recipient</option>{signingRecipients.map((recipient, index) => <option value={recipient.id} key={recipient.id}>{index + 1}. {recipientLabel(recipient)}</option>)}</select></div><div className="grid grid-cols-2 md:block">{esignFieldDefinitions.map((definition) => <PaletteItem key={definition.type} {...definition} active={placementType === definition.type} onChoose={() => setPlacementType((current) => current === definition.type ? null : definition.type)} />)}</div><p className="border-t p-3 text-xs leading-5 text-muted-foreground">Drag a field onto a page, or select one and then tap its position.</p></aside>
      <div className={cn('min-w-0 overflow-auto bg-muted/45 px-4 py-6 sm:px-8', placementType && 'cursor-crosshair')} data-testid="pdf-editor-canvas"><div className="space-y-10">{documents.map((document) => <PdfDocumentPages key={document.id} envelopeId={envelopeId} document={document} zoom={zoom} fields={fields.filter((field) => field.documentId === document.id)} recipients={recipients} selectedId={selectedId} recipientColor={recipientColor} onSelect={onSelectedIdChange} onPlace={pageClick} />)}</div></div>
    </div>
    <DragOverlay>{activeDrag ? <div className="flex items-center gap-2 border bg-card px-3 py-2 text-xs font-semibold shadow-panel"><GripVertical className="h-3.5 w-3.5" />{activeDrag.kind === 'new-field' ? esignFieldDefinitions.find((item) => item.type === activeDrag.type)?.label : fields.find((item) => item.id === activeDrag.fieldId)?.label}</div> : null}</DragOverlay>
  </DndContext>;
}

export function FieldProperties({ field, recipients, onChange, onDelete }: { field?: ESignField; recipients: ESignRecipient[]; onChange: (field: ESignField) => void; onDelete: () => void }) {
  if (!field) return <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l bg-card p-5 xl:block"><div className="text-sm font-semibold">Field properties</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Select a field on the document to edit its assignment, size and validation.</p></aside>;
  const selectedField = field;
  function change(values: Partial<ESignField>) { onChange({ ...selectedField, ...values }); }
  return <aside className="w-full shrink-0 overflow-y-auto border-t bg-card p-4 xl:w-[300px] xl:border-l xl:border-t-0 xl:p-5"><div className="flex items-center justify-between"><div className="text-sm font-semibold">Field properties</div><Button variant="ghost" size="icon" aria-label="Delete selected field" onClick={onDelete}><Trash2 /></Button></div><div className="mt-4 space-y-4">
    <div><Label className="field-label" htmlFor="field-label">Label</Label><Input id="field-label" value={field.label} onChange={(event) => change({ label: event.target.value })} /></div>
    <div><Label className="field-label" htmlFor="field-assignee">Recipient</Label><select id="field-assignee" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={field.recipientId} onChange={(event) => change({ recipientId: event.target.value })}>{recipients.filter((item) => ['signer', 'approver'].includes(item.role)).map((recipient) => <option value={recipient.id} key={recipient.id}>{recipientLabel(recipient)}</option>)}</select></div>
    {['text', 'dropdown'].includes(field.type) && <div><Label className="field-label" htmlFor="field-placeholder">Placeholder</Label><Input id="field-placeholder" value={field.placeholder} onChange={(event) => change({ placeholder: event.target.value })} /></div>}
    {['radio', 'dropdown'].includes(field.type) && <div><Label className="field-label" htmlFor="field-options">Options</Label><textarea id="field-options" className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={field.options.join('\n')} onChange={(event) => change({ options: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} /></div>}
    <div className="grid grid-cols-2 gap-3"><div><Label className="field-label" htmlFor="field-width">Width</Label><Input id="field-width" type="number" min={4} max={100} value={Math.round(field.width * 100)} onChange={(event) => change({ width: Math.min(1 - field.x, Math.max(0.04, Number(event.target.value) / 100)) })} /></div><div><Label className="field-label" htmlFor="field-height">Height</Label><Input id="field-height" type="number" min={3} max={100} value={Math.round(field.height * 100)} onChange={(event) => change({ height: Math.min(1 - field.y, Math.max(0.03, Number(event.target.value) / 100)) })} /></div></div>
    <div><Label className="field-label">Position</Label><div className="grid grid-cols-2 gap-2"><Button variant="outline" size="sm" aria-label="Move selected field left" onClick={() => change({ x: Math.max(0, field.x - 0.01) })}>Left</Button><Button variant="outline" size="sm" aria-label="Move selected field up" onClick={() => change({ y: Math.max(0, field.y - 0.01) })}>Up</Button><Button variant="outline" size="sm" aria-label="Move selected field right" onClick={() => change({ x: Math.min(1 - field.width, field.x + 0.01) })}>Right</Button><Button variant="outline" size="sm" aria-label="Move selected field down" onClick={() => change({ y: Math.min(1 - field.height, field.y + 0.01) })}>Down</Button></div></div>
    <label className="flex items-start gap-3 border-t pt-4 text-sm"><input type="checkbox" className="mt-1 rounded border-input text-primary focus:ring-primary" checked={field.required} onChange={(event) => change({ required: event.target.checked })} /><span><span className="font-medium">Required field</span><span className="mt-1 block text-xs text-muted-foreground">The recipient cannot finish until it is complete.</span></span></label>
  </div></aside>;
}
