"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download, ExternalLink, FileSignature, FileText, FileWarning, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/candidate-portal/candidate-ui";
import { PdfCanvasPreview } from "@/components/candidate-portal/pdf-canvas-preview";
import { useCandidateBrand } from "@/lib/candidate-portal/use-candidate-brand";
import {
  getMySigningDocumentDownloadBlob,
  getMySigningDocumentPreviewBlob,
  getMySigningEnvelope,
  type MySigningDocument,
  type MySigningEnvelope,
} from "@/services/onboardingService";

function signerQuery(signerKey?: string) {
  return signerKey ? `?signer=${encodeURIComponent(signerKey)}` : "";
}

function packetHref(envelopeId: string, signerKey?: string) {
  return `/my-documents/${envelopeId}${signerQuery(signerKey)}`;
}

function saveBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export default function MyDocumentDownloadPage() {
  const params = useParams<{ id: string; documentId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const signerKey = searchParams.get("signer") || "";
  const brand = useCandidateBrand();
  const [envelope, setEnvelope] = useState<MySigningEnvelope | null>(null);
  const [document, setDocument] = useState<MySigningDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEnvelope(null);
    setDocument(null);

    getMySigningEnvelope(params.id, signerKey)
      .then((loadedEnvelope) => {
        if (cancelled) return;
        const loadedDocument = loadedEnvelope.documents.find((item) => item._id === params.documentId);
        if (!loadedDocument) {
          toast.error("This document is not assigned to you");
          router.push(packetHref(params.id, signerKey));
          return;
        }
        setEnvelope(loadedEnvelope);
        setDocument(loadedDocument);
      })
      .catch((error) => {
        if (!cancelled) toast.error(error.message || "Failed to load document");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [params.id, params.documentId, router, signerKey]);

  useEffect(() => {
    if (!document) return;

    let objectUrl = "";
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError("");

    getMySigningDocumentPreviewBlob(params.id, params.documentId, signerKey)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewBlob(blob);
        setPreviewUrl(objectUrl);
      })
      .catch((error) => {
        if (cancelled) return;
        setPreviewBlob(null);
        setPreviewUrl("");
        setPreviewError(error.message || "Failed to load the PDF preview");
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [params.id, params.documentId, signerKey, document, previewReloadKey]);

  async function downloadCopy() {
    if (!document || !envelope) return;
    try {
      setDownloading(true);
      const { blob, fileName } = await getMySigningDocumentDownloadBlob(envelope._id, document._id, signerKey || envelope.signer.key, document.title);
      saveBlob(blob, fileName);
    } catch (error: any) {
      toast.error(error.message || "Could not download document");
    } finally {
      setDownloading(false);
    }
  }

  const effectiveSignerKey = signerKey || envelope?.signer.key || "";

  return (
    <main className={`min-h-[calc(100vh-76px)] bg-gradient-to-br ${brand.softGradientClass}`}>
      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Link href={packetHref(params.id, signerKey)} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" />
          Back to packet
        </Link>

        {loading && <div className="mt-5 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">Preparing document...</div>}

        {!loading && document && envelope && (
          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="min-h-[760px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h1 className="text-xl font-semibold text-slate-950">{document.title}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p className="text-sm text-slate-600">{envelope.title}</p>
                    <StatusPill status={document.status} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewReloadKey((value) => value + 1)}
                    disabled={previewLoading}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCw className={`h-4 w-4 ${previewLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => previewUrl && window.open(previewUrl, "_blank", "noopener,noreferrer")}
                    disabled={!previewUrl}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open PDF
                  </button>
                </div>
              </div>
              <div className="h-[760px] bg-slate-100">
                {previewLoading ? (
                  <div className="flex h-full items-center justify-center gap-3 p-6 text-sm text-slate-600">
                    <Loader2 className={`h-5 w-5 animate-spin ${brand.accentTextClass}`} />
                    Rendering PDF preview...
                  </div>
                ) : previewBlob ? (
                  <PdfCanvasPreview blob={previewBlob} title={document.title} />
                ) : previewError ? (
                  <div className="flex h-full items-center justify-center p-6">
                    <div className="max-w-md rounded-md border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-900">
                      <FileWarning className="mx-auto mb-3 h-8 w-8" />
                      <p className="font-semibold">The document preview could not be loaded.</p>
                      <p className="mt-2 leading-6">{previewError}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-600">
                    No PDF preview is available yet.
                  </div>
                )}
              </div>
            </section>

            <aside className="h-fit space-y-4 lg:sticky lg:top-24">
              <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                <FileText className={`h-9 w-9 ${brand.accentTextClass}`} />
                <h2 className="mt-4 text-xl font-semibold text-slate-950">Signed copy</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  This is the latest PDF available for the document. When signing is complete, the stamped signed PDF is shown here.
                </p>
                <button
                  type="button"
                  onClick={downloadCopy}
                  disabled={downloading}
                  className={`mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${brand.primaryButtonClass}`}
                >
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {downloading ? "Preparing PDF..." : "Download PDF"}
                </button>
              </section>

              <section className="rounded-md border border-border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Packet documents</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Assigned documents stay available here.</p>
                  </div>
                  <StatusPill status={envelope.signer.status} />
                </div>
                <ol className="mt-4 space-y-2">
                  {envelope.documents.map((item, index) => {
                    const complete = item.status === "completed" || item.status === "signed";
                    return (
                      <li key={item._id}>
                        <Link
                          href={complete ? `/my-documents/${envelope._id}/documents/${item._id}/download${signerQuery(effectiveSignerKey)}` : `/my-documents/${envelope._id}/documents/${item._id}/sign${signerQuery(effectiveSignerKey)}`}
                          className={`flex w-full items-start gap-3 rounded-md border p-3 text-left transition ${item._id === document._id ? "border-primary bg-muted" : "border-border bg-white hover:bg-muted"}`}
                        >
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-sm font-semibold ${complete ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-white text-muted-foreground"}`}>
                            <FileSignature className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-foreground">{index + 1}. {item.title}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">{item.signatureFields.length} assigned field{item.signatureFields.length === 1 ? "" : "s"}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </section>
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}
