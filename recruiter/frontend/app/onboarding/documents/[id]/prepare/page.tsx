"use client";

import { PointerEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CalendarDays, Download, Mail, Plus, Save, Signature, Type, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OnboardingStatusBadge } from "@/components/onboarding/status-badge";
import {
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
};

export default function PrepareOnboardingDocumentPage() {
  const params = useParams<{ id: string }>();
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [document, setDocument] = useState<OnboardingDocument | null>(null);
  const [fields, setFields] = useState<SignatureField[]>([]);
  const [activeFieldId, setActiveFieldId] = useState("");
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<{ id: string; dx: number; dy: number } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await getDocument(params.id);
        setDocument(data);
        setFields(data.signatureFields || []);
        setActiveFieldId(data.signatureFields?.[0]?.id || "");
      } catch (error: any) {
        toast.error(error.message || "Failed to load document");
      }
    }
    load();
  }, [params.id]);

  const activeField = fields.find((field) => field.id === activeFieldId);

  function addField(role: "candidate" | "internal" = "candidate") {
    const field = newSignatureField(role);
    setFields((current) => [...current, field]);
    setActiveFieldId(field.id);
  }

  function updateField(id: string, patch: Partial<SignatureField>) {
    setFields((current) => current.map((field) => (field.id === id ? { ...field, ...patch } : field)));
  }

  function removeField(id: string) {
    setFields((current) => current.filter((field) => field.id !== id));
    if (activeFieldId === id) setActiveFieldId(fields[0]?.id || "");
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, field: SignatureField) {
    const page = pageRef.current?.getBoundingClientRect();
    if (!page) return;
    const fieldLeft = field.x * page.width;
    const fieldTop = field.y * page.height;
    setDragging({
      id: field.id,
      dx: event.clientX - page.left - fieldLeft,
      dy: event.clientY - page.top - fieldTop,
    });
    setActiveFieldId(field.id);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const page = pageRef.current?.getBoundingClientRect();
    if (!page) return;
    const field = fields.find((item) => item.id === dragging.id);
    if (!field) return;
    const width = field.width;
    const height = field.height;
    const x = Math.max(0, Math.min(1 - width, (event.clientX - page.left - dragging.dx) / page.width));
    const y = Math.max(0, Math.min(1 - height, (event.clientY - page.top - dragging.dy) / page.height));
    updateField(dragging.id, { x, y });
  }

  async function saveFields() {
    if (!document) return;
    try {
      setSaving(true);
      const updated = await updateDocument(document._id, { signatureFields: fields });
      const rendered = await renderDocument(updated._id).catch(() => updated);
      setDocument(rendered);
      toast.success("Signature fields saved");
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
            <p className="mt-2 text-sm text-slate-600">Place signature fields using normalized coordinates. Drag a field on the page or edit exact values.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {document.pdfSnapshot?.url && (
              <Button asChild variant="outline">
                <a href={document.pdfSnapshot.downloadUrl || document.pdfSnapshot.url} target="_blank" rel="noreferrer">
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
            <div
              ref={pageRef}
              onPointerMove={onPointerMove}
              onPointerUp={() => setDragging(null)}
              className="relative mx-auto aspect-[8.5/11] max-h-[calc(100vh-180px)] w-full max-w-[720px] overflow-hidden border bg-white shadow-sm"
            >
              {document.pdfSnapshot?.url ? (
                <iframe title="Document preview" src={document.pdfSnapshot.url} className="h-full w-full" />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">Render the document to preview the PDF.</div>
              )}

              <div className="pointer-events-none absolute inset-0">
                {fields.map((field) => {
                  const Icon = fieldIcons[field.type] || Signature;
                  return (
                    <button
                      key={field.id}
                      type="button"
                      onPointerDown={(event) => onPointerDown(event, field)}
                      className={`pointer-events-auto absolute flex items-center gap-1 rounded border px-2 text-left text-[11px] font-medium shadow-sm ${activeFieldId === field.id ? "border-blue-500 bg-blue-50 text-blue-700" : "border-emerald-500 bg-emerald-50 text-emerald-700"}`}
                      style={{
                        left: `${field.x * 100}%`,
                        top: `${field.y * 100}%`,
                        width: `${field.width * 100}%`,
                        height: `${field.height * 100}%`,
                      }}
                    >
                      <Icon className="h-3 w-3" />
                      <span className="truncate">{field.label || field.type}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <aside className="rounded-md border bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Fields</h2>
                <p className="text-xs text-slate-500">{fields.length} placed</p>
              </div>
              <Button size="sm" onClick={() => addField("candidate")}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>

            <div className="mb-5 grid gap-2">
              {fields.map((field) => (
                <button key={field.id} type="button" onClick={() => setActiveFieldId(field.id)} className={`rounded-md border p-3 text-left text-sm ${activeFieldId === field.id ? "border-blue-300 bg-blue-50" : "hover:bg-slate-50"}`}>
                  <div className="font-medium text-slate-950">{field.label || field.type}</div>
                  <div className="text-xs text-slate-500">{field.role} · page {field.page}</div>
                </button>
              ))}
            </div>

            {activeField ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select value={activeField.role} onValueChange={(value: "candidate" | "internal") => updateField(activeField.id, { role: value })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="candidate">Candidate</SelectItem>
                        <SelectItem value="internal">Internal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={activeField.type} onValueChange={(value: SignatureField["type"]) => updateField(activeField.id, { type: value })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="signature">Signature</SelectItem>
                        <SelectItem value="date">Date</SelectItem>
                        <SelectItem value="name">Name</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="text">Text</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Label</Label>
                  <Input value={activeField.label || ""} onChange={(event) => updateField(activeField.id, { label: event.target.value })} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {(["x", "y", "width", "height"] as const).map((key) => (
                    <div key={key} className="space-y-2">
                      <Label>{key}</Label>
                      <Input type="number" step="0.01" min="0" max="1" value={activeField[key]} onChange={(event) => updateField(activeField.id, { [key]: Number(event.target.value) })} />
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <Label>Page</Label>
                  <Input type="number" min="1" value={activeField.page} onChange={(event) => updateField(activeField.id, { page: Number(event.target.value) || 1 })} />
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
                <Link href="/onboarding/new">Use in onboarding</Link>
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
