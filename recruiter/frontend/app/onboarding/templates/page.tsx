"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, Copy, FileText, PackageCheck, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  createDocument,
  createDocumentTemplate,
  createOnboardingFormTemplate,
  createPacketTemplate,
  deleteDocumentTemplate,
  getDocuments,
  getDocumentTemplates,
  getOnboardingFormTemplates,
  getPacketTemplates,
  type OnboardingDocumentTemplate,
  type OnboardingDocument,
  type OnboardingFormTemplate,
  type OnboardingPacketTemplate,
  type ProcessType,
} from "@/services/onboardingService";
import { toast } from "sonner";

type WorkflowItemDraft = NonNullable<OnboardingPacketTemplate["workflowItems"]>[number];

export default function OnboardingTemplatesPage() {
  const [templates, setTemplates] = useState<OnboardingDocumentTemplate[]>([]);
  const [packetTemplates, setPacketTemplates] = useState<OnboardingPacketTemplate[]>([]);
  const [formTemplates, setFormTemplates] = useState<OnboardingFormTemplate[]>([]);
  const [documents, setDocuments] = useState<OnboardingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [packetSaving, setPacketSaving] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    category: "custom",
    description: "",
  });
  const [packetForm, setPacketForm] = useState({
    name: "",
    description: "",
    documentIds: [] as string[],
    formTemplateIds: [] as string[],
  });
  const [customForm, setCustomForm] = useState({
    name: "",
    description: "",
  });
  const [processType, setProcessType] = useState<ProcessType>("onboarding");
  const [workflowItems, setWorkflowItems] = useState<WorkflowItemDraft[]>([]);

  function processLabel(value: ProcessType | string = "onboarding") {
    if (value === "exit") return "Exit";
    if (value === "retirement") return "Retirement";
    return "Onboarding";
  }

  function processWorkflowItems(value: ProcessType) {
    const label = processLabel(value).toLowerCase();
    if (value === "exit") {
      return [
        { id: "exit-form", type: "form", title: "Complete exit details", ownerType: "candidate", dueOffsetDays: 1, order: 10, required: true },
        { id: "exit-documents", type: "document", title: "Review and sign exit documents", ownerType: "candidate", dueOffsetDays: 2, order: 20, required: true },
        { id: "exit-hr-review", type: "approval", title: "HR review exit information", ownerType: "user", defaultOwnerRole: "hr", dueOffsetDays: 3, order: 30, required: true, dependencyKeys: ["exit-form"] },
        { id: "exit-manager-handover", type: "task", title: "Manager handover", ownerType: "user", defaultOwnerRole: "manager", dueOffsetDays: 3, order: 40, required: true, dependencyKeys: ["exit-form", "exit-documents", "exit-hr-review"], metadata: { handoffTarget: "manager_handover" } },
        { id: "exit-asset-return", type: "task", title: "Asset and property return", ownerType: "user", defaultOwnerRole: "facilities", dueOffsetDays: 3, order: 50, required: true, dependencyKeys: ["exit-form", "exit-documents", "exit-hr-review"], metadata: { handoffTarget: "asset_return" } },
        { id: "exit-it-access-removal", type: "task", title: "IT access removal", ownerType: "user", defaultOwnerRole: "it", dueOffsetDays: 3, order: 60, required: true, dependencyKeys: ["exit-form", "exit-documents", "exit-hr-review"], metadata: { handoffTarget: "it_access_removal" } },
        { id: "exit-payroll-finalization", type: "task", title: "Payroll finalization", ownerType: "user", defaultOwnerRole: "payroll", dueOffsetDays: 3, order: 70, required: true, dependencyKeys: ["exit-form", "exit-documents", "exit-hr-review"], metadata: { handoffTarget: "payroll_finalization" } },
        { id: "exit-closeout", type: "handoff", title: "Complete exit closeout", ownerType: "system", dueOffsetDays: 3, order: 80, required: true, dependencyKeys: ["exit-manager-handover", "exit-asset-return", "exit-it-access-removal", "exit-payroll-finalization"], metadata: { handoffTarget: "exit_closeout" } },
      ] as WorkflowItemDraft[];
    }
    if (value === "retirement") {
      return [
        { id: "retirement-form", type: "form", title: "Complete retirement details", ownerType: "candidate", dueOffsetDays: 2, order: 10, required: true },
        { id: "retirement-documents", type: "document", title: "Review and sign retirement documents", ownerType: "candidate", dueOffsetDays: 3, order: 20, required: true },
        { id: "retirement-hr-review", type: "approval", title: "HR review retirement information", ownerType: "user", defaultOwnerRole: "hr", dueOffsetDays: 5, order: 30, required: true, dependencyKeys: ["retirement-form"] },
        { id: "retirement-benefits-review", type: "task", title: "Benefits and payroll review", ownerType: "user", defaultOwnerRole: "payroll", dueOffsetDays: 7, order: 40, required: true, dependencyKeys: ["retirement-form", "retirement-documents", "retirement-hr-review"], metadata: { handoffTarget: "payroll_finalization" } },
        { id: "retirement-closeout", type: "handoff", title: "Complete retirement closeout", ownerType: "system", dueOffsetDays: 7, order: 50, required: true, dependencyKeys: ["retirement-benefits-review"], metadata: { handoffTarget: "retirement_closeout" } },
      ] as WorkflowItemDraft[];
    }
    return [
      { id: `${value}-forms`, type: "form", title: `Complete ${label} details`, ownerType: "candidate", dueOffsetDays: 2, order: 10, required: true },
      { id: `${value}-documents`, type: "document", title: `Review and sign ${label} documents`, ownerType: "candidate", dueOffsetDays: 3, order: 20, required: true },
      { id: `${value}-review`, type: "approval", title: `HR review ${label} information`, ownerType: "user", defaultOwnerRole: "hr", dueOffsetDays: 5, order: 30, required: true, dependencyKeys: [`${value}-forms`] },
      { id: `${value}-handoff`, type: "handoff", title: `Complete ${label} closeout`, ownerType: "system", dueOffsetDays: 7, order: 40, required: true, dependencyKeys: [`${value}-documents`, `${value}-review`], metadata: { handoffTarget: "internal_employee_profile" } },
    ] as WorkflowItemDraft[];
  }

  function updateWorkflowItem(index: number, updates: Partial<WorkflowItemDraft>) {
    setWorkflowItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...updates } : item));
  }

  function addWorkflowItem() {
    const nextOrder = workflowItems.length ? Math.max(...workflowItems.map((item) => Number(item.order || 0))) + 10 : 10;
    setWorkflowItems((current) => [
      ...current,
      {
        id: `${processType}-task-${Date.now()}`,
        type: "task",
        title: "Internal task",
        ownerType: "user",
        defaultOwnerRole: "hr",
        dueOffsetDays: processType === "exit" ? 3 : 7,
        order: nextOrder,
        required: true,
        dependencyKeys: [],
      },
    ]);
  }

  function removeWorkflowItem(index: number) {
    setWorkflowItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function load() {
    try {
      setLoading(true);
      const [documentTemplatesResult, packetTemplatesResult, formTemplatesResult, documentsResult] = await Promise.all([
        getDocumentTemplates(),
        getPacketTemplates(processType),
        getOnboardingFormTemplates(),
        getDocuments(),
      ]);
      setTemplates(documentTemplatesResult);
      setPacketTemplates(packetTemplatesResult);
      setFormTemplates(formTemplatesResult);
      setDocuments(documentsResult.filter((document) => document.status !== "archived"));
    } catch (error: any) {
      toast.error(error.message || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }

  function togglePacketDocument(id: string) {
    setPacketForm((current) => ({
      ...current,
      documentIds: current.documentIds.includes(id)
        ? current.documentIds.filter((item) => item !== id)
        : [...current.documentIds, id],
    }));
  }

  function togglePacketFormTemplate(id: string) {
    setPacketForm((current) => ({
      ...current,
      formTemplateIds: current.formTemplateIds.includes(id)
        ? current.formTemplateIds.filter((item) => item !== id)
        : [...current.formTemplateIds, id],
    }));
  }

  async function createPacket() {
    if (!packetForm.name.trim()) return toast.error("Packet template name is required");
    try {
      setPacketSaving(true);
      await createPacketTemplate({
        name: packetForm.name,
        description: packetForm.description,
        processType,
        documents: packetForm.documentIds,
        formTemplates: packetForm.formTemplateIds,
        workflowItems,
        reminderRules: [{ name: "Candidate reminder", targetType: "candidate", delayHours: 24, repeatEveryHours: 48 }],
        completionActions: [{ target: processType === "exit" ? "exit_closeout" : processType === "retirement" ? "retirement_closeout" : "internal_employee_profile" }],
      });
      setPacketForm({ name: "", description: "", documentIds: [], formTemplateIds: [] });
      setWorkflowItems(processWorkflowItems(processType));
      toast.success("Packet template created");
      await load();
    } catch (error: any) {
      toast.error(error.message || "Failed to create packet template");
    } finally {
      setPacketSaving(false);
    }
  }

  async function createFormTemplate() {
    if (!customForm.name.trim()) return toast.error("Form template name is required");
    try {
      setFormSaving(true);
      await createOnboardingFormTemplate({
        name: customForm.name,
        description: customForm.description,
        category: "custom",
        fields: [
          { id: "legal-name", key: "legalName", label: "Legal name", type: "text", required: true, order: 10 },
          { id: "address", key: "address", label: "Address", type: "address", required: true, order: 20 },
          { id: "custom-field", key: "customField", label: "Custom field", type: "text", order: 30 },
        ],
      });
      setCustomForm({ name: "", description: "" });
      toast.success("Form template created");
      await load();
    } catch (error: any) {
      toast.error(error.message || "Failed to create form template");
    } finally {
      setFormSaving(false);
    }
  }

  useEffect(() => {
    load();
    setWorkflowItems(processWorkflowItems(processType));
  }, [processType]);

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
      window.location.href = `/people-transitions/documents/${document._id}/edit`;
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
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Transition templates</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">Manage reusable document, form, and packet templates for onboarding, exit, and retirement.</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/people-transitions/documents">
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

        <section className="mb-6 rounded-md border bg-white p-4">
          <div className="mb-4 flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-slate-600" />
            <h2 className="text-lg font-semibold text-slate-950">Packet templates</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Process</Label>
                  <Select value={processType} onValueChange={(value) => setProcessType(value as ProcessType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="onboarding">Onboarding</SelectItem>
                      <SelectItem value="exit">Exit</SelectItem>
                      <SelectItem value="retirement">Retirement</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={packetForm.name} onChange={(event) => setPacketForm((current) => ({ ...current, name: event.target.value }))} placeholder={`${processLabel(processType)} packet`} />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input value={packetForm.description} onChange={(event) => setPacketForm((current) => ({ ...current, description: event.target.value }))} placeholder="Reusable packet details" />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border p-3">
                  <div className="mb-2 text-sm font-semibold text-slate-950">Documents</div>
                  <div className="max-h-44 space-y-2 overflow-auto text-sm">
                    {documents.map((document) => (
                      <label key={document._id} className="flex items-center gap-2">
                        <input type="checkbox" checked={packetForm.documentIds.includes(document._id)} onChange={() => togglePacketDocument(document._id)} />
                        <span>{document.title}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="mb-2 text-sm font-semibold text-slate-950">Forms</div>
                  <div className="max-h-44 space-y-2 overflow-auto text-sm">
                    {formTemplates.map((template) => (
                      <label key={template._id} className="flex items-center gap-2">
                        <input type="checkbox" checked={packetForm.formTemplateIds.includes(template._id)} onChange={() => togglePacketFormTemplate(template._id)} />
                        <span>{template.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-950">Workflow</div>
                    <div className="text-xs text-slate-500">Text fields in prepared documents are candidate-fillable; name, email, and date fields are auto-filled when the candidate completes or signs.</div>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addWorkflowItem}>
                    <Plus className="h-4 w-4" />
                    Add item
                  </Button>
                </div>
                <div className="max-h-80 overflow-auto">
                  <table className="w-full min-w-[860px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-2 py-2">Key</th>
                        <th className="px-2 py-2">Title</th>
                        <th className="px-2 py-2">Type</th>
                        <th className="px-2 py-2">Owner</th>
                        <th className="px-2 py-2">Role</th>
                        <th className="px-2 py-2">Due</th>
                        <th className="px-2 py-2">Depends on</th>
                        <th className="px-2 py-2">Req</th>
                        <th className="px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {workflowItems.map((item, index) => (
                        <tr key={`${item.id}-${index}`}>
                          <td className="px-2 py-2">
                            <Input value={item.id} onChange={(event) => updateWorkflowItem(index, { id: event.target.value })} className="h-8 min-w-32" />
                          </td>
                          <td className="px-2 py-2">
                            <Input value={item.title} onChange={(event) => updateWorkflowItem(index, { title: event.target.value })} className="h-8 min-w-44" />
                          </td>
                          <td className="px-2 py-2">
                            <select
                              value={item.type}
                              onChange={(event) => updateWorkflowItem(index, { type: event.target.value as WorkflowItemDraft["type"] })}
                              className="h-8 rounded-md border border-slate-300 bg-white px-2"
                            >
                              <option value="form">form</option>
                              <option value="document">document</option>
                              <option value="task">task</option>
                              <option value="approval">approval</option>
                              <option value="handoff">handoff</option>
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <select
                              value={item.ownerType || "candidate"}
                              onChange={(event) => updateWorkflowItem(index, { ownerType: event.target.value as WorkflowItemDraft["ownerType"] })}
                              className="h-8 rounded-md border border-slate-300 bg-white px-2"
                            >
                              <option value="candidate">candidate</option>
                              <option value="user">user</option>
                              <option value="system">system</option>
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <Input value={item.defaultOwnerRole || ""} onChange={(event) => updateWorkflowItem(index, { defaultOwnerRole: event.target.value })} className="h-8 min-w-24" placeholder="hr" />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              type="number"
                              min={0}
                              value={item.dueOffsetDays ?? ""}
                              onChange={(event) => updateWorkflowItem(index, { dueOffsetDays: Number(event.target.value || 0) })}
                              className="h-8 w-20"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <Input
                              value={(item.dependencyKeys || []).join(", ")}
                              onChange={(event) => updateWorkflowItem(index, {
                                dependencyKeys: event.target.value.split(",").map((value) => value.trim()).filter(Boolean),
                              })}
                              className="h-8 min-w-40"
                              placeholder="item-key"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={item.required !== false}
                              onChange={(event) => updateWorkflowItem(index, { required: event.target.checked })}
                            />
                          </td>
                          <td className="px-2 py-2 text-right">
                            <Button type="button" variant="ghost" size="sm" onClick={() => removeWorkflowItem(index)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <Button onClick={createPacket} disabled={packetSaving}>
                <Plus className="h-4 w-4" />
                {packetSaving ? "Creating..." : "Create packet"}
              </Button>
            </div>
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Template</th>
                    <th className="px-3 py-2">Process</th>
                    <th className="px-3 py-2">Documents</th>
                    <th className="px-3 py-2">Forms</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {packetTemplates.length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-5 text-center text-slate-500">No packet templates yet.</td></tr>
                  ) : packetTemplates.map((template) => (
                    <tr key={template._id}>
                      <td className="px-3 py-2 font-medium text-slate-950">{template.name}</td>
                      <td className="px-3 py-2 text-slate-600">{processLabel(template.processType)}</td>
                      <td className="px-3 py-2 text-slate-600">{template.documents?.length || 0}</td>
                      <td className="px-3 py-2 text-slate-600">{template.formTemplates?.length || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="mb-6 rounded-md border bg-white p-4">
          <div className="mb-4 flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-slate-600" />
            <h2 className="text-lg font-semibold text-slate-950">Form templates</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={customForm.name} onChange={(event) => setCustomForm((current) => ({ ...current, name: event.target.value }))} placeholder="Custom transition form" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={customForm.description} onChange={(event) => setCustomForm((current) => ({ ...current, description: event.target.value }))} />
              </div>
              <Button onClick={createFormTemplate} disabled={formSaving}>
                <Plus className="h-4 w-4" />
                {formSaving ? "Creating..." : "Create form"}
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {formTemplates.map((template) => (
                <article key={template._id} className="rounded-md border p-3">
                  <div className="font-semibold text-slate-950">{template.name}</div>
                  <div className="mt-1 text-sm text-slate-500">{template.fields?.length || 0} fields · v{template.version}</div>
                  {template.isSystem && <Badge variant="outline" className="mt-2">System</Badge>}
                </article>
              ))}
            </div>
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
