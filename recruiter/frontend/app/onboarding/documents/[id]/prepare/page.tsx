"use client";

import { PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Eye, ImageIcon, Mail, MousePointer2, Plus, Save, Signature, Type, UserRound, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OnboardingStatusBadge } from "@/components/onboarding/status-badge";
import { PdfPagePreview } from "@/components/onboarding/pdf-page-preview";
import {
  getDocumentPreviewBlob,
  getDocument,
  newSignatureField,
  renderDocument,
  updateDocument,
  type OnboardingDocument,
  type SignatureField,
} from "@/services/onboardingService";
import { toast } from "sonner";

const fieldIcons = {
  signature: Signature,
  date: CalendarDays,
  name: UserRound,
  email: Mail,
  text: Type,
  image: ImageIcon,
};

type FieldResizeHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
type FieldCanvasMode = "edit" | "preview";
type FieldInteraction =
  | { mode: "move"; id: string; dx: number; dy: number }
  | { mode: "resize"; id: string; handle: FieldResizeHandle; startX: number; startY: number; startField: SignatureField };

const resizeHandles: FieldResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const resizeHandleClassNames: Record<FieldResizeHandle, string> = {
  n: "left-1/2 top-[-6px] -translate-x-1/2 cursor-ns-resize",
  s: "bottom-[-6px] left-1/2 -translate-x-1/2 cursor-ns-resize",
  e: "right-[-6px] top-1/2 -translate-y-1/2 cursor-ew-resize",
  w: "left-[-6px] top-1/2 -translate-y-1/2 cursor-ew-resize",
  nw: "left-[-6px] top-[-6px] cursor-nwse-resize",
  ne: "right-[-6px] top-[-6px] cursor-nesw-resize",
  sw: "bottom-[-6px] left-[-6px] cursor-nesw-resize",
  se: "bottom-[-6px] right-[-6px] cursor-nwse-resize",
};

const MIN_FIELD_WIDTH = 0.015;
const MIN_FIELD_HEIGHT = 0.012;

function roundUnit(value: number) {
  return Number(value.toFixed(4));
}

function clampUnit(value: number, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function displayScaleFromPercent(value: number | string, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return clampUnit(number / 100, 0.35, 2.5);
}

function clampFieldRect(rect: Pick<SignatureField, "x" | "y" | "width" | "height">) {
  const width = clampUnit(rect.width, MIN_FIELD_WIDTH, 1);
  const height = clampUnit(rect.height, MIN_FIELD_HEIGHT, 1);
  return {
    width: roundUnit(width),
    height: roundUnit(height),
    x: roundUnit(clampUnit(rect.x, 0, 1 - width)),
    y: roundUnit(clampUnit(rect.y, 0, 1 - height)),
  };
}

function fieldTypeLabel(type: SignatureField["type"]) {
  if (type === "text") return "Candidate text";
  if (type === "image") return "Candidate image";
  if (type === "date") return "Date signed";
  if (type === "name") return "Name";
  if (type === "email") return "Email";
  return "Signature";
}

function fieldPreviewValue(field: SignatureField) {
  if (field.type === "text") return field.placeholder || field.label || "Candidate text";
  if (field.type === "image") return field.placeholder || field.label || "Candidate image";
  if (field.type === "date") return "Date signed";
  if (field.type === "name") return "Signer name";
  if (field.type === "email") return "Signer email";
  return field.label || "Signature";
}

export default function PrepareOnboardingDocumentPage() {
  const params = useParams<{ id: string }>();
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [document, setDocument] = useState<OnboardingDocument | null>(null);
  const [fields, setFields] = useState<SignatureField[]>([]);
  const [activeFieldId, setActiveFieldId] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageCount, setPreviewPageCount] = useState(1);
  const [previewPageSize, setPreviewPageSize] = useState<{ width: number; height: number } | null>(null);
  const [canvasMode, setCanvasMode] = useState<FieldCanvasMode>("edit");
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [canvasWidthScale, setCanvasWidthScale] = useState(1);
  const [canvasHeightScale, setCanvasHeightScale] = useState(1);
  const [interaction, setInteraction] = useState<FieldInteraction | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await getDocument(params.id);
        setDocument(data);
        setFields(data.signatureFields || []);
        setActiveFieldId(data.signatureFields?.[0]?.id || "");
        setPreviewPage(data.signatureFields?.[0]?.page || 1);
      } catch (error: any) {
        toast.error(error.message || "Failed to load document");
      }
    }
    load();
  }, [params.id]);

  useEffect(() => {
    if (!document?._id) return;

    let cancelled = false;
    let objectUrl = "";

    async function loadPreview() {
      try {
        setPreviewLoading(true);
        setPreviewError("");
        const blob = await getDocumentPreviewBlob(document!._id);
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setPreviewBlob(blob);
        setPreviewUrl(objectUrl);
      } catch (error: any) {
        if (!cancelled) {
          setPreviewBlob(null);
          setPreviewUrl("");
          setPreviewError(error.message || "Failed to load document preview");
        }
      } finally {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      }
    }

    loadPreview();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document?._id, document?.pdfSnapshot?.renderedAt, document?.updatedAt, previewReloadKey]);

  const activeField = fields.find((field) => field.id === activeFieldId);
  const visibleFields = fields.filter((field) => field.page === previewPage);
  const canvasWidthPercent = Math.round(canvasZoom * canvasWidthScale * 100);
  const canvasAspectRatio = previewPageSize
    ? `${previewPageSize.width * canvasWidthScale} / ${previewPageSize.height * canvasHeightScale}`
    : `${8.5 * canvasWidthScale} / ${11 * canvasHeightScale}`;
  const handlePreviewPageCount = useCallback((count: number) => {
    setPreviewPageCount(count);
    setPreviewPage((page) => Math.max(1, Math.min(page, count)));
  }, []);
  const handlePreviewPageRendered = useCallback((page: { width: number; height: number }) => {
    setPreviewPageSize({ width: page.width, height: page.height });
  }, []);

  function visiblePageFieldRect(width: number, height: number) {
    const page = pageRef.current?.getBoundingClientRect();
    if (!page || page.width <= 0 || page.height <= 0 || typeof window === "undefined") {
      return clampFieldRect({ x: 0.12, y: 0.12, width, height });
    }

    const visibleLeft = Math.max(page.left, 0);
    const visibleRight = Math.min(page.right, window.innerWidth);
    const visibleTop = Math.max(page.top, 0);
    const visibleBottom = Math.min(page.bottom, window.innerHeight);
    const centerX = visibleRight > visibleLeft
      ? (visibleLeft + visibleRight) / 2
      : Math.max(page.left, Math.min(page.right, window.innerWidth / 2));
    const centerY = visibleBottom > visibleTop
      ? (visibleTop + visibleBottom) / 2
      : Math.max(page.top, Math.min(page.bottom, window.innerHeight / 2));
    const fieldsOnPage = fields.filter((field) => field.page === previewPage).length;
    const stagger = (fieldsOnPage % 4) * Math.min(height + 0.012, 0.055);

    return clampFieldRect({
      x: (centerX - page.left) / page.width - width / 2,
      y: (centerY - page.top) / page.height - height / 2 + stagger,
      width,
      height,
    });
  }

  function addField(role: "candidate" | "internal" = "candidate", type: SignatureField["type"] = "signature", patch: Partial<SignatureField> = {}) {
    const defaultWidth = type === "signature" ? 0.3 : type === "image" ? 0.26 : type === "text" && patch.multiline ? 0.55 : 0.28;
    const defaultHeight = type === "signature" ? 0.08 : type === "image" ? 0.16 : type === "text" && patch.multiline ? 0.16 : 0.05;
    const width = patch.width ?? defaultWidth;
    const height = patch.height ?? defaultHeight;
    const rect = visiblePageFieldRect(width, height);
    const field: SignatureField = {
      ...newSignatureField(role),
      id: `${role}-${type}-${Date.now()}`,
      role,
      type,
      label: type === "text" && role === "candidate" ? "Candidate response" : type === "image" && role === "candidate" ? "Candidate image" : fieldTypeLabel(type),
      placeholder: type === "text" && role === "candidate" ? "Type your response here" : type === "image" && role === "candidate" ? "Upload image here" : "",
      multiline: false,
      page: previewPage,
      x: patch.x ?? rect.x,
      y: patch.y ?? rect.y,
      width,
      height,
      ...patch,
    };
    setFields((current) => [...current, field]);
    setActiveFieldId(field.id);
  }

  function updateField(id: string, patch: Partial<SignatureField>) {
    setFields((current) => current.map((field) => (field.id === id ? { ...field, ...patch } : field)));
  }

  function updateFieldRect(id: string, patch: Partial<Pick<SignatureField, "x" | "y" | "width" | "height">>) {
    setFields((current) => current.map((field) => {
      if (field.id !== id) return field;
      return {
        ...field,
        ...clampFieldRect({
          x: patch.x ?? field.x,
          y: patch.y ?? field.y,
          width: patch.width ?? field.width,
          height: patch.height ?? field.height,
        }),
      };
    }));
  }

  function removeField(id: string) {
    setFields((current) => {
      const remaining = current.filter((field) => field.id !== id);
      if (activeFieldId === id) {
        const nextField = remaining[0];
        setActiveFieldId(nextField?.id || "");
        setPreviewPage(nextField?.page || 1);
      }
      return remaining;
    });
  }

  function selectField(field: SignatureField) {
    setActiveFieldId(field.id);
    setPreviewPage(field.page);
  }

  function onMovePointerDown(event: PointerEvent<HTMLDivElement>, field: SignatureField) {
    const page = pageRef.current?.getBoundingClientRect();
    if (!page) return;
    event.preventDefault();
    const fieldLeft = field.x * page.width;
    const fieldTop = field.y * page.height;
    setInteraction({
      mode: "move",
      id: field.id,
      dx: event.clientX - page.left - fieldLeft,
      dy: event.clientY - page.top - fieldTop,
    });
    setActiveFieldId(field.id);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onResizePointerDown(event: PointerEvent<HTMLSpanElement>, field: SignatureField, handle: FieldResizeHandle) {
    event.preventDefault();
    event.stopPropagation();
    setActiveFieldId(field.id);
    setInteraction({
      mode: "resize",
      id: field.id,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startField: field,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!interaction) return;
    const page = pageRef.current?.getBoundingClientRect();
    if (!page) return;

    if (interaction.mode === "move") {
      const field = fields.find((item) => item.id === interaction.id);
      if (!field) return;
      const x = (event.clientX - page.left - interaction.dx) / page.width;
      const y = (event.clientY - page.top - interaction.dy) / page.height;
      updateFieldRect(interaction.id, { x, y });
      return;
    }

    const dx = (event.clientX - interaction.startX) / page.width;
    const dy = (event.clientY - interaction.startY) / page.height;
    const start = interaction.startField;
    let x = start.x;
    let y = start.y;
    let width = start.width;
    let height = start.height;

    if (interaction.handle.includes("e")) width = start.width + dx;
    if (interaction.handle.includes("s")) height = start.height + dy;
    if (interaction.handle.includes("w")) {
      x = start.x + dx;
      width = start.width - dx;
      if (width < MIN_FIELD_WIDTH) {
        width = MIN_FIELD_WIDTH;
        x = start.x + start.width - MIN_FIELD_WIDTH;
      }
    }
    if (interaction.handle.includes("n")) {
      y = start.y + dy;
      height = start.height - dy;
      if (height < MIN_FIELD_HEIGHT) {
        height = MIN_FIELD_HEIGHT;
        y = start.y + start.height - MIN_FIELD_HEIGHT;
      }
    }

    if (x < 0) {
      width += x;
      x = 0;
    }
    if (y < 0) {
      height += y;
      y = 0;
    }
    if (x + width > 1) width = 1 - x;
    if (y + height > 1) height = 1 - y;

    updateFieldRect(interaction.id, { x, y, width, height });
  }

  async function saveFields() {
    if (!document) return;
    try {
      setSaving(true);
      const updated = await updateDocument(document._id, { signatureFields: fields });
      const rendered = await renderDocument(updated._id).catch(() => updated);
      setDocument(rendered);
      toast.success("Fields saved");
    } catch (error: any) {
      toast.error(error.message || "Failed to save fields");
    } finally {
      setSaving(false);
    }
  }

  if (!document) {
    return <div className="p-8 text-sm text-slate-500">Loading document...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-screen-2xl px-4 py-6 lg:px-8">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <OnboardingStatusBadge status={document.status} />
              <span className="text-xs uppercase tracking-wide text-slate-500">{document.sourceType.replace(/_/g, " ")}</span>
            </div>
            <h1 className="text-3xl font-semibold text-slate-950">{document.title}</h1>
            <p className="mt-2 text-sm text-slate-600">Place signing fields and candidate-fillable text fields. Drag a field on the page or edit exact values.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {previewUrl && (
              <Button asChild variant="outline">
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  <Download className="h-4 w-4" />
                  Preview PDF
                </a>
              </Button>
            )}
            <Button onClick={saveFields} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save fields"}
            </Button>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-md border bg-white p-4">
            <div className="mb-3 flex flex-col gap-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="text-sm font-medium text-slate-700">Page {previewPage} of {previewPageCount}</div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                  <Button type="button" variant={canvasMode === "edit" ? "default" : "outline"} size="sm" onClick={() => setCanvasMode("edit")}>
                    <MousePointer2 className="h-4 w-4" />
                    Edit
                  </Button>
                  <Button type="button" variant={canvasMode === "preview" ? "default" : "outline"} size="sm" onClick={() => setCanvasMode("preview")}>
                    <Eye className="h-4 w-4" />
                    Preview
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={previewPage <= 1} onClick={() => setPreviewPage((page) => Math.max(1, page - 1))}>
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={previewPage >= previewPageCount} onClick={() => setPreviewPage((page) => Math.min(previewPageCount, page + 1))}>
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <div className="h-6 w-px bg-slate-200" />
                <Button type="button" variant="outline" size="sm" onClick={() => setCanvasZoom((value) => clampUnit(value - 0.1, 0.35, 2.5))}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="w-12 text-center text-xs font-medium text-slate-600">{Math.round(canvasZoom * 100)}%</span>
                <Button type="button" variant="outline" size="sm" onClick={() => setCanvasZoom((value) => clampUnit(value + 0.1, 0.35, 2.5))}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-1 text-xs text-slate-600">
                  <span>Width</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setCanvasWidthScale((value) => clampUnit(value - 0.05, 0.35, 2.5))}>-</Button>
                  <Input
                    type="number"
                    min="35"
                    max="250"
                    value={Math.round(canvasWidthScale * 100)}
                    onChange={(event) => setCanvasWidthScale((current) => displayScaleFromPercent(event.target.value, current))}
                    className="h-8 w-20"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => setCanvasWidthScale((value) => clampUnit(value + 0.05, 0.35, 2.5))}>+</Button>
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-600">
                  <span>Height</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setCanvasHeightScale((value) => clampUnit(value - 0.05, 0.35, 2.5))}>-</Button>
                  <Input
                    type="number"
                    min="35"
                    max="250"
                    value={Math.round(canvasHeightScale * 100)}
                    onChange={(event) => setCanvasHeightScale((current) => displayScaleFromPercent(event.target.value, current))}
                    className="h-8 w-20"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => setCanvasHeightScale((value) => clampUnit(value + 0.05, 0.35, 2.5))}>+</Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCanvasZoom(1);
                    setCanvasWidthScale(1);
                    setCanvasHeightScale(1);
                  }}
                >
                  Reset view
                </Button>
              </div>
            </div>
            <div className="overflow-auto rounded-md bg-slate-100 p-3">
              <div
                ref={pageRef}
                onPointerMove={onPointerMove}
                onPointerUp={() => setInteraction(null)}
                onPointerCancel={() => setInteraction(null)}
                className="relative mx-auto min-w-[280px] select-none overflow-hidden border bg-white shadow-sm"
                style={{
                  width: `${canvasWidthPercent}%`,
                  aspectRatio: canvasAspectRatio,
                  touchAction: "none",
                }}
              >
              {previewLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading document preview...</div>
              ) : previewBlob ? (
                <PdfPagePreview
                  blob={previewBlob}
                  title={document.title}
                  pageNumber={previewPage}
                  onPageCount={handlePreviewPageCount}
                  onPageRendered={handlePreviewPageRendered}
                />
              ) : previewError ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                  <p className="text-sm font-medium text-slate-700">Document preview could not be loaded.</p>
                  <p className="max-w-md text-xs leading-5 text-slate-500">{previewError}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => setPreviewReloadKey((key) => key + 1)}>
                    Retry preview
                  </Button>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">Render the document to preview the PDF.</div>
              )}

              <div className="pointer-events-none absolute inset-0">
                {visibleFields.map((field) => {
                  const Icon = fieldIcons[field.type] || Signature;
                  return (
                    <div
                      key={field.id}
                      role="button"
                      tabIndex={0}
                      onPointerDown={(event) => {
                        if (canvasMode === "edit") {
                          onMovePointerDown(event, field);
                          return;
                        }
                        setActiveFieldId(field.id);
                      }}
                      className={`pointer-events-auto absolute flex min-w-0 items-center overflow-hidden rounded border px-1 text-left text-[10px] font-medium leading-tight shadow-sm ${
                        canvasMode === "preview"
                          ? activeFieldId === field.id
                            ? "border-blue-500 bg-white/70 text-slate-950"
                            : "border-slate-400 bg-white/50 text-slate-800"
                          : activeFieldId === field.id
                            ? "cursor-move border-blue-500 bg-blue-50 text-blue-700"
                            : "cursor-move border-emerald-500 bg-emerald-50 text-emerald-700"
                      }`}
                      style={{
                        left: `${field.x * 100}%`,
                        top: `${field.y * 100}%`,
                        width: `${field.width * 100}%`,
                        height: `${field.height * 100}%`,
                      }}
                    >
                      {canvasMode === "edit" && <Icon className="h-3 w-3 shrink-0" />}
                      <span className={`${field.multiline || canvasMode === "preview" ? "whitespace-pre-wrap break-words" : "truncate"}`}>
                        {canvasMode === "preview" ? fieldPreviewValue(field) : field.label || fieldTypeLabel(field.type)}
                      </span>
                      {canvasMode === "edit" && activeFieldId === field.id && resizeHandles.map((handle) => (
                        <span
                          key={handle}
                          aria-label={`Resize ${handle}`}
                          data-resize-handle={handle}
                          onPointerDown={(event) => onResizePointerDown(event, field, handle)}
                          className={`absolute h-3 w-3 rounded-sm border border-blue-600 bg-white shadow-sm ${resizeHandleClassNames[handle]}`}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
            </div>
          </section>

          <aside className="rounded-md border bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Fields</h2>
                <p className="text-xs text-slate-500">{fields.length} placed</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => addField("candidate", "text")}>
                  <Type className="h-4 w-4" />
                  Add fillable text
                </Button>
                <Button size="sm" variant="outline" onClick={() => addField("candidate", "text", { multiline: true, label: "Long response", placeholder: "Type your full response here" })}>
                  <Type className="h-4 w-4" />
                  Add long text
                </Button>
                <Button size="sm" variant="outline" onClick={() => addField("candidate", "image")}>
                  <ImageIcon className="h-4 w-4" />
                  Add image
                </Button>
                <Button size="sm" onClick={() => addField("candidate")}>
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            </div>
            <p className="mb-4 text-xs leading-5 text-slate-500">
              Candidate text and image fields become inputs in the candidate portal. Name, email, and date fields are filled automatically when the signer completes the document.
            </p>

            <div className="mb-5 grid gap-2">
              {fields.map((field) => (
                <button key={field.id} type="button" onClick={() => selectField(field)} className={`w-full min-w-0 rounded-md border p-3 text-left text-sm ${activeFieldId === field.id ? "border-blue-300 bg-blue-50" : "hover:bg-slate-50"}`}>
                  <div className="min-w-0 break-words font-medium text-slate-950">{field.label || fieldTypeLabel(field.type)}</div>
                  <div className="text-xs text-slate-500">{field.role} - page {field.page}</div>
                </button>
              ))}
            </div>

            {activeField ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select
                      value={activeField.role}
                      onValueChange={(value: "candidate" | "internal") => {
                        if (activeField.type === "image" && value !== "candidate") {
                          toast.error("Image upload fields are completed by candidates");
                          return;
                        }
                        updateField(activeField.id, { role: value });
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="candidate">Candidate</SelectItem>
                        <SelectItem value="internal">Internal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select
                      value={activeField.type}
                      onValueChange={(value: SignatureField["type"]) => updateField(activeField.id, {
                        type: value,
                        ...(value === "image" ? { role: "candidate" as const, label: "Candidate image", placeholder: "Upload image here" } : {}),
                      })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="signature">Signature</SelectItem>
                        <SelectItem value="date">Date</SelectItem>
                        <SelectItem value="name">Name</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="text">Candidate text</SelectItem>
                        <SelectItem value="image">Candidate image</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs leading-5 text-slate-500">
                      Candidate text is typed in the portal, and candidate image fields request an image upload. Name, email, and date are stamped automatically.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Label</Label>
                  <Input value={activeField.label || ""} onChange={(event) => updateField(activeField.id, { label: event.target.value })} />
                </div>

                {activeField.type === "text" && activeField.role === "candidate" && (
                  <div className="space-y-3 rounded-md border bg-slate-50 p-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <input
                        type="checkbox"
                        checked={Boolean(activeField.multiline)}
                        onChange={(event) => updateField(activeField.id, {
                          multiline: event.target.checked,
                          height: event.target.checked ? Math.max(activeField.height, 0.14) : activeField.height,
                        })}
                      />
                      Multiline response
                    </label>
                    <div className="space-y-2">
                      <Label>Candidate placeholder</Label>
                      <Textarea
                        value={activeField.placeholder || ""}
                        onChange={(event) => updateField(activeField.id, { placeholder: event.target.value })}
                        placeholder="Type your response here"
                        className="min-h-20 bg-white"
                      />
                    </div>
                    <p className="text-xs leading-5 text-slate-500">Use multiline for paragraphs, notes, or dotted-line response areas. The candidate will see a textarea, and the stamped PDF will wrap text inside this field.</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {(["x", "y", "width", "height"] as const).map((key) => (
                    <div key={key} className="space-y-2">
                      <Label>{key}</Label>
                      <Input type="number" step="0.001" min="0" max="1" value={activeField[key]} onChange={(event) => updateFieldRect(activeField.id, { [key]: Number(event.target.value) })} />
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <Label>Page</Label>
                  <Input
                    type="number"
                    min="1"
                    max={previewPageCount}
                    value={activeField.page}
                    onChange={(event) => {
                      const nextPage = Math.max(1, Math.min(Number(event.target.value) || 1, previewPageCount));
                      updateField(activeField.id, { page: nextPage });
                      setPreviewPage(nextPage);
                    }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" onClick={() => addField("internal")}>Add internal</Button>
                  <Button type="button" variant="destructive" onClick={() => removeField(activeField.id)}>Remove</Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Add or select a field.</p>
            )}

            <div className="mt-6 border-t pt-4">
              <Button asChild variant="outline" className="w-full">
                <Link href="/people-transitions/new">Use in transition</Link>
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
