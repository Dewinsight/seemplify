"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, Eraser, FileText, Mail, PenLine, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { OnboardingStatusBadge } from "@/components/onboarding/status-badge";
import { PdfDocumentPreview } from "@/components/onboarding/pdf-document-preview";
import { PdfPagePreview } from "@/components/onboarding/pdf-page-preview";
import {
  countersignEnvelope,
  getEnvelope,
  getEnvelopeAudit,
  getEnvelopeDocumentPreviewBlob,
  remindEnvelope,
  sendEnvelope,
  voidEnvelope,
  type OnboardingAuditEvent,
  type OnboardingEnvelope,
} from "@/services/onboardingService";
import { toast } from "sonner";

function SignaturePad({ onChange }: { onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawing, setDrawing] = useState(false);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const p = point(event);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    setDrawing(true);
    canvas.setPointerCapture(event.pointerId);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    onChange(canvas.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={720}
        height={220}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={() => setDrawing(false)}
        className="h-36 w-full touch-none rounded-md border bg-white"
      />
      <Button type="button" variant="outline" size="sm" onClick={clear}>
        <Eraser className="h-4 w-4" />
        Clear
      </Button>
    </div>
  );
}

function signerSelectValue(signer: { _id: string; key?: string }) {
  return signer.key || signer._id;
}

export default function OnboardingEnvelopePage() {
  const params = useParams<{ id: string }>();
  const [envelope, setEnvelope] = useState<OnboardingEnvelope | null>(null);
  const [audit, setAudit] = useState<OnboardingAuditEvent[]>([]);
  const [signature, setSignature] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [selectedSignerKey, setSelectedSignerKey] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageCount, setPreviewPageCount] = useState(1);
  const [previewPageSize, setPreviewPageSize] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [envelopeData, auditData] = await Promise.all([
        getEnvelope(params.id),
        getEnvelopeAudit(params.id),
      ]);
      setEnvelope(envelopeData);
      setAudit(auditData);
    } catch (error: any) {
      toast.error(error.message || "Failed to load envelope");
    }
  }

  useEffect(() => {
    load();
  }, [params.id]);

  useEffect(() => {
    if (!envelope) return;
    const pendingSigner = envelope.signers.find((signer) => signer.role === "internal" && ["pending", "viewed"].includes(signer.status));
    const firstDocument = envelope.documents[0];

    if (pendingSigner && !envelope.signers.some((signer) => signerSelectValue(signer) === selectedSignerKey)) {
      setSelectedSignerKey(signerSelectValue(pendingSigner));
    }
    if (firstDocument && !envelope.documents.some((document) => document._id === selectedDocumentId)) {
      setSelectedDocumentId(firstDocument._id);
      setPreviewPage(1);
    }
  }, [envelope, selectedDocumentId, selectedSignerKey]);

  useEffect(() => {
    if (!envelope?._id || !selectedDocumentId) {
      setPreviewBlob(null);
      return;
    }

    let cancelled = false;
    async function loadPreview() {
      try {
        setPreviewLoading(true);
        setPreviewError("");
        const blob = await getEnvelopeDocumentPreviewBlob(envelope!._id, selectedDocumentId);
        if (!cancelled) setPreviewBlob(blob);
      } catch (error: any) {
        if (!cancelled) {
          setPreviewBlob(null);
          setPreviewError(error.message || "Failed to load document preview");
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [envelope?._id, selectedDocumentId, envelope?.updatedAt, previewReloadKey]);

  const handlePreviewPageCount = useCallback((count: number) => {
    setPreviewPageCount(count);
    setPreviewPage((page) => Math.max(1, Math.min(page, count)));
  }, []);

  const handlePreviewPageRendered = useCallback((page: { width: number; height: number }) => {
    setPreviewPageSize({ width: page.width, height: page.height });
  }, []);

  async function action(label: string, run: () => Promise<any>) {
    try {
      setBusy(true);
      await run();
      toast.success(label);
      await load();
    } catch (error: any) {
      toast.error(error.message || label);
    } finally {
      setBusy(false);
    }
  }

  if (!envelope) {
    return <div className="p-8 text-sm text-slate-500">Loading envelope...</div>;
  }

  const pendingInternalSigners = envelope.signers?.filter((signer) => signer.role === "internal" && ["pending", "viewed"].includes(signer.status)) || [];
  const internalPending = pendingInternalSigners.length > 0;
  const selectedSigner = pendingInternalSigners.find((signer) => signerSelectValue(signer) === selectedSignerKey) || pendingInternalSigners[0];
  const selectedDocument = envelope.documents.find((document) => document._id === selectedDocumentId) || envelope.documents[0];
  const selectedDocumentIsSigned = Boolean(selectedDocument?.signedPdf?.url || selectedDocument?.signedPdf?.downloadUrl);
  const selectedSignerFields = selectedDocument?.signatureFields?.filter((field) =>
    field.page === previewPage &&
    (
      field.signerKey === selectedSigner?.key ||
      (!field.signerKey && field.role === "internal")
    )
  ) || [];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-screen-2xl px-4 py-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2"><OnboardingStatusBadge status={envelope.status} /></div>
            <h1 className="text-3xl font-semibold text-slate-950">{envelope.title}</h1>
            <p className="mt-2 text-sm text-slate-600">{envelope.message || "Signature packet"}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {envelope.status === "draft" && (
              <Button disabled={busy} onClick={() => action("Envelope sent", () => sendEnvelope(envelope._id))}>
                <Send className="h-4 w-4" />
                Send
              </Button>
            )}
            <Button disabled={busy} variant="outline" onClick={() => action("Reminder sent", () => remindEnvelope(envelope._id))}>
              <Mail className="h-4 w-4" />
              Remind
            </Button>
            <Button asChild variant="outline">
              <a href={`/api/people-transitions/envelopes/${envelope._id}/download`} target="_blank" rel="noreferrer">
                <Download className="h-4 w-4" />
                Download
              </a>
            </Button>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <main className="space-y-5">
            <section className="rounded-md border bg-white">
              <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Document review</h2>
                  <p className="text-sm text-slate-500">
                    {selectedDocumentIsSigned ? "Viewing the latest signed PDF stored for this candidate." : "Viewing the current immutable PDF snapshot."}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select
                    value={selectedDocument?._id || ""}
                    onValueChange={(value) => {
                      setSelectedDocumentId(value);
                      setPreviewPage(1);
                    }}
                  >
                    <SelectTrigger className="w-full sm:w-72">
                      <SelectValue placeholder="Select document" />
                    </SelectTrigger>
                    <SelectContent>
                      {envelope.documents.map((document) => (
                        <SelectItem key={document._id} value={document._id}>
                          {document.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" onClick={() => setPreviewReloadKey((key) => key + 1)} disabled={previewLoading}>
                    <RefreshCw className={`h-4 w-4 ${previewLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
              </div>
              <div className="h-[760px]">
                {previewLoading ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading document preview...</div>
                ) : previewBlob && selectedDocument ? (
                  <PdfDocumentPreview
                    blob={previewBlob}
                    title={selectedDocument.title}
                    emptyMessage="No signed PDF preview is available yet."
                  />
                ) : (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
                    {previewError || "No document is available to review yet."}
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-md border bg-white">
              <div className="border-b p-4">
                <h2 className="text-lg font-semibold text-slate-950">Documents</h2>
              </div>
              <div className="divide-y">
                {envelope.documents.map((document) => (
                  <div key={document._id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <FileText className="mt-1 h-5 w-5 text-slate-400" />
                      <div>
                        <div className="font-medium text-slate-950">{document.title}</div>
                        <div className="text-xs text-slate-500">{document.signatureFields?.length || 0} fields</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <OnboardingStatusBadge status={document.status} />
                      {(document.signedPdf?.url || document.pdfSnapshot?.url) && (
                        <Button
                          type="button"
                          size="sm"
                          variant={selectedDocument?._id === document._id ? "default" : "outline"}
                          onClick={() => {
                            setSelectedDocumentId(document._id);
                            setPreviewPage(1);
                          }}
                        >
                          {document.signedPdf?.url || document.signedPdf?.downloadUrl ? "View signed" : "Review"}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-md border bg-white">
              <div className="border-b p-4">
                <h2 className="text-lg font-semibold text-slate-950">Signers</h2>
              </div>
              <div className="divide-y">
                {envelope.signers.map((signer) => (
                  <div key={signer._id} className="flex items-center justify-between gap-4 p-4">
                    <div>
                      <div className="font-medium text-slate-950">{signer.name || signer.email}</div>
                      <div className="text-xs text-slate-500">{signer.email} · {signer.role} · order {signer.order}</div>
                    </div>
                    <OnboardingStatusBadge status={signer.status} />
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-md border bg-white">
              <div className="border-b p-4">
                <h2 className="text-lg font-semibold text-slate-950">Audit trail</h2>
              </div>
              <div className="divide-y">
                {audit.length === 0 ? (
                  <div className="p-4 text-sm text-slate-500">No audit events yet.</div>
                ) : audit.map((event) => (
                  <div key={event._id} className="p-4">
                    <div className="text-sm font-medium text-slate-950">{event.action.replace(/_/g, " ")}</div>
                    <div className="text-xs text-slate-500">{event.actorEmail || event.actorType} · {new Date(event.createdAt).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </section>
          </main>

          <aside className="space-y-5">
            {internalPending && (
              <section className="rounded-md border bg-white p-4">
                <h2 className="text-lg font-semibold text-slate-950">Internal signing</h2>
                <div className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Signer</label>
                    <Select value={selectedSigner ? signerSelectValue(selectedSigner) : ""} onValueChange={setSelectedSignerKey}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select signer" />
                      </SelectTrigger>
                      <SelectContent>
                        {pendingInternalSigners.map((signer) => (
                          <SelectItem key={signerSelectValue(signer)} value={signerSelectValue(signer)}>
                            {signer.name || signer.email} - order {signer.order}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Document preview</label>
                    <Select
                      value={selectedDocument?._id || ""}
                      onValueChange={(value) => {
                        setSelectedDocumentId(value);
                        setPreviewPage(1);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select document" />
                      </SelectTrigger>
                      <SelectContent>
                        {envelope.documents.map((document) => (
                          <SelectItem key={document._id} value={document._id}>
                            {document.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div
                    className="relative overflow-hidden rounded-md border bg-white"
                    style={{
                      aspectRatio: previewPageSize ? `${previewPageSize.width} / ${previewPageSize.height}` : "8.5 / 11",
                    }}
                  >
                    {previewLoading ? (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading document preview...</div>
                    ) : previewBlob && selectedDocument ? (
                      <>
                        <PdfPagePreview
                          blob={previewBlob}
                          title={selectedDocument.title}
                          pageNumber={previewPage}
                          onPageCount={handlePreviewPageCount}
                          onPageRendered={handlePreviewPageRendered}
                        />
                        <div className="pointer-events-none absolute inset-0">
                          {selectedSignerFields.map((field) => (
                            <div
                              key={field.id}
                              className="absolute rounded border border-slate-900/50 bg-slate-900/5 px-1 text-[10px] font-medium text-slate-900"
                              style={{
                                left: `${field.x * 100}%`,
                                top: `${field.y * 100}%`,
                                width: `${field.width * 100}%`,
                                height: `${field.height * 100}%`,
                              }}
                            >
                              <span className="truncate">{field.label || field.type}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-slate-500">
                        {previewError || "No document preview is available."}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={previewPage <= 1} onClick={() => setPreviewPage((page) => Math.max(1, page - 1))}>
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <span className="text-xs text-slate-500">Page {previewPage} of {previewPageCount}</span>
                    <Button type="button" variant="outline" size="sm" disabled={previewPage >= previewPageCount} onClick={() => setPreviewPage((page) => Math.min(previewPageCount, page + 1))}>
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>

                  <SignaturePad onChange={setSignature} />
                  <Button
                    className="w-full"
                    disabled={busy || !signature || !selectedSigner}
                    onClick={() => action("Envelope countersigned", async () => {
                      await countersignEnvelope(envelope._id, signature, selectedSigner?.key);
                      setSignature("");
                    })}
                  >
                    <PenLine className="h-4 w-4" />
                    Sign as {selectedSigner?.name || selectedSigner?.email || "internal signer"}
                  </Button>
                </div>
              </section>
            )}

            {envelope.status !== "voided" && envelope.status !== "completed" && (
              <section className="rounded-md border bg-white p-4">
                <h2 className="mb-3 text-lg font-semibold text-slate-950">Void envelope</h2>
                <Textarea value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="Reason" />
                <Button className="mt-3 w-full" variant="destructive" disabled={busy} onClick={() => action("Envelope voided", () => voidEnvelope(envelope._id, voidReason))}>
                  Void packet
                </Button>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
