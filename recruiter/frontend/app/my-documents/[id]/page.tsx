"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ClipboardList, Download, FileSignature, Loader2, PenLine } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ProgressRail, StatusPill } from "@/components/candidate-portal/candidate-ui";
import { useCandidateBrand } from "@/lib/candidate-portal/use-candidate-brand";
import { getMySigningEnvelope, type MySigningDocument, type MySigningEnvelope } from "@/services/onboardingService";

function signerQuery(signerKey?: string) {
  return signerKey ? `?signer=${encodeURIComponent(signerKey)}` : "";
}

function documentComplete(document: MySigningDocument) {
  return document.status === "completed" || document.status === "signed";
}

function documentHref(envelopeId: string, document: MySigningDocument, signerKey?: string) {
  const action = documentComplete(document) ? "download" : "sign";
  return `/my-documents/${envelopeId}/documents/${document._id}/${action}${signerQuery(signerKey)}`;
}

function documentAction(document: MySigningDocument, canSign: boolean) {
  if (documentComplete(document)) return { label: "Download", icon: Download, disabled: false };
  if (!canSign) return { label: "Waiting", icon: FileSignature, disabled: true };
  if (document.actionType === "document_fill") return { label: "Fill document", icon: ClipboardList, disabled: false };
  if (document.actionType === "document_review") return { label: "Review document", icon: ClipboardList, disabled: false };
  return { label: "Review and sign", icon: PenLine, disabled: false };
}

function documentRequirementLabel(document: MySigningDocument) {
  const fields = document.signatureFields || [];
  const requiresSignature = fields.some((field) => field.type === "signature");
  const fieldCount = fields.filter((field) => field.type === "text" || field.type === "image").length;
  if (documentComplete(document)) return "Completed copy available";
  if (requiresSignature && fieldCount) return `${fieldCount} field${fieldCount === 1 ? "" : "s"} and signature`;
  if (requiresSignature) return "Signature required";
  if (fieldCount) return `${fieldCount} field${fieldCount === 1 ? "" : "s"} to complete`;
  return "Review required";
}

export default function MyDocumentPacketPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const signerKey = searchParams.get("signer") || "";
  const brand = useCandidateBrand();
  const [envelope, setEnvelope] = useState<MySigningEnvelope | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const result = await getMySigningEnvelope(params.id, signerKey);
        if (!cancelled) setEnvelope(result);
      } catch (error: any) {
        if (!cancelled) toast.error(error.message || "Could not load document packet");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [params.id, signerKey]);

  const progress = useMemo(() => {
    const documents = envelope?.documents || [];
    const completed = documents.filter(documentComplete).length;
    return {
      completed,
      total: documents.length,
      percent: documents.length ? Math.round((completed / documents.length) * 100) : 0,
    };
  }, [envelope]);

  const pendingDocuments = useMemo(() => (envelope?.documents || []).filter((document) => !documentComplete(document)), [envelope]);
  const canSign = Boolean(envelope?.canSign && envelope.signer.role === "internal");

  return (
    <main className={`min-h-[calc(100vh-76px)] bg-gradient-to-br ${brand.softGradientClass}`}>
      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Link href="/my-documents" className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to My Documents
        </Link>

        {loading && (
          <div className="mt-5 rounded-md border border-border bg-white p-5 text-sm text-muted-foreground shadow-sm">
            <Loader2 className={`mr-2 inline h-4 w-4 animate-spin ${brand.accentTextClass}`} />
            Loading packet...
          </div>
        )}

        {!loading && !envelope && (
          <div className="mt-5 rounded-md border border-border bg-white shadow-sm">
            <EmptyState brand={brand} title="Packet not found" description="This packet may be unavailable or not assigned to your staff account." />
          </div>
        )}

        {!loading && envelope && (
          <>
            <div className="mt-5 rounded-md border border-border bg-white p-5 shadow-sm sm:p-6">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div>
                  <div className={`text-sm font-semibold ${brand.accentTextClass}`}>
                    {envelope.organization?.name || brand.organizationName}
                  </div>
                  <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{envelope.title}</h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {envelope.message || "Complete each document assigned to you. Final copies remain available in My Documents."}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-muted p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-foreground">Packet status</span>
                    <StatusPill status={envelope.status} />
                  </div>
                  <div className="mt-4">
                    <ProgressRail brand={brand} value={progress.percent} />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {progress.completed} of {progress.total} assigned document(s) complete.
                  </p>
                </div>
              </div>
            </div>

            {!canSign && envelope.signer.status !== "signed" && (
              <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm">
                This packet is waiting for an earlier signer before your step opens.
              </div>
            )}

            {envelope.signer.status === "signed" && (
              <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 shadow-sm">
                Your signing step is complete. You can still open assigned documents for reference.
              </div>
            )}

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-5">
                {pendingDocuments.length > 0 && (
                  <section className="rounded-md border border-border bg-white p-5 shadow-sm">
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">Documents waiting for you</h2>
                      <p className="mt-1 text-sm text-muted-foreground">Complete these before returning to the full packet list.</p>
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-2">
                      {pendingDocuments.map((document) => {
                        const action = documentAction(document, canSign);
                        const Icon = action.icon;
                        const content = (
                          <>
                            <div className="flex items-start gap-3">
                              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${brand.accentBgClass} ${brand.accentTextClass}`}>
                                <Icon className="h-4 w-4" />
                              </span>
                              <span className="min-w-0">
                                <span className="block font-semibold text-foreground">{document.title}</span>
                                <span className="mt-1 block text-sm text-muted-foreground">{documentRequirementLabel(document)}</span>
                              </span>
                            </div>
                            <span className={`mt-4 inline-flex items-center gap-2 text-sm font-semibold ${action.disabled ? "text-[#9A8CC7]" : brand.accentTextClass}`}>
                              {action.label} {!action.disabled && <ArrowRight className="h-4 w-4" />}
                            </span>
                          </>
                        );

                        return action.disabled ? (
                          <div key={document._id} className="rounded-md border border-border bg-muted/40 p-4 opacity-80">
                            {content}
                          </div>
                        ) : (
                          <Link key={document._id} href={documentHref(envelope._id, document, signerKey || envelope.signer.key)} className="rounded-md border border-border bg-muted/40 p-4 hover:bg-white">
                            {content}
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section className="overflow-hidden rounded-md border border-border bg-white shadow-sm">
                  <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-foreground">Packet documents</h2>
                      <p className="mt-1 text-sm text-muted-foreground">Only documents and fields assigned to you are shown here.</p>
                    </div>
                    <StatusPill status={envelope.signer.status} />
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-left text-sm">
                      <thead className="bg-muted text-xs text-[#4C5569]">
                        <tr>
                          <th className="px-5 py-3 font-semibold">Document</th>
                          <th className="px-5 py-3 font-semibold">Fields</th>
                          <th className="px-5 py-3 font-semibold">Status</th>
                          <th className="px-5 py-3 text-right font-semibold">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {envelope.documents.map((document) => {
                          const action = documentAction(document, canSign);
                          const Icon = action.icon;
                          const complete = documentComplete(document);
                          return (
                            <tr key={document._id} className="hover:bg-muted/40">
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                                    {complete ? <Check className="h-5 w-5 text-emerald-700" /> : <FileSignature className={`h-5 w-5 ${brand.accentTextClass}`} />}
                                  </div>
                                  <div>
                                    <div className="font-semibold text-foreground">{document.title}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">{documentRequirementLabel(document)}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 py-4 text-muted-foreground">{document.signatureFields?.length || 0}</td>
                              <td className="px-5 py-4"><StatusPill status={complete ? "completed" : document.status} /></td>
                              <td className="px-5 py-4 text-right">
                                {action.disabled ? (
                                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#9A8CC7]">
                                    <Icon className="h-4 w-4" />
                                    {action.label}
                                  </span>
                                ) : (
                                  <Link href={documentHref(envelope._id, document, signerKey || envelope.signer.key)} className={`inline-flex items-center gap-2 text-sm font-semibold ${brand.accentTextClass}`}>
                                    <Icon className="h-4 w-4" />
                                    {action.label}
                                    <ArrowRight className="h-4 w-4" />
                                  </Link>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <aside className="h-fit space-y-4 xl:sticky xl:top-24">
                <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <FileSignature className={`h-4 w-4 ${brand.accentTextClass}`} />
                    Your signing status
                  </div>
                  <div className="mt-4 space-y-4 text-sm">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">Signer</div>
                      <div className="mt-1 font-semibold text-foreground">{envelope.signer.name || envelope.signer.email}</div>
                      <div className="text-muted-foreground">{envelope.signer.email}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground">Current step</div>
                      <div className="mt-1"><StatusPill status={envelope.signer.status || "pending"} /></div>
                    </div>
                  </div>
                </section>
              </aside>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
