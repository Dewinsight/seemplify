import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Check, PenLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { publicDocumentContentUrl } from '@/lib/esign';
import type { ESignDocument, ESignField, ESignSignatureValue } from '@/types';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function fieldComplete(field: ESignField) {
  if (!field.required) return true;
  if (field.hasValue === true) return true;
  if (field.type === 'checkbox') return field.value === true;
  if (typeof field.value === 'object' && field.value) return Boolean((field.value as ESignSignatureValue).value || (field.value as ESignSignatureValue).dataUrl);
  if (Array.isArray(field.value)) return field.value.length > 0;
  return String(field.value ?? '').trim().length > 0;
}

function SigningField({ field, onLocalChange, onSave, onAdoptSignature }: {
  field: ESignField; onLocalChange: (value: ESignField['value']) => void; onSave: (value: ESignField['value']) => void; onAdoptSignature: () => void;
}) {
  const style = { left: `${field.x * 100}%`, top: `${field.y * 100}%`, width: `${field.width * 100}%`, height: `${field.height * 100}%` };
  const complete = fieldComplete(field);
  const base = cn('absolute z-10 min-h-7 overflow-hidden border-2 bg-[#edf3ee] text-[11px] text-foreground focus-within:ring-2 focus-within:ring-ring', complete ? 'border-[#557260]' : 'border-[#a7634d]');
  if (['signature', 'initials'].includes(field.type)) {
    const signature = typeof field.value === 'object' && field.value ? field.value as ESignSignatureValue : null;
    return <button type="button" data-sign-field-id={field.id} style={style} className={cn(base, 'flex items-center justify-center gap-1.5 px-2 font-semibold')} onClick={onAdoptSignature} aria-label={`${field.label || field.type}${field.required ? ', required' : ''}`}><PenLine className="h-3.5 w-3.5 shrink-0" />{signature ? signature.mode === 'typed' ? signature.value : <><Check className="h-3.5 w-3.5" />Added</> : field.label || (field.type === 'signature' ? 'Sign here' : 'Initial here')}</button>;
  }
  if (field.type === 'checkbox') return <label data-sign-field-id={field.id} style={style} className={cn(base, 'grid place-items-center')}><span className="sr-only">{field.label}{field.required ? ', required' : ''}</span><input type="checkbox" className="h-4 w-4 rounded border-input text-primary focus:ring-primary" checked={field.value === true} onChange={(event) => { onLocalChange(event.target.checked); onSave(event.target.checked); }} /></label>;
  if (field.type === 'radio') return <fieldset data-sign-field-id={field.id} style={style} className={cn(base, 'flex items-center gap-1 px-1')} aria-label={field.label}>{field.options.map((option) => <label className="flex min-w-0 items-center gap-0.5" key={option}><input type="radio" name={field.id} value={option} checked={field.value === option} onChange={() => { onLocalChange(option); onSave(option); }} /><span className="truncate">{option}</span></label>)}</fieldset>;
  if (field.type === 'dropdown') return <select data-sign-field-id={field.id} style={style} className={cn(base, 'px-1')} aria-label={`${field.label}${field.required ? ', required' : ''}`} value={String(field.value ?? '')} onChange={(event) => { onLocalChange(event.target.value); onSave(event.target.value); }}><option value="">Choose</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select>;
  const readOnly = ['name', 'email', 'date_signed'].includes(field.type);
  return <input data-sign-field-id={field.id} style={style} className={cn(base, 'px-1.5')} aria-label={`${field.label || field.type.replaceAll('_', ' ')}${field.required ? ', required' : ''}`} value={String(field.value ?? '')} placeholder={field.placeholder || field.label} readOnly={readOnly} onChange={(event) => onLocalChange(event.target.value)} onBlur={(event) => { if (!readOnly) onSave(event.target.value); }} />;
}

function ResponsiveSigningPage({ page, fields, onLocalChange, onSave, onAdoptSignature }: {
  page: PDFPageProxy; fields: ESignField[]; onLocalChange: (id: string, value: ESignField['value']) => void;
  onSave: (id: string, value: ESignField['value']) => void; onAdoptSignature: (field: ESignField) => void;
}) {
  const holderRef = useRef<HTMLDivElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null); const [availableWidth, setAvailableWidth] = useState(760); const [nearViewport, setNearViewport] = useState(false);
  useEffect(() => { const element = holderRef.current; if (!element) return; const observer = new ResizeObserver(([entry]) => setAvailableWidth(Math.max(280, entry.contentRect.width))); observer.observe(element); return () => observer.disconnect(); }, []);
  useEffect(() => { const element = holderRef.current; if (!element) return; const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setNearViewport(true); observer.disconnect(); } }, { rootMargin: '1000px 0px' }); observer.observe(element); return () => observer.disconnect(); }, []);
  const viewport = useMemo(() => { const base = page.getViewport({ scale: 1 }); return page.getViewport({ scale: Math.min(1.35, (availableWidth - 2) / base.width) }); }, [availableWidth, page]);
  useEffect(() => { const canvas = canvasRef.current; if (!canvas || !nearViewport) return; const outputScale = Math.min(window.devicePixelRatio || 1, 2); canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale); canvas.style.width = `${Math.floor(viewport.width)}px`; canvas.style.height = `${Math.floor(viewport.height)}px`; const task = page.render({ canvas, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] }); return () => task.cancel(); }, [nearViewport, page, viewport]);
  return <section ref={holderRef} aria-label={`Page ${page.pageNumber}`} className="w-full"><div className="relative mx-auto w-fit max-w-full bg-white shadow-panel"><canvas ref={canvasRef} style={{ width: Math.floor(viewport.width), height: Math.floor(viewport.height) }} aria-label={`Agreement page ${page.pageNumber}`} />{fields.map((field) => <SigningField key={field.id} field={field} onLocalChange={(value) => onLocalChange(field.id, value)} onSave={(value) => onSave(field.id, value)} onAdoptSignature={() => onAdoptSignature(field)} />)}</div><div className="mx-auto mt-2 max-w-[760px] text-right text-xs text-muted-foreground">Page {page.pageNumber}</div></section>;
}

export function SigningDocument({ document, fields, onLocalChange, onSave, onAdoptSignature }: {
  document: ESignDocument; fields: ESignField[]; onLocalChange: (id: string, value: ESignField['value']) => void;
  onSave: (id: string, value: ESignField['value']) => void; onAdoptSignature: (field: ESignField) => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null); const [pages, setPages] = useState<PDFPageProxy[]>([]); const [error, setError] = useState('');
  useEffect(() => { let cancelled = false; const task = getDocument({ url: publicDocumentContentUrl(document.id), withCredentials: true }); task.promise.then(async (next) => { if (cancelled) return; setPdf(next); const loaded = await Promise.all(Array.from({ length: next.numPages }, (_, index) => next.getPage(index + 1))); if (!cancelled) setPages(loaded); }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'This document could not be opened.'); }); return () => { cancelled = true; void task.destroy(); }; }, [document.id]);
  if (error) return <div className="border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>;
  if (!pdf || !pages.length) return <div className="h-[70vh] animate-pulse bg-muted" />;
  return <section className="space-y-6" aria-label={document.name}><div className="mx-auto max-w-[760px] border-b pb-2 text-sm font-medium">{document.name}</div>{pages.map((page) => <ResponsiveSigningPage key={page.pageNumber} page={page} fields={fields.filter((field) => field.page === page.pageNumber)} onLocalChange={onLocalChange} onSave={onSave} onAdoptSignature={onAdoptSignature} />)}</section>;
}

export function SignatureCanvas({ onChange }: { onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null); const drawing = useRef(false); const hasInk = useRef(false); const previous = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { const canvas = canvasRef.current; if (!canvas) return; const ratio = Math.min(window.devicePixelRatio || 1, 2); const rect = canvas.getBoundingClientRect(); canvas.width = Math.floor(rect.width * ratio); canvas.height = Math.floor(rect.height * ratio); const context = canvas.getContext('2d'); if (context) { context.scale(ratio, ratio); context.lineCap = 'round'; context.lineJoin = 'round'; context.lineWidth = 2; context.strokeStyle = '#1f2822'; } }, []);
  function point(event: ReactPointerEvent<HTMLCanvasElement>) { const rect = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  function start(event: ReactPointerEvent<HTMLCanvasElement>) { event.currentTarget.setPointerCapture(event.pointerId); drawing.current = true; previous.current = point(event); }
  function move(event: ReactPointerEvent<HTMLCanvasElement>) { if (!drawing.current || !previous.current) return; const next = point(event); if (Math.abs(next.x - previous.current.x) + Math.abs(next.y - previous.current.y) < 1) return; const context = event.currentTarget.getContext('2d'); if (context) { context.beginPath(); context.moveTo(previous.current.x, previous.current.y); context.lineTo(next.x, next.y); context.stroke(); hasInk.current = true; } previous.current = next; }
  function finish(event: ReactPointerEvent<HTMLCanvasElement>) { if (!drawing.current) return; drawing.current = false; previous.current = null; if (hasInk.current) onChange(event.currentTarget.toDataURL('image/png')); }
  return <div><canvas ref={canvasRef} className="h-44 w-full touch-none border bg-white" aria-label="Draw signature" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} /><button type="button" className="mt-2 text-xs font-medium text-muted-foreground underline hover:text-foreground" onClick={() => { const canvas = canvasRef.current; if (!canvas) return; canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); hasInk.current = false; onChange(''); }}>Clear drawing</button></div>;
}
