"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, ClipboardList, Download, FileSignature, Files, Loader2, PenLine } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, MetricCard, StatusPill } from "@/components/candidate-portal/candidate-ui";
import { useCandidateBrand } from "@/lib/candidate-portal/use-candidate-brand";
import {
  getMySigningDocuments,
  type InternalSigningQueueItem,
  type MySigningDocuments,
} from "@/services/onboardingService";

const emptyDocuments: MySigningDocuments = {
  pending: [],
  signed: [],
};

type DocumentRow = {
  packet: InternalSigningQueueItem;
  document: InternalSigningQueueItem["documents"][number];
  mode: "pending" | "signed";
};

function signerQuery(signerKey?: string) {
  return signerKey ? `?signer=${encodeURIComponent(signerKey)}` : "";
}

function packetHref(item: InternalSigningQueueItem) {
  return `/my-documents/${item._id}${signerQuery(item.signer.key)}`;
}

function documentHref(row: DocumentRow) {
  const suffix = signerQuery(row.packet.signer.key);
  const action = documentComplete(row.document) ? "download" : "sign";
  return `/my-documents/${row.packet._id}/documents/${row.document._id}/${action}${suffix}`;
}

function documentComplete(document: InternalSigningQueueItem["documents"][number]) {
  return document.status === "completed" || document.status === "signed";
}

function documentAction(row: DocumentRow) {
  if (documentComplete(row.document)) {
    return { label: "Download", icon: Download };
  }
  const fillOnly = row.document.assignedFieldCount > 0 && row.document.assignedFieldCount === 1;
  return {
    label: fillOnly ? "Fill document" : "Review and sign",
    icon: fillOnly ? ClipboardList : PenLine,
  };
}

function documentRequirementLabel(document: InternalSigningQueueItem["documents"][number]) {
  const count = document.assignedFieldCount || 0;
  if (documentComplete(document)) return "Completed copy available";
  if (count > 0) return `${count} assigned field${count === 1 ? "" : "s"} to complete`;
  return "Review required";
}

function processLabel(item: InternalSigningQueueItem) {
  if (item.processType === "team_signing") return "Team signing";
  if (item.processType === "compliance_documents") return "Compliance documents";
  if (item.processType === "exit") return "Exit";
  if (item.processType === "retirement") return "Retirement";
  return "Onboarding";
}

export default function MyDocumentsPage() {
  const brand = useCandidateBrand();
  const [documents, setDocuments] = useState<MySigningDocuments>(emptyDocuments);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setLoading(true);
        const data = await getMySigningDocuments(100);
        if (mounted) setDocuments(data);
      } catch (error: any) {
        if (mounted) toast.error(error.message || "Failed to load documents");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const rows = useMemo<DocumentRow[]>(() => {
    const pending = documents.pending.flatMap((packet) =>
      packet.documents.map((document) => ({ packet, document, mode: "pending" as const })),
    );
    const signed = documents.signed.flatMap((packet) =>
      packet.documents.map((document) => ({ packet, document, mode: "signed" as const })),
    );
    return [...pending, ...signed];
  }, [documents]);

  const pendingRows = useMemo(() => rows.filter((row) => !documentComplete(row.document) && row.mode === "pending"), [rows]);
  const signedRows = useMemo(() => rows.filter((row) => documentComplete(row.document) || row.mode === "signed"), [rows]);

  return (
    <main className={`min-h-[calc(100vh-76px)] bg-gradient-to-br ${brand.softGradientClass}`}>
      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">My Documents</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Open documents assigned to you for signing, download completed PDFs, and track your packet status.
            </p>
          </div>
          <Link href="/dashboard" className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-foreground hover:bg-muted">
            Back to dashboard
          </Link>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <MetricCard icon={<FileSignature className="h-5 w-5" />} label="Documents shared" value={rows.length} tone="blue" />
          <MetricCard icon={<PenLine className="h-5 w-5" />} label="Need your action" value={pendingRows.length} tone="amber" />
          <MetricCard icon={<CheckCircle2 className="h-5 w-5" />} label="Completed documents" value={signedRows.length} tone="emerald" />
        </div>

        {loading ? (
          <div className="mt-6 rounded-md border border-border bg-white p-6 text-sm text-muted-foreground shadow-sm">
            <Loader2 className={`mr-2 inline h-4 w-4 animate-spin ${brand.accentTextClass}`} />
            Loading documents...
          </div>
        ) : (
          <>
            {pendingRows.length > 0 && (
              <section className="mt-6 rounded-md border border-border bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Documents waiting for you</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Start here to complete the documents that still need your input.</p>
                  </div>
                  <span className={`w-fit rounded-md px-2.5 py-1 text-xs font-semibold ${brand.accentBgClass} ${brand.accentTextClass}`}>
                    {pendingRows.length} pending
                  </span>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {pendingRows.slice(0, 4).map((row) => {
                    const action = documentAction(row);
                    const Icon = action.icon;
                    return (
                      <Link
                        key={`pending-${row.packet._id}-${row.document._id}`}
                        href={documentHref(row)}
                        className="flex flex-col justify-between rounded-md border border-border bg-muted/40 p-4 hover:bg-white"
                      >
                        <div className="flex items-start gap-3">
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${brand.accentBgClass} ${brand.accentTextClass}`}>
                            <Icon className="h-5 w-5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block font-semibold text-foreground">{row.document.title}</span>
                            <span className="mt-1 block text-sm text-muted-foreground">{documentRequirementLabel(row.document)}</span>
                            <span className="mt-2 block text-xs text-muted-foreground">{row.packet.title}</span>
                          </span>
                        </div>
                        <span className={`mt-4 inline-flex items-center gap-2 text-sm font-semibold ${brand.accentTextClass}`}>
                          {action.label} <ArrowRight className="h-4 w-4" />
                        </span>
                      </Link>
                    );
                  })}
                </div>

                {pendingRows.length > 4 && (
                  <p className="mt-3 text-sm text-muted-foreground">{pendingRows.length - 4} more pending document(s) are listed in the library below.</p>
                )}
              </section>
            )}

            <div className="mt-6 overflow-hidden rounded-md border border-border bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Document library</h2>
                  <p className="mt-1 text-sm text-muted-foreground">All signing packets assigned to your staff account.</p>
                </div>
              </div>

              {rows.length === 0 ? (
                <EmptyState brand={brand} title="No documents yet" description="Documents assigned to you for signing will appear here." />
              ) : (
                <div className="max-h-[620px] overflow-auto">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="sticky top-0 bg-muted text-xs text-[#4C5569]">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Document</th>
                        <th className="px-5 py-3 font-semibold">Process</th>
                        <th className="px-5 py-3 font-semibold">Packet</th>
                        <th className="px-5 py-3 font-semibold">Fields</th>
                        <th className="px-5 py-3 font-semibold">Status</th>
                        <th className="px-5 py-3 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {rows.map((row) => {
                        const action = documentAction(row);
                        const Icon = action.icon;
                        return (
                          <tr key={`${row.mode}-${row.packet._id}-${row.document._id}`} className="hover:bg-muted/40">
                            <td className="px-5 py-4">
                              <div className="font-semibold text-foreground">{row.document.title}</div>
                              <Link href={packetHref(row.packet)} className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${brand.accentTextClass}`}>
                                View packet <ArrowRight className="h-3.5 w-3.5" />
                              </Link>
                            </td>
                            <td className="px-5 py-4 text-muted-foreground">{processLabel(row.packet)}</td>
                            <td className="px-5 py-4 text-muted-foreground">{row.packet.title}</td>
                            <td className="px-5 py-4 text-muted-foreground">{row.document.assignedFieldCount || 0}</td>
                            <td className="px-5 py-4"><StatusPill status={documentComplete(row.document) ? "completed" : row.document.status} /></td>
                            <td className="px-5 py-4 text-right">
                              <Link href={documentHref(row)} className={`inline-flex items-center gap-2 text-sm font-semibold ${brand.accentTextClass}`}>
                                <Icon className="h-4 w-4" />
                                {action.label}
                                <ArrowRight className="h-4 w-4" />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
