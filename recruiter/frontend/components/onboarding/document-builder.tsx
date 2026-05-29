"use client";

import { useMemo, useState } from "react";
import {
  AlignLeft,
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
import { Badge } from "@/components/ui/badge";
import type { BuilderBlock, OnboardingDocument } from "@/services/onboardingService";

type BlockType = BuilderBlock["type"];

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

function makeBlock(type: BlockType): BuilderBlock {
  const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  if (type === "heading") return { id, type, content: { text: "Document heading" } };
  if (type === "section") return { id, type, content: { title: "Section title", text: "Section content" } };
  if (type === "table") return { id, type, content: { rows: [["Label", "Value"], ["Candidate", "{{candidate.name}}"]] } };
  if (type === "signature") return { id, type, content: { label: "Candidate signature" } };
  if (type === "logo") return { id, type, content: { text: "{{organization.name}}", alt: "Company logo" } };
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
    { id: "signature-default", type: "signature", content: { label: "Candidate signature" } },
  ];
}

function PreviewBlock({ block }: { block: BuilderBlock }) {
  if (block.type === "pageBreak") {
    return <div className="my-5 border-t border-dashed border-slate-300 pt-3 text-xs uppercase tracking-wide text-slate-400">Page break</div>;
  }
  if (block.type === "heading") {
    return <h2 className="text-2xl font-semibold text-slate-950">{block.content?.text || "Heading"}</h2>;
  }
  if (block.type === "section") {
    return (
      <section className="space-y-2 border-l-2 border-slate-200 pl-4">
        <h3 className="text-base font-semibold text-slate-900">{block.content?.title || "Section"}</h3>
        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{block.content?.text || ""}</p>
      </section>
    );
  }
  if (block.type === "table") {
    const rows = Array.isArray(block.content?.rows) ? block.content.rows : [];
    return (
      <table className="w-full border-collapse text-sm">
        <tbody>
          {rows.map((row: string[], index: number) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border border-slate-200 px-3 py-2 text-slate-700">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (block.type === "signature") {
    return (
      <div className="space-y-2 pt-4">
        <div className="h-12 w-72 border-b border-slate-500" />
        <p className="text-xs text-slate-500">{block.content?.label || "Signature"}</p>
      </div>
    );
  }
  if (block.type === "logo") {
    return <div className="inline-flex h-12 items-center border border-slate-200 px-4 text-sm font-semibold text-slate-700">{block.content?.text || "Logo"}</div>;
  }
  return <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{block.content?.text || ""}</p>;
}

export function DocumentBuilder({ initialDocument, saving = false, onSave }: DocumentBuilderProps) {
  const [title, setTitle] = useState(initialDocument?.title || "New onboarding document");
  const [description, setDescription] = useState(initialDocument?.description || "");
  const [blocks, setBlocks] = useState<BuilderBlock[]>(
    initialDocument?.builderBlocks?.length ? initialDocument.builderBlocks : defaultBlocks(initialDocument?.title || "New onboarding document")
  );
  const [activeBlockId, setActiveBlockId] = useState(blocks[0]?.id || "");

  const activeBlock = useMemo(() => blocks.find((block) => block.id === activeBlockId) || blocks[0], [activeBlockId, blocks]);

  const updateBlock = (blockId: string, updater: (block: BuilderBlock) => BuilderBlock) => {
    setBlocks((current) => current.map((block) => (block.id === blockId ? updater(block) : block)));
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

  const addBlock = (type: BlockType) => {
    const block = makeBlock(type);
    setBlocks((current) => [...current, block]);
    setActiveBlockId(block.id);
  };

  const removeBlock = (blockId: string) => {
    setBlocks((current) => current.filter((block) => block.id !== blockId));
    if (activeBlockId === blockId) setActiveBlockId(blocks[0]?.id || "");
  };

  const save = async () => {
    await onSave({
      title,
      description,
      builderBlocks: blocks,
      variables: {},
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
                <Button key={item.type} type="button" variant="outline" className="justify-start" onClick={() => addBlock(item.type)}>
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Button>
              ))}
            </div>
            <div className="mt-5 space-y-2">
              <div className="text-xs font-semibold uppercase text-slate-500">Variables</div>
              <div className="flex flex-wrap gap-2">
                {variables.map((variable) => (
                  <Badge key={variable} variant="secondary" className="font-mono text-[11px]">{variable}</Badge>
                ))}
              </div>
            </div>
          </aside>

          <main className="min-h-[720px] rounded-md border bg-white p-4 shadow-sm">
            <div className="mx-auto min-h-[680px] max-w-[780px] space-y-6 border border-slate-200 bg-white px-10 py-12 shadow-sm">
              {blocks.map((block) => (
                <button
                  key={block.id}
                  type="button"
                  onClick={() => setActiveBlockId(block.id)}
                  className={`block w-full rounded-md border p-3 text-left transition ${activeBlockId === block.id ? "border-blue-400 bg-blue-50/50" : "border-transparent hover:border-slate-200"}`}
                >
                  <PreviewBlock block={block} />
                </button>
              ))}
            </div>
          </main>

          <aside className="rounded-md border bg-white p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">Block settings</p>
                <p className="text-xs text-slate-500">{activeBlock?.type || "No block selected"}</p>
              </div>
              {activeBlock && <GripVertical className="h-4 w-4 text-slate-400" />}
            </div>

            {activeBlock ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => moveBlock(activeBlock.id, -1)}>Move up</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => moveBlock(activeBlock.id, 1)}>Move down</Button>
                </div>

                <div className="space-y-2">
                  <Label>Block type</Label>
                  <Select value={activeBlock.type} onValueChange={(value: BlockType) => updateBlock(activeBlock.id, (block) => ({ ...block, type: value }))}>
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

                {activeBlock.type !== "pageBreak" && activeBlock.type !== "table" && (
                  <div className="space-y-2">
                    <Label>{activeBlock.type === "signature" ? "Label" : "Content"}</Label>
                    <Textarea
                      className="min-h-40"
                      value={activeBlock.type === "section" ? activeBlock.content?.text || "" : activeBlock.content?.text || activeBlock.content?.label || ""}
                      onChange={(event) => updateBlock(activeBlock.id, (block) => ({
                        ...block,
                        content: activeBlock.type === "signature"
                          ? { ...block.content, label: event.target.value }
                          : { ...block.content, text: event.target.value },
                      }))}
                    />
                  </div>
                )}

                {activeBlock.type === "table" && (
                  <div className="space-y-2">
                    <Label>Rows JSON</Label>
                    <Textarea
                      className="min-h-44 font-mono text-xs"
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
