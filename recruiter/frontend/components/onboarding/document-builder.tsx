"use client";

import { useMemo, useState, type CSSProperties, type DragEvent } from "react";
import {
  AlignLeft,
  Check,
  Copy,
  FileText,
  GripVertical,
  Heading2,
  Image,
  ListPlus,
  Plus,
  Save,
  Signature,
  Table2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BuilderBlock, OnboardingDocument } from "@/services/onboardingService";

type BlockType = BuilderBlock["type"];
type SettingsMode = "block" | "document";

interface DocumentSettings {
  pageSize: "letter" | "a4" | "legal";
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  textColor: string;
  backgroundColor: string;
  accentColor: string;
  marginX: number;
  marginY: number;
}

interface DocumentBuilderProps {
  initialDocument?: Partial<OnboardingDocument>;
  saving?: boolean;
  onSave: (data: {
    title: string;
    description?: string;
    builderBlocks: BuilderBlock[];
    variables: Record<string, any>;
  }) => Promise<void> | void;
}

const blockOptions: Array<{ type: BlockType; label: string; icon: any }> = [
  { type: "logo", label: "Logo", icon: Image },
  { type: "heading", label: "Heading", icon: Heading2 },
  { type: "text", label: "Text", icon: AlignLeft },
  { type: "section", label: "Section", icon: FileText },
  { type: "table", label: "Table", icon: Table2 },
  { type: "signature", label: "Signature", icon: Signature },
  { type: "spacer", label: "Spacer", icon: ListPlus },
  { type: "pageBreak", label: "Page break", icon: ListPlus },
];

const variables = [
  "{{candidate.name}}",
  "{{candidate.firstName}}",
  "{{candidate.position}}",
  "{{organization.name}}",
  "{{recruiter.name}}",
  "{{today}}",
];

const documentDefaults: DocumentSettings = {
  pageSize: "letter",
  fontFamily: "Inter, Arial, sans-serif",
  fontSize: 14,
  lineHeight: 1.6,
  textColor: "#1f2937",
  backgroundColor: "#ffffff",
  accentColor: "#2563eb",
  marginX: 40,
  marginY: 48,
};

const pageSizes: Record<DocumentSettings["pageSize"], { label: string; width: number; height: number }> = {
  letter: { label: "Letter", width: 780, height: 1009 },
  a4: { label: "A4", width: 760, height: 1075 },
  legal: { label: "Legal", width: 780, height: 1285 },
};

const fontOptions = [
  { label: "Inter", value: "Inter, Arial, sans-serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times", value: "'Times New Roman', Times, serif" },
];

const alignOptions = ["left", "center", "right"] as const;
const weightOptions = [
  { label: "Normal", value: "normal" },
  { label: "Medium", value: "500" },
  { label: "Semibold", value: "600" },
  { label: "Bold", value: "bold" },
];

const BLOCK_ID_MIME = "application/x-seemplify-builder-block-id";
const BLOCK_TYPE_MIME = "application/x-seemplify-builder-block-type";

function isBlockType(value: string): value is BlockType {
  return blockOptions.some((option) => option.type === value);
}

function makeBlock(type: BlockType): BuilderBlock {
  const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (type === "heading") return { id, type, content: { text: "Document heading" } };
  if (type === "section") return { id, type, content: { title: "Section title", text: "Section content" } };
  if (type === "table") return { id, type, content: { rows: [["Label", "Value"], ["Candidate", "{{candidate.name}}"]] } };
  if (type === "signature") return { id, type, content: { label: "Signature" } };
  if (type === "logo") return { id, type, content: { text: "{{organization.name}}", alt: "Company logo", width: 160, height: 64 } };
  if (type === "spacer") return { id, type, content: { height: 48 } };
  if (type === "pageBreak") return { id, type, content: {} };
  return { id, type, content: { text: "Write your document text here." } };
}

function defaultBlocks(title: string): BuilderBlock[] {
  return [
    { id: "heading-default", type: "heading", content: { text: title || "Onboarding document" } },
    {
      id: "intro-default",
      type: "text",
      content: { text: "Hello {{candidate.firstName}},\n\nPlease review this onboarding document from {{organization.name}}." },
    },
    { id: "signature-default", type: "signature", content: { label: "Signature" } },
  ];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function getInitialDocumentSettings(initialDocument?: Partial<OnboardingDocument>): DocumentSettings {
  const saved = (initialDocument?.variables as any)?.documentStyle || {};
  return {
    ...documentDefaults,
    ...saved,
    pageSize: pageSizes[saved.pageSize as DocumentSettings["pageSize"]] ? saved.pageSize : documentDefaults.pageSize,
    fontSize: clampNumber(Number(saved.fontSize ?? documentDefaults.fontSize), 9, 28),
    lineHeight: clampNumber(Number(saved.lineHeight ?? documentDefaults.lineHeight), 1, 2.4),
    marginX: clampNumber(Number(saved.marginX ?? documentDefaults.marginX), 16, 96),
    marginY: clampNumber(Number(saved.marginY ?? documentDefaults.marginY), 16, 120),
  };
}

function getBlockStyle(block: BuilderBlock, fallback: CSSProperties = {}): CSSProperties {
  const style = block.style || {};
  const borderWidth = clampNumber(Number(style.borderWidth || 0), 0, 8);
  return {
    ...fallback,
    color: style.color || fallback.color,
    backgroundColor: style.backgroundColor || fallback.backgroundColor,
    fontSize: style.fontSize ? `${clampNumber(Number(style.fontSize), 8, 48)}px` : fallback.fontSize,
    fontWeight: style.fontWeight || fallback.fontWeight,
    lineHeight: style.lineHeight ? clampNumber(Number(style.lineHeight), 1, 2.4) : fallback.lineHeight,
    textAlign: style.align || fallback.textAlign,
    padding: style.padding !== undefined ? `${clampNumber(Number(style.padding), 0, 48)}px` : fallback.padding,
    border: borderWidth ? `${borderWidth}px solid ${style.borderColor || "#e2e8f0"}` : fallback.border,
    borderRadius: style.borderRadius !== undefined ? `${clampNumber(Number(style.borderRadius), 0, 32)}px` : fallback.borderRadius,
  } as CSSProperties;
}

function blockDimension(block: BuilderBlock, key: "width" | "height", fallback: number, min: number, max: number) {
  return clampNumber(Number(block.content?.[key] ?? fallback), min, max);
}

function hasEditableTextContent(block: BuilderBlock) {
  return !["logo", "signature", "spacer", "table", "pageBreak"].includes(block.type);
}

function PreviewBlock({ block }: { block: BuilderBlock }) {
  if (block.type === "pageBreak") {
    return <div className="my-5 border-t border-dashed pt-3 text-xs uppercase tracking-wide" style={getBlockStyle(block, { borderColor: "#cbd5e1", color: "#94a3b8" })}>Page break</div>;
  }
  if (block.type === "spacer") {
    const height = blockDimension(block, "height", 48, 8, 600);
    return (
      <div
        className="relative border border-dashed border-slate-200 bg-slate-50/70"
        style={{ ...getBlockStyle(block), height }}
      >
        <span className="absolute left-2 top-1 text-[10px] font-medium text-slate-400">{height}px spacer</span>
      </div>
    );
  }
  if (block.type === "heading") {
    return <h2 className="text-2xl font-semibold" style={getBlockStyle(block, { color: "#020617", fontWeight: 600 })}>{block.content?.text || "Heading"}</h2>;
  }
  if (block.type === "section") {
    return (
      <section className="space-y-2 border-l-2 pl-4" style={getBlockStyle(block, { borderColor: "#e2e8f0" })}>
        <h3 className="text-base font-semibold">{block.content?.title || "Section"}</h3>
        <p className="whitespace-pre-wrap text-sm leading-6">{block.content?.text || ""}</p>
      </section>
    );
  }
  if (block.type === "table") {
    const rows = Array.isArray(block.content?.rows) ? block.content.rows : [];
    return (
      <table className="w-full border-collapse text-sm" style={getBlockStyle(block)}>
        <tbody>
          {rows.map((row: string[], index: number) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border border-slate-200 px-3 py-2">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (block.type === "signature") {
    return (
      <div className="space-y-2 pt-4" style={getBlockStyle(block)}>
        <div className="h-12 w-72 border-b border-slate-500" />
        <p className="text-xs">{block.content?.label || "Signature"}</p>
      </div>
    );
  }
  if (block.type === "logo") {
    const logoSrc = block.content?.src || block.content?.url;
    const width = blockDimension(block, "width", 160, 32, 420);
    const height = blockDimension(block, "height", 64, 24, 240);
    if (logoSrc) {
      return (
        <img
          src={logoSrc}
          alt={block.content?.alt || "Company logo"}
          className="block max-w-full object-contain"
          style={{ ...getBlockStyle(block), width, height }}
        />
      );
    }
    return (
      <div
        className="inline-flex items-center border border-slate-200 px-4 text-sm font-semibold"
        style={{ ...getBlockStyle(block, { color: "#334155" }), width, height }}
      >
        {block.content?.text || "Logo"}
      </div>
    );
  }
  return <p className="whitespace-pre-wrap text-sm leading-6" style={getBlockStyle(block, { color: "#334155" })}>{block.content?.text || ""}</p>;
}

function InsertBlockControl({
  index,
  active,
  isDropTarget,
  selectedType,
  onClick,
  onDragOver,
  onDrop,
  onMouseEnter,
  onMouseLeave,
}: {
  index: number;
  active: boolean;
  isDropTarget: boolean;
  selectedType: BlockType | null;
  onClick: (index: number) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, index: number) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, index: number) => void;
  onMouseEnter: (index: number) => void;
  onMouseLeave: () => void;
}) {
  const selectedOption = selectedType ? blockOptions.find((option) => option.type === selectedType) : null;
  const SelectedIcon = selectedOption?.icon || Plus;

  return (
    <div
      onDragOver={(event) => onDragOver(event, index)}
      onDrop={(event) => onDrop(event, index)}
      onMouseEnter={() => onMouseEnter(index)}
      onMouseLeave={onMouseLeave}
      className={`flex justify-center rounded-md transition ${
        active
          ? `border border-dashed px-2 py-2 ${isDropTarget ? "border-blue-500 bg-blue-50 shadow-sm" : "border-slate-200 bg-slate-50/70"}`
          : "h-3 border border-transparent"
      }`}
    >
      {active && (
        <button
          type="button"
          onClick={() => onClick(index)}
          className={`flex h-9 w-full items-center justify-center gap-2 rounded-md border text-xs font-medium transition ${
            isDropTarget ? "border-blue-500 bg-white text-blue-700" : "border-transparent bg-white/80 text-slate-500 hover:border-blue-300 hover:text-blue-700"
          }`}
        >
          <SelectedIcon className="h-3.5 w-3.5" />
          Drop here
        </button>
      )}
    </div>
  );
}

export function DocumentBuilder({ initialDocument, saving = false, onSave }: DocumentBuilderProps) {
  const [title, setTitle] = useState(initialDocument?.title || "New onboarding document");
  const [description, setDescription] = useState(initialDocument?.description || "");
  const [blocks, setBlocks] = useState<BuilderBlock[]>(
    initialDocument?.builderBlocks?.length ? initialDocument.builderBlocks : defaultBlocks(initialDocument?.title || "New onboarding document")
  );
  const [activeBlockId, setActiveBlockId] = useState(blocks[0]?.id || "");
  const [settingsMode, setSettingsMode] = useState<SettingsMode>("block");
  const [documentSettings, setDocumentSettings] = useState<DocumentSettings>(() => getInitialDocumentSettings(initialDocument));
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [isPaletteDragging, setIsPaletteDragging] = useState(false);
  const [selectedPaletteType, setSelectedPaletteType] = useState<BlockType | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [hoverDropIndex, setHoverDropIndex] = useState<number | null>(null);
  const [copiedVariable, setCopiedVariable] = useState<string | null>(null);

  const activeBlock = useMemo(() => blocks.find((block) => block.id === activeBlockId) || blocks[0], [activeBlockId, blocks]);
  const activePlacementType = isPaletteDragging ? null : selectedPaletteType;
  const isPlacementActive = Boolean(draggedBlockId || isPaletteDragging || selectedPaletteType);

  const updateBlock = (blockId: string, updater: (block: BuilderBlock) => BuilderBlock) => {
    setBlocks((current) => current.map((block) => (block.id === blockId ? updater(block) : block)));
  };

  const updateBlockStyle = (blockId: string, patch: Record<string, any>) => {
    updateBlock(blockId, (block) => ({
      ...block,
      style: Object.entries(patch).reduce(
        (nextStyle, [key, value]) => {
          if (value === undefined || value === null || value === "") {
            delete nextStyle[key];
          } else {
            nextStyle[key] = value;
          }
          return nextStyle;
        },
        { ...(block.style || {}) } as Record<string, any>
      ),
    }));
  };

  const resetBlockStyle = (blockId: string) => {
    updateBlock(blockId, (block) => ({ ...block, style: {} }));
  };

  const updateDocumentSettings = (patch: Partial<DocumentSettings>) => {
    setDocumentSettings((current) => ({ ...current, ...patch }));
  };

  const moveBlock = (blockId: string, direction: -1 | 1) => {
    setBlocks((current) => {
      const index = current.findIndex((block) => block.id === blockId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const insertBlock = (type: BlockType, index = blocks.length) => {
    const block = makeBlock(type);
    setBlocks((current) => {
      const safeIndex = Math.max(0, Math.min(index, current.length));
      const next = [...current];
      next.splice(safeIndex, 0, block);
      return next;
    });
    setActiveBlockId(block.id);
    setSelectedPaletteType(null);
    setDropIndex(null);
    setHoverDropIndex(null);
  };

  const removeBlock = (blockId: string) => {
    const index = blocks.findIndex((block) => block.id === blockId);
    const nextBlocks = blocks.filter((block) => block.id !== blockId);
    setBlocks(nextBlocks);
    if (activeBlockId === blockId) {
      setActiveBlockId(nextBlocks[Math.max(0, index - 1)]?.id || nextBlocks[0]?.id || "");
    }
  };

  const clearDragState = () => {
    setDraggedBlockId(null);
    setIsPaletteDragging(false);
    setDropIndex(null);
    setHoverDropIndex(null);
  };

  const moveBlockToIndex = (blockId: string, index: number) => {
    setBlocks((current) => {
      const fromIndex = current.findIndex((block) => block.id === blockId);
      if (fromIndex < 0) return current;

      let safeIndex = Math.max(0, Math.min(index, current.length));
      const next = [...current];
      const [item] = next.splice(fromIndex, 1);

      if (fromIndex < safeIndex) safeIndex -= 1;
      next.splice(Math.max(0, Math.min(safeIndex, next.length)), 0, item);
      return next;
    });
    setActiveBlockId(blockId);
  };

  const handlePaletteDragStart = (event: DragEvent<HTMLButtonElement>, type: BlockType) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(BLOCK_TYPE_MIME, type);
    setSelectedPaletteType(null);
    setIsPaletteDragging(true);
  };

  const handleBlockDragStart = (event: DragEvent<HTMLButtonElement>, blockId: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(BLOCK_ID_MIME, blockId);
    setSelectedPaletteType(null);
    setDraggedBlockId(blockId);
    setActiveBlockId(blockId);
  };

  const canHandleDrag = () => draggedBlockId || isPaletteDragging;

  const selectPaletteBlock = (type: BlockType) => {
    setSelectedPaletteType((current) => (current === type ? null : type));
    setDropIndex(null);
    setHoverDropIndex(null);
  };

  const handleDropZoneClick = (index: number) => {
    if (!selectedPaletteType) return;
    insertBlock(selectedPaletteType, index);
  };

  const handleGapDragOver = (event: DragEvent<HTMLDivElement>, index: number) => {
    if (!canHandleDrag()) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = isPaletteDragging ? "copy" : "move";
    setDropIndex(index);
    setHoverDropIndex(index);
  };

  const getBlockDropIndex = (event: DragEvent<HTMLDivElement>, blockId: string) => {
    const blockIndex = blocks.findIndex((block) => block.id === blockId);
    if (blockIndex < 0) return blocks.length;
    const rect = event.currentTarget.getBoundingClientRect();
    const shouldDropAfter = event.clientY > rect.top + rect.height / 2;
    return blockIndex + (shouldDropAfter ? 1 : 0);
  };

  const handleBlockDragOver = (event: DragEvent<HTMLDivElement>, blockId: string) => {
    if (!canHandleDrag()) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = isPaletteDragging ? "copy" : "move";
    const nextDropIndex = getBlockDropIndex(event, blockId);
    setDropIndex(nextDropIndex);
    setHoverDropIndex(nextDropIndex);
  };

  const handleDropAtIndex = (event: DragEvent<HTMLDivElement>, index: number) => {
    if (!canHandleDrag()) return;
    event.preventDefault();
    event.stopPropagation();

    const droppedType = event.dataTransfer.getData(BLOCK_TYPE_MIME);
    const droppedBlockId = event.dataTransfer.getData(BLOCK_ID_MIME) || draggedBlockId;

    if (isBlockType(droppedType)) {
      insertBlock(droppedType, index);
    } else if (droppedBlockId) {
      moveBlockToIndex(droppedBlockId, index);
    }

    clearDragState();
  };

  const handleDropZoneMouseEnter = (index: number) => {
    if (selectedPaletteType) {
      setHoverDropIndex(index);
      setDropIndex(index);
    }
  };

  const handleDropZoneMouseLeave = () => {
    if (selectedPaletteType) {
      setHoverDropIndex(null);
      setDropIndex(null);
    }
  };

  const copyVariable = async (variable: string) => {
    const copyWithTextarea = () => {
      const textarea = window.document.createElement("textarea");
      textarea.value = variable;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      window.document.body.appendChild(textarea);
      textarea.select();
      const copied = window.document.execCommand("copy");
      window.document.body.removeChild(textarea);
      return copied;
    };

    let copied = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(variable);
        copied = true;
      } else {
        copied = copyWithTextarea();
      }
    } catch {
      copied = copyWithTextarea();
    }

    if (copied) {
      setCopiedVariable(variable);
      window.setTimeout(() => {
        setCopiedVariable((current) => (current === variable ? null : current));
      }, 1400);
    } else {
      setCopiedVariable(null);
    }
  };

  const uploadLogo = (blockId: string, file?: File | null) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      if (!src) return;
      updateBlock(blockId, (block) => ({
        ...block,
        content: {
          ...block.content,
          src,
          alt: block.content?.alt || file.name.replace(/\.[^.]+$/, "") || "Company logo",
          width: block.content?.width || 160,
          height: block.content?.height || 64,
        },
      }));
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    await onSave({
      title,
      description,
      builderBlocks: blocks,
      variables: {
        ...((initialDocument?.variables as Record<string, any>) || {}),
        documentStyle: documentSettings,
      },
    });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-5 px-4 py-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <Label htmlFor="documentTitle">Document title</Label>
            <Input id="documentTitle" value={title} onChange={(event) => setTitle(event.target.value)} className="h-11 w-full bg-white text-lg font-semibold lg:w-[520px]" />
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Short internal description" className="min-h-20 bg-white lg:w-[520px]" />
          </div>
          <Button onClick={save} disabled={saving || !title.trim()} className="w-full lg:w-auto">
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save document"}
          </Button>
        </div>

        <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)_340px]">
          <aside className="rounded-md border bg-white p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Plus className="h-4 w-4" />
              Blocks
            </div>
            <div className="grid gap-2">
              {blockOptions.map((item) => (
                <Button
                  key={item.type}
                  type="button"
                  variant={selectedPaletteType === item.type ? "default" : "outline"}
                  draggable
                  className="justify-start"
                  aria-pressed={selectedPaletteType === item.type}
                  onClick={() => selectPaletteBlock(item.type)}
                  onDragStart={(event) => handlePaletteDragStart(event, item.type)}
                  onDragEnd={clearDragState}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Button>
              ))}
            </div>
            <div className="mt-5 space-y-2">
              <div className="text-xs font-semibold uppercase text-slate-500">Variables</div>
              <div className="flex flex-wrap gap-2">
                {variables.map((variable) => (
                  <button
                    key={variable}
                    type="button"
                    onClick={() => copyVariable(variable)}
                    className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      copiedVariable === variable
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-transparent bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                    }`}
                    aria-label={`Copy ${variable}`}
                    title={`Copy ${variable}`}
                  >
                    {copiedVariable === variable ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {variable}
                    {copiedVariable === variable && <span className="font-sans text-[10px] font-semibold">Copied</span>}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <main className="min-h-[720px] rounded-md border bg-white p-4 shadow-sm">
            <div
              className="mx-auto space-y-6 border shadow-sm transition"
              style={{
                maxWidth: pageSizes[documentSettings.pageSize].width,
                minHeight: pageSizes[documentSettings.pageSize].height,
                padding: `${documentSettings.marginY}px ${documentSettings.marginX}px`,
                backgroundColor: documentSettings.backgroundColor,
                borderColor: documentSettings.accentColor,
                color: documentSettings.textColor,
                fontFamily: documentSettings.fontFamily,
                fontSize: `${documentSettings.fontSize}px`,
                lineHeight: documentSettings.lineHeight,
              }}
            >
              <InsertBlockControl
                index={0}
                active={isPlacementActive}
                isDropTarget={dropIndex === 0 || hoverDropIndex === 0}
                selectedType={activePlacementType}
                onClick={handleDropZoneClick}
                onDragOver={handleGapDragOver}
                onDrop={handleDropAtIndex}
                onMouseEnter={handleDropZoneMouseEnter}
                onMouseLeave={handleDropZoneMouseLeave}
              />

              {blocks.map((block, index) => (
                <div key={block.id} className="space-y-6">
                  <div
                    onDragOver={(event) => handleBlockDragOver(event, block.id)}
                    onDrop={(event) => handleDropAtIndex(event, getBlockDropIndex(event, block.id))}
                    className={`rounded-md border p-2 transition ${
                      activeBlockId === block.id ? "border-blue-400 bg-blue-50/50" : "border-transparent hover:border-slate-200"
                    } ${draggedBlockId === block.id ? "opacity-50" : ""}`}
                  >
                    <div className="flex gap-3">
                      <button
                        type="button"
                        draggable
                        onDragStart={(event) => handleBlockDragStart(event, block.id)}
                        onDragEnd={clearDragState}
                        onClick={() => setActiveBlockId(block.id)}
                        className="mt-1 flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 hover:text-slate-700 active:cursor-grabbing"
                        aria-label="Drag block"
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setActiveBlockId(block.id)} className="block min-w-0 flex-1 rounded-md p-2 text-left">
                        <PreviewBlock block={block} />
                      </button>
                    </div>
                  </div>

                  <InsertBlockControl
                    index={index + 1}
                    active={isPlacementActive}
                    isDropTarget={dropIndex === index + 1 || hoverDropIndex === index + 1}
                    selectedType={activePlacementType}
                    onClick={handleDropZoneClick}
                    onDragOver={handleGapDragOver}
                    onDrop={handleDropAtIndex}
                    onMouseEnter={handleDropZoneMouseEnter}
                    onMouseLeave={handleDropZoneMouseLeave}
                  />
                </div>
              ))}
            </div>
          </main>

          <aside className="rounded-md border bg-white p-4">
            <div className="mb-4 grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setSettingsMode("block")}
                className={`rounded px-3 py-2 text-sm font-medium transition ${settingsMode === "block" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
              >
                Block
              </button>
              <button
                type="button"
                onClick={() => setSettingsMode("document")}
                className={`rounded px-3 py-2 text-sm font-medium transition ${settingsMode === "document" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
              >
                Document
              </button>
            </div>

            {settingsMode === "document" ? (
              <div className="space-y-4">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">Document properties</p>
                      <p className="text-xs text-slate-500">{pageSizes[documentSettings.pageSize].label} page</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setDocumentSettings(documentDefaults)}>Reset</Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Page size</Label>
                  <Select value={documentSettings.pageSize} onValueChange={(value: DocumentSettings["pageSize"]) => updateDocumentSettings({ pageSize: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(pageSizes).map(([value, option]) => <SelectItem key={value} value={value}>{option.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Font family</Label>
                  <Select value={documentSettings.fontFamily} onValueChange={(value) => updateDocumentSettings({ fontFamily: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {fontOptions.map((font) => <SelectItem key={font.value} value={font.value}>{font.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Font size</Label>
                    <Input type="number" min="9" max="28" value={documentSettings.fontSize} onChange={(event) => updateDocumentSettings({ fontSize: clampNumber(Number(event.target.value), 9, 28) })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Line height</Label>
                    <Input type="number" min="1" max="2.4" step="0.1" value={documentSettings.lineHeight} onChange={(event) => updateDocumentSettings({ lineHeight: clampNumber(Number(event.target.value), 1, 2.4) })} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Side margin</Label>
                    <Input type="number" min="16" max="96" value={documentSettings.marginX} onChange={(event) => updateDocumentSettings({ marginX: clampNumber(Number(event.target.value), 16, 96) })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Top margin</Label>
                    <Input type="number" min="16" max="120" value={documentSettings.marginY} onChange={(event) => updateDocumentSettings({ marginY: clampNumber(Number(event.target.value), 16, 120) })} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>Text</Label>
                    <Input type="color" value={documentSettings.textColor} onChange={(event) => updateDocumentSettings({ textColor: event.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Paper</Label>
                    <Input type="color" value={documentSettings.backgroundColor} onChange={(event) => updateDocumentSettings({ backgroundColor: event.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Accent</Label>
                    <Input type="color" value={documentSettings.accentColor} onChange={(event) => updateDocumentSettings({ accentColor: event.target.value })} />
                  </div>
                </div>
              </div>
            ) : activeBlock ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">Block properties</p>
                    <p className="text-xs text-slate-500">{activeBlock.type}</p>
                  </div>
                  <GripVertical className="h-4 w-4 text-slate-400" />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => moveBlock(activeBlock.id, -1)}>Move up</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => moveBlock(activeBlock.id, 1)}>Move down</Button>
                </div>

                <div className="space-y-2">
                  <Label>Block type</Label>
                  <Select
                    value={activeBlock.type}
                    onValueChange={(value: BlockType) => updateBlock(activeBlock.id, (block) => ({
                      ...block,
                      type: value,
                      content: makeBlock(value).content,
                    }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {blockOptions.map((item) => <SelectItem key={item.type} value={item.type}>{item.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {activeBlock.type === "section" && (
                  <div className="space-y-2">
                    <Label>Section title</Label>
                    <Input value={activeBlock.content?.title || ""} onChange={(event) => updateBlock(activeBlock.id, (block) => ({ ...block, content: { ...block.content, title: event.target.value } }))} />
                  </div>
                )}

                {activeBlock.type === "logo" && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Logo image</Label>
                      <Input
                        type="file"
                        accept="image/png,image/jpeg"
                        onChange={(event) => {
                          uploadLogo(activeBlock.id, event.currentTarget.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Alt text</Label>
                      <Input value={activeBlock.content?.alt || ""} onChange={(event) => updateBlock(activeBlock.id, (block) => ({ ...block, content: { ...block.content, alt: event.target.value } }))} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Width</Label>
                        <Input type="number" min="32" max="420" value={blockDimension(activeBlock, "width", 160, 32, 420)} onChange={(event) => updateBlock(activeBlock.id, (block) => ({ ...block, content: { ...block.content, width: clampNumber(Number(event.target.value), 32, 420) } }))} />
                      </div>
                      <div className="space-y-2">
                        <Label>Height</Label>
                        <Input type="number" min="24" max="240" value={blockDimension(activeBlock, "height", 64, 24, 240)} onChange={(event) => updateBlock(activeBlock.id, (block) => ({ ...block, content: { ...block.content, height: clampNumber(Number(event.target.value), 24, 240) } }))} />
                      </div>
                    </div>
                    {activeBlock.content?.src && (
                      <Button type="button" variant="outline" size="sm" onClick={() => updateBlock(activeBlock.id, (block) => ({ ...block, content: { ...block.content, src: "" } }))}>
                        Remove uploaded logo
                      </Button>
                    )}
                  </div>
                )}

                {activeBlock.type === "spacer" && (
                  <div className="space-y-2">
                    <Label>Height</Label>
                    <Input
                      type="number"
                      min="8"
                      max="600"
                      value={blockDimension(activeBlock, "height", 48, 8, 600)}
                      onChange={(event) => updateBlock(activeBlock.id, (block) => ({ ...block, content: { ...block.content, height: clampNumber(Number(event.target.value), 8, 600) } }))}
                    />
                  </div>
                )}

                {hasEditableTextContent(activeBlock) && (
                  <div className="space-y-2">
                    <Label>Content</Label>
                    <Textarea
                      className="min-h-32"
                      value={activeBlock.type === "section" ? activeBlock.content?.text || "" : activeBlock.content?.text || ""}
                      onChange={(event) => updateBlock(activeBlock.id, (block) => ({
                        ...block,
                        content: { ...block.content, text: event.target.value },
                      }))}
                    />
                  </div>
                )}

                {activeBlock.type === "table" && (
                  <div className="space-y-2">
                    <Label>Rows JSON</Label>
                    <Textarea
                      className="min-h-36 font-mono text-xs"
                      value={JSON.stringify(activeBlock.content?.rows || [], null, 2)}
                      onChange={(event) => {
                        try {
                          const rows = JSON.parse(event.target.value);
                          updateBlock(activeBlock.id, (block) => ({ ...block, content: { ...block.content, rows } }));
                        } catch {}
                      }}
                    />
                  </div>
                )}

                <div className="border-t pt-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-950">Appearance</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => resetBlockStyle(activeBlock.id)}>Reset</Button>
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Align</Label>
                        <Select value={(activeBlock.style?.align as string) || "left"} onValueChange={(value) => updateBlockStyle(activeBlock.id, { align: value })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {alignOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Weight</Label>
                        <Select value={(activeBlock.style?.fontWeight as string) || "normal"} onValueChange={(value) => updateBlockStyle(activeBlock.id, { fontWeight: value })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {weightOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Font size</Label>
                        <Input type="number" min="8" max="48" value={activeBlock.style?.fontSize ?? ""} placeholder="Auto" onChange={(event) => updateBlockStyle(activeBlock.id, { fontSize: event.target.value ? clampNumber(Number(event.target.value), 8, 48) : undefined })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Line height</Label>
                        <Input type="number" min="1" max="2.4" step="0.1" value={activeBlock.style?.lineHeight ?? ""} placeholder="Auto" onChange={(event) => updateBlockStyle(activeBlock.id, { lineHeight: event.target.value ? clampNumber(Number(event.target.value), 1, 2.4) : undefined })} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Padding</Label>
                        <Input type="number" min="0" max="48" value={activeBlock.style?.padding ?? 0} onChange={(event) => updateBlockStyle(activeBlock.id, { padding: clampNumber(Number(event.target.value), 0, 48) })} />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <Label>Text</Label>
                        <Input type="color" value={activeBlock.style?.color || documentSettings.textColor} onChange={(event) => updateBlockStyle(activeBlock.id, { color: event.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Fill</Label>
                        <Input type="color" value={activeBlock.style?.backgroundColor || "#ffffff"} onChange={(event) => updateBlockStyle(activeBlock.id, { backgroundColor: event.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Border</Label>
                        <Input type="color" value={activeBlock.style?.borderColor || "#e2e8f0"} onChange={(event) => updateBlockStyle(activeBlock.id, { borderColor: event.target.value })} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Border width</Label>
                        <Input type="number" min="0" max="8" value={activeBlock.style?.borderWidth ?? 0} onChange={(event) => updateBlockStyle(activeBlock.id, { borderWidth: clampNumber(Number(event.target.value), 0, 8) })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Radius</Label>
                        <Input type="number" min="0" max="32" value={activeBlock.style?.borderRadius ?? 0} onChange={(event) => updateBlockStyle(activeBlock.id, { borderRadius: clampNumber(Number(event.target.value), 0, 32) })} />
                      </div>
                    </div>
                  </div>
                </div>

                <Button type="button" variant="destructive" className="w-full" onClick={() => removeBlock(activeBlock.id)}>
                  <Trash2 className="h-4 w-4" />
                  Remove block
                </Button>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Select a block to edit its content.</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
