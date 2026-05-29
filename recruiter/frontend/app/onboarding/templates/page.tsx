"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, FileText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  createDocument,
  createDocumentTemplate,
  deleteDocumentTemplate,
  getDocumentTemplates,
  type OnboardingDocumentTemplate,
} from "@/services/onboardingService";
import { toast } from "sonner";

export default function OnboardingTemplatesPage() {
  const [templates, setTemplates] = useState<OnboardingDocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    category: "custom",
    description: "",
  });

  async function load() {
    try {
      setLoading(true);
      setTemplates(await getDocumentTemplates());
    } catch (error: any) {
      toast.error(error.message || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createTemplate() {
    if (!form.name.trim()) return toast.error("Template name is required");
    try {
      setSaving(true);
      await createDocumentTemplate(form);
      setForm({ name: "", category: "custom", description: "" });
      toast.success("Template created");
      await load();
    } catch (error: any) {
      toast.error(error.message || "Failed to create template");
    } finally {
      setSaving(false);
    }
  }

  async function useTemplate(template: OnboardingDocumentTemplate) {
    try {
      const document = await createDocument({
        title: template.name,
        description: template.description,
        templateId: template._id,
      });
      toast.success("Document created from template");
      window.location.href = `/onboarding/documents/${document._id}/edit`;
    } catch (error: any) {
      toast.error(error.message || "Failed to use template");
    }
  }

  async function removeTemplate(template: OnboardingDocumentTemplate) {
    if (!window.confirm(`Delete ${template.name}?`)) return;
    try {
      await deleteDocumentTemplate(template._id);
      toast.success("Template deleted");
      await load();
    } catch (error: any) {
      toast.error(error.message || "Failed to delete template");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-screen-2xl px-4 py-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Document templates</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">Manage reusable onboarding templates. Default templates can be copied into editable documents.</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/onboarding/documents">
              <FileText className="h-4 w-4" />
              Document library
            </Link>
          </Button>
        </div>

        <section className="mb-6 rounded-md border bg-white p-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_220px_1fr_auto] lg:items-end">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Template name" />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(category) => setForm((current) => ({ ...current, category }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="offer">Offer</SelectItem>
                  <SelectItem value="nda">NDA</SelectItem>
                  <SelectItem value="privacy">Privacy</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                  <SelectItem value="agreement">Agreement</SelectItem>
                  <SelectItem value="checklist">Checklist</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="min-h-10" />
            </div>
            <Button onClick={createTemplate} disabled={saving}>
              <Plus className="h-4 w-4" />
              {saving ? "Creating..." : "Create"}
            </Button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading ? (
            <div className="text-sm text-slate-500">Loading templates...</div>
          ) : templates.map((template) => (
            <article key={template._id} className="rounded-md border bg-white p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-950">{template.name}</h2>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-500">{template.description}</p>
                </div>
                <Badge variant="secondary" className="capitalize">{template.category}</Badge>
              </div>
              <div className="mb-4 flex flex-wrap gap-2 text-xs text-slate-500">
                {template.isDefault && <Badge variant="outline">Default</Badge>}
                {template.isSystem && <Badge variant="outline">System</Badge>}
                <Badge variant="outline">{template.signatureFields?.length || 0} fields</Badge>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => useTemplate(template)}>
                  <Copy className="h-4 w-4" />
                  Use template
                </Button>
                {!template.isSystem && (
                  <Button size="sm" variant="outline" onClick={() => removeTemplate(template)}>
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                )}
              </div>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
