"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, Download, FileSignature, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/candidate-portal/candidate-ui";
import { useCandidateBrand } from "@/lib/candidate-portal/use-candidate-brand";
import { getMySigningEnvelope, type MySigningDocument, type MySigningEnvelope } from "@/services/onboardingService";

function signerQuery(signerKey?: string) {
  return signerKey ? `?signer=${encodeURIComponent(signerKey)}` : "";
}

function packetHref(envelopeId: string, signerKey?: string) {
  return `/my-documents/${envelopeId}${signerQuery(signerKey)}`;
}

function documentSignHref(envelopeId: string, documentId: string, signerKey?: string) {
  return `/my-documents/${envelopeId}/documents/${documentId}/sign${signerQuery(signerKey)}`;
}

function documentDownloadHref(envelopeId: string, documentId: string, signerKey?: string) {
  return `/my-documents/${envelopeId}/documents/${documentId}/download${signerQuery(signerKey)}`;
}

function documentComplete(document?: MySigningDocument | null) {
  return document?.status === "completed" || document?.status === "signed";
}

export default function MyDocumentCompletePage() {
  const params = useParams<{ id: string; documentId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const signerKey = searchParams.get("signer") || "";
  const brand = useCandidateBrand();
  const [envelope, setEnvelope] = useState<MySigningEnvelope | null>(null);
  const [document, setDocument] = useState<MySigningDocument | null>(null);
  const [loading, setLoading] = useState(true);

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

  const nextDocument = useMemo(() => {
    if (!envelope || !document || !envelope.canSign) return null;
    const currentIndex = envelope.documents.findIndex((item) => item._id === document._id);
    const ordered = currentIndex >= 0
      ? [...envelope.documents.slice(currentIndex + 1), ...envelope.documents.slice(0, currentIndex)]
      : envelope.documents;
    return ordered.find((item) => !documentComplete(item) && item.actionType);
  }, [document, envelope]);

  const effectiveSignerKey = signerKey || envelope?.signer.key || "";
  const completionMessage = nextDocument
    ? "This document is complete. Continue to the next document in the packet."
    : documentComplete(document)
      ? "The document is complete and ready to download."
      : document?.actionType === "document_fill"
        ? "Your document fields have been recorded. The packet may still require another signer before the final PDF is available."
        : "Your signature has been recorded. The packet may still require another signer before the final PDF is available.";

  return (
    <main className={`min-h-[calc(100vh-76px)] bg-gradient-to-br ${brand.softGradientClass}`}>
      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {loading && (
          <div className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
            <Loader2 className={`mr-2 inline h-4 w-4 animate-spin ${brand.accentTextClass}`} />
            Checking document status...
          </div>
        )}

        {!loading && document && envelope && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="rounded-md border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-emerald-50">
                <CheckCircle2 className="h-8 w-8 text-emerald-700" />
              </div>
              <h1 className="mt-4 text-3xl font-semibold text-slate-950">Document completed</h1>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">{completionMessage}</p>

              <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4 text-left">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <FileSignature className={`h-5 w-5 ${brand.accentTextClass}`} />
                    <div>
                      <div className="font-medium text-slate-950">{document.title}</div>
                      <div className="text-sm capitalize text-slate-600">{document.status}</div>
                    </div>
                  </div>
                  <StatusPill status={document.status} />
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <Link href={packetHref(envelope._id, effectiveSignerKey)} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  <ArrowLeft className="h-4 w-4" />
                  View packet
                </Link>
                <Link
                  href={documentDownloadHref(envelope._id, document._id, effectiveSignerKey)}
                  className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold ${nextDocument ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50" : `text-white ${brand.primaryButtonClass}`}`}
                >
                  <Download className="h-4 w-4" />
                  Download copy
                </Link>
                {nextDocument && (
                  <Link href={documentSignHref(envelope._id, nextDocument._id, effectiveSignerKey)} className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white ${brand.primaryButtonClass}`}>
                    Next document
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </section>

            <aside className="hidden h-fit lg:sticky lg:top-24 lg:block">
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
                    const active = item._id === document._id;
                    const done = documentComplete(item);
                    return (
                      <li key={item._id}>
                        <Link
                          href={done ? documentDownloadHref(envelope._id, item._id, effectiveSignerKey) : documentSignHref(envelope._id, item._id, effectiveSignerKey)}
                          className={`flex w-full items-start gap-3 rounded-md border p-3 text-left transition ${active ? "border-primary bg-muted" : "border-border bg-white hover:bg-muted"}`}
                        >
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-sm font-semibold ${done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-white text-muted-foreground"}`}>
                            {done ? <CheckCircle2 className="h-4 w-4" /> : <FileSignature className="h-4 w-4" />}
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
