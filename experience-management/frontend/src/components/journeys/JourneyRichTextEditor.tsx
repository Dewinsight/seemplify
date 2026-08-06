import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Bold, Code2, Italic, Link2, List, ListOrdered, Plus, Quote, Trash2, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type {
  JourneyRichTextBlock, JourneyRichTextBlockType, JourneyRichTextDocument, JourneyRichTextMark,
  JourneyRichTextMarkType
} from '@/lib/journeyRichCards';

const blockLabels: Record<JourneyRichTextBlockType, string> = {
  paragraph: 'Paragraph', heading: 'Heading', bullet: 'Bulleted item', ordered: 'Numbered item', quote: 'Quote'
};

const blockIcons: Record<JourneyRichTextBlockType, typeof Type> = {
  paragraph: Type, heading: Type, bullet: List, ordered: ListOrdered, quote: Quote
};

type Selection = { blockIndex: number; start: number; end: number };

function normalizeMarksAfterTextChange(marks: JourneyRichTextMark[], before: string, after: string) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  const removedEnd = before.length - suffix;
  const insertedEnd = after.length - suffix;
  const delta = insertedEnd - removedEnd;
  return marks.flatMap((mark) => {
    let start = mark.start;
    let end = mark.end;
    if (end <= prefix) return [mark];
    if (start >= removedEnd) return [{ ...mark, start: start + delta, end: end + delta }];
    start = Math.min(start, prefix);
    end = Math.max(prefix, end + delta);
    start = Math.max(0, Math.min(start, after.length));
    end = Math.max(start, Math.min(end, after.length));
    return end > start ? [{ ...mark, start, end }] : [];
  });
}

function toggleMark(block: JourneyRichTextBlock, selection: Selection, type: JourneyRichTextMarkType, href?: string) {
  if (selection.start === selection.end) return block;
  const matching = block.marks.find((mark) => mark.type === type
    && mark.start === selection.start && mark.end === selection.end
    && (type !== 'link' || mark.href === href));
  const existing = type === 'link' ? block.marks.filter((mark) => mark.type !== 'link'
    || mark.end <= selection.start || mark.start >= selection.end) : block.marks;
  const marks = matching
    ? block.marks.filter((mark) => mark !== matching)
    : [...existing, { type, start: selection.start, end: selection.end, ...(type === 'link' ? { href } : {}) }];
  return { ...block, marks };
}

function applyMark(mark: JourneyRichTextMark, content: ReactNode, key: string) {
  if (mark.type === 'bold') return <strong key={key}>{content}</strong>;
  if (mark.type === 'italic') return <em key={key}>{content}</em>;
  if (mark.type === 'code') return <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.92em]">{content}</code>;
  if (mark.type === 'link' && mark.href) {
    return <a key={key} href={mark.href} target="_blank" rel="noopener noreferrer"
      className="underline underline-offset-2">{content}</a>;
  }
  return <Fragment key={key}>{content}</Fragment>;
}

function MarkedText({ block }: { block: JourneyRichTextBlock }) {
  const boundaries = useMemo(() => [...new Set([
    0, block.text.length,
    ...block.marks.flatMap((mark) => [mark.start, mark.end])
  ])].filter((value) => value >= 0 && value <= block.text.length).sort((a, b) => a - b), [block]);
  return <>{boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    let node: ReactNode = block.text.slice(start, end);
    const active = block.marks.filter((mark) => mark.start <= start && mark.end >= end)
      .sort((left, right) => left.type.localeCompare(right.type));
    for (const [markIndex, mark] of active.entries()) node = applyMark(mark, node, `${index}-${markIndex}`);
    return <Fragment key={`${start}-${end}`}>{node}</Fragment>;
  })}</>;
}

export function JourneyRichTextDocumentView({ document, empty = 'No rich details recorded.' }: {
  document: JourneyRichTextDocument;
  empty?: string;
}) {
  if (!document.blocks.some((block) => block.text.trim())) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return <div className="space-y-2 text-sm leading-6" data-testid="journey-rich-text-view">
    {document.blocks.map((block, index) => {
      const content = <MarkedText block={block} />;
      if (block.type === 'heading') return <h4 key={index} className="font-semibold">{content}</h4>;
      if (block.type === 'quote') return <blockquote key={index} className="border-l-2 pl-3 text-muted-foreground">{content}</blockquote>;
      if (block.type === 'bullet') return <ul key={index} className="list-disc pl-5"><li>{content}</li></ul>;
      if (block.type === 'ordered') return <ol key={index} className="list-decimal pl-5" start={index + 1}><li>{content}</li></ol>;
      return <p key={index} className="whitespace-pre-wrap">{content}</p>;
    })}
  </div>;
}

export function JourneyRichTextEditor({ value, onChange, disabled = false, blockLimit = 40, blockCharacterLimit = 2_000 }: {
  value: JourneyRichTextDocument;
  onChange: (next: JourneyRichTextDocument) => void;
  disabled?: boolean;
  blockLimit?: number;
  blockCharacterLimit?: number;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const textareas = useRef<Array<HTMLTextAreaElement | null>>([]);

  const updateBlock = (index: number, next: JourneyRichTextBlock) => {
    onChange({ ...value, blocks: value.blocks.map((block, blockIndex) => blockIndex === index ? next : block) });
  };
  const mark = (index: number, type: JourneyRichTextMarkType) => {
    const selected = selection?.blockIndex === index ? selection : null;
    if (!selected || selected.start === selected.end) return;
    let href: string | undefined;
    if (type === 'link') {
      const entered = window.prompt('Link URL (HTTPS only)');
      if (!entered) return;
      href = entered.trim();
    }
    updateBlock(index, toggleMark(value.blocks[index], selected, type, href));
    window.requestAnimationFrame(() => {
      const textarea = textareas.current[index];
      textarea?.focus(); textarea?.setSelectionRange(selected.start, selected.end);
    });
  };
  const addBlock = () => {
    if (value.blocks.length >= blockLimit) return;
    onChange({ ...value, blocks: [...value.blocks, { type: 'paragraph', text: '', marks: [] }] });
  };

  return <div className="space-y-3" data-testid="journey-rich-text-editor">
    {value.blocks.length === 0 && <p className="border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
      Add a block to record structured detail.
    </p>}
    {value.blocks.map((block, index) => {
      const Icon = blockIcons[block.type];
      const selected = selection?.blockIndex === index && selection.start !== selection.end;
      return <div key={index} className="border bg-background" data-testid={`journey-rich-block-${index}`}>
        <div className="flex flex-wrap items-center gap-1 border-b bg-muted/20 px-2 py-1.5">
          <Icon className="mr-1 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <Label htmlFor={`journey-rich-block-type-${index}`} className="sr-only">Block type</Label>
          <select id={`journey-rich-block-type-${index}`} className="h-8 border bg-background px-2 text-xs"
            value={block.type} disabled={disabled}
            onChange={(event) => updateBlock(index, { ...block, type: event.target.value as JourneyRichTextBlockType })}>
            {Object.entries(blockLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
          </select>
          <span className="mx-1 h-5 border-l" aria-hidden="true" />
          {([['bold', Bold, 'Bold'], ['italic', Italic, 'Italic'], ['code', Code2, 'Code'], ['link', Link2, 'Link']] as const)
            .map(([type, MarkIcon, label]) => <Button key={type} type="button" size="sm" variant="ghost" className="h-8 px-2"
              aria-label={`${label} selected text in block ${index + 1}`} disabled={disabled || !selected}
              onMouseDown={(event) => event.preventDefault()} onClick={() => mark(index, type)}>
              <MarkIcon className="h-3.5 w-3.5" />
            </Button>)}
          <span className="flex-1" />
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2" aria-label={`Move block ${index + 1} up`}
            disabled={disabled || index === 0} onClick={() => {
              const blocks = [...value.blocks]; [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]];
              onChange({ ...value, blocks });
            }}><ArrowUp className="h-3.5 w-3.5" /></Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2" aria-label={`Move block ${index + 1} down`}
            disabled={disabled || index === value.blocks.length - 1} onClick={() => {
              const blocks = [...value.blocks]; [blocks[index], blocks[index + 1]] = [blocks[index + 1], blocks[index]];
              onChange({ ...value, blocks });
            }}><ArrowDown className="h-3.5 w-3.5" /></Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 px-2" aria-label={`Delete block ${index + 1}`}
            disabled={disabled} onClick={() => onChange({ ...value, blocks: value.blocks.filter((_, blockIndex) => blockIndex !== index) })}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Label htmlFor={`journey-rich-block-text-${index}`} className="sr-only">{blockLabels[block.type]} text</Label>
        <Textarea id={`journey-rich-block-text-${index}`} ref={(element) => { textareas.current[index] = element; }}
          className="min-h-24 resize-y border-0 focus-visible:ring-0" value={block.text} disabled={disabled}
          maxLength={blockCharacterLimit}
          onSelect={(event) => setSelection({ blockIndex: index, start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
          onChange={(event) => updateBlock(index, { ...block, text: event.target.value,
            marks: normalizeMarksAfterTextChange(block.marks, block.text, event.target.value) })} />
        <p className="border-t px-2 py-1 text-right text-[11px] text-muted-foreground">
          {block.text.length.toLocaleString()} / {blockCharacterLimit.toLocaleString()}
        </p>
      </div>;
    })}
    <Button type="button" size="sm" variant="outline" disabled={disabled || value.blocks.length >= blockLimit} onClick={addBlock}>
      <Plus className="mr-2 h-3.5 w-3.5" />Add block <span className="ml-2 text-xs text-muted-foreground">
        {value.blocks.length}/{blockLimit}</span>
    </Button>
  </div>;
}
