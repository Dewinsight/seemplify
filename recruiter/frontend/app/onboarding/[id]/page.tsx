"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FileText, Plus, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PdfDocumentPreview } from "@/components/onboarding/pdf-document-preview";
import { OnboardingStatusBadge } from "@/components/onboarding/status-badge";
import {
  createEnvelope,
  getDocuments,
  getEnvelopeDocumentPreviewBlob,
  getOnboarding,
  sendEnvelope,
  type CandidateOnboarding,
  type OnboardingAuditEvent,
  type OnboardingDocument,
  type OnboardingEnvelopeDocument,
} from "@/services/onboardingService";
import { toast } from "sonner";

type SignedReviewDocument = {
  key: string;
  envelopeId: string;
  envelopeTitle: string;
  document: OnboardingEnvelopeDocument;
};

function candidateName(onboarding?: CandidateOnboarding | null) {
  const candidate = onboarding?.candidate || {};
  return `${candidate.firstName || ""} ${candidate.lastName || ""}`.trim() || candidate.email || "Candidate";
}

export default function OnboardingWorkspacePage() {
  const params = useParams<{ id: string }>();
  const [onboarding, setOnboarding] = useState<CandidateOnboarding | null>(null);
  const [events, setEvents] = useState<OnboardingAuditEvent[]>([]);
  const [documents, setDocuments] = useState<OnboardingDocument[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [selectedReviewKey, setSelectedReviewKey] = useState("");
  const [reviewBlob, setReviewBlob] = useState<Blob | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewReloadKey, setReviewReloadKey] = useState(0);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [sendNow, setSendNow] = useState(true);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const [onboardingResult, documentResult] = await Promise.all([
        getOnboarding(params.id),
        getDocuments(),
      ]);
      setOnboarding(onboardingResult.data);
      setEvents(onboardingResult.events || []);
      setDocuments(documentResult);
    } catch (error: any) {
      toast.error(error.message || "Failed to load onboarding");
    }
  }

  useEffect(() => {
    load();
  }, [params.id]);

  const selectedDocuments = useMemo(
    () => documents.filter((document) => selectedDocumentIds.includes(document._id)),
    [documents, selectedDocumentIds]
  );
  const signedReviewDocuments = useMemo<SignedReviewDocument[]>(() => {
    return (onboarding?.envelopes || []).flatMap((envelope) =>
      (envelope.documents || [])
        .filter((document) =>
          Boolean(document.signedPdf?.url || document.signedPdf?.downloadUrl) ||
          ["signed", "completed"].includes(document.status)
        )
        .map((document) => ({
          key: `${envelope._id}:${document._id}`,
          envelopeId: envelope._id,
          envelopeTitle: envelope.title,
          document,
        }))
    );
  }, [onboarding?.envelopes]);
  const selectedReviewDocument = signedReviewDocuments.find((item) => item.key === selectedReviewKey) || signedReviewDocuments[0];

  useEffect(() => {
    if (signedReviewDocuments.length === 0) {
      setSelectedReviewKey("");
      return;
    }

    if (!signedReviewDocuments.some((item) => item.key === selectedReviewKey)) {
      setSelectedReviewKey(signedReviewDocuments[0].key);
    }
  }, [signedReviewDocuments, selectedReviewKey]);

  useEffect(() => {
    if (!selectedReviewDocument) {
      setReviewBlob(null);
      return;
    }

    let cancelled = false;

    async function loadReviewDocument() {
      try {
        setReviewLoading(true);
        setReviewError("");
        const blob = await getEnvelopeDocumentPreviewBlob(selectedReviewDocument!.envelopeId, selectedReviewDocument!.document._id);
        if (!cancelled) setReviewBlob(blob);
      } catch (error: any) {
        if (!cancelled) {
          setReviewBlob(null);
          setReviewError(error.message || "Failed to load signed document");
        }
      } finally {
        if (!cancelled) setReviewLoading(false);
      }
    }

    loadReviewDocument();
    return () => {
      cancelled = true;
    };
  }, [selectedReviewDocument?.envelopeId, selectedReviewDocument?.document._id, reviewReloadKey]);

  function toggleDocument(id: string) {
    setSelectedDocumentIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function createPacket() {
    if (!onboarding) return;
    if (selectedDocumentIds.length === 0) return toast.error("Select at least one document");
    try {
      setCreating(true);
      const envelope = await createEnvelope({
        onboardingId: onboarding._id,
        documentIds: selectedDocumentIds,
        title: title.trim() || `${candidateName(onboarding)} onboarding packet`,
        message,
      });
      if (sendNow) await sendEnvelope(envelope._id);
      toast.success(sendNow ? "Packet created and sent" : "Packet draft created");
      window.location.href = `/onboarding/envelopes/${envelope._id}`;
    } catch (error: any) {
      toast.error(error.message || "Failed to create packet");
    } finally {
      setCreating(false);
    }
  }

  if (!onboarding) {
    return <div className="p-8 text-sm text-slate-500">Loading onboarding...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-screen-2xl px-4 py-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <OnboardingStatusBadge status={onboarding.status} />
              <span className="text-xs text-slate-500">{onboarding.candidate?.email}</span>
            </div>
            <h1 className="text-3xl font-semibold text-slate-950">{candidateName(onboarding)}</h1>
            <p className="mt-2 text-sm text-slate-600">{onboarding.title}</p>
          </div>
          {onboarding.portalInviteUrl && (
            <Button asChild variant="outline">
              <a href={onboarding.portalInviteUrl} target="_blank" rel="noreferrer">Open invite link</a>
            </Button>
          )}
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <main className="space-y-5">
            <section className="rounded-md border bg-white">
              <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Signed documents</h2>
                  <p className="text-sm text-slate-500">Review completed candidate documents without leaving Recruiter.</p>
                </div>
                {selectedReviewDocument && (
                  <Button type="button" variant="outline" onClick={() => setReviewReloadKey((key) => key + 1)} disabled={reviewLoading}>
                    <RefreshCw className={`h-4 w-4 ${reviewLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                )}
              </div>

              {signedReviewDocuments.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">No signed documents are ready for review yet.</div>
              ) : (
                <div className="grid lg:grid-cols-[340px_minmax(0,1fr)]">
                  <div className="max-h-[760px] overflow-y-auto border-b lg:border-b-0 lg:border-r">
                    {signedReviewDocuments.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setSelectedReviewKey(item.key)}
                        className={`flex w-full items-start justify-between gap-3 border-b p-4 text-left hover:bg-slate-50 ${selectedReviewDocument?.key === item.key ? "bg-slate-50" : ""}`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-950">{item.document.title}</div>
                          <div className="mt-1 truncate text-xs text-slate-500">{item.envelopeTitle}</div>
                          <div className="mt-2 text-xs text-slate-500">{item.document.signedAt ? new Date(item.document.signedAt).toLocaleString() : "Signed PDF available"}</div>
                        </div>
                        <OnboardingStatusBadge status={item.document.status} />
                      </button>
                    ))}
                  </div>
                  <div className="h-[760px]">
                    {reviewLoading ? (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading signed document...</div>
                    ) : reviewBlob && selectedReviewDocument ? (
                      <PdfDocumentPreview
                        blob={reviewBlob}
                        title={selectedReviewDocument.document.title}
                        emptyMessage="No signed document preview is available."
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-slate-500">
                        {reviewError || "Select a signed document to review."}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-md border bg-white">
              <div className="flex items-center justify-between border-b p-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Envelopes</h2>
                  <p className="text-sm text-slate-500">Signature packets created for this candidate.</p>
                </div>
                <Button asChild variant="outline">
                  <Link href="/onboarding/documents/new"><Plus className="h-4 w-4" /> New document</Link>
                </Button>
              </div>
              <div className="divide-y">
                {(onboarding.envelopes || []).length === 0 ? (
                  <div className="p-6 text-sm text-slate-500">No envelopes yet.</div>
                ) : (onboarding.envelopes || []).map((envelope) => (
                  <Link key={envelope._id} href={`/onboarding/envelopes/${envelope._id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50">
                    <div>
                      <div className="font-medium text-slate-950">{envelope.title}</div>
                      <div className="text-xs text-slate-500">{envelope.documents?.length || 0} documents · {new Date(envelope.createdAt).toLocaleString()}</div>
                    </div>
                    <OnboardingStatusBadge status={envelope.status} />
                  </Link>
                ))}
              </div>
            </section>

            <section className="rounded-md border bg-white">
              <div className="border-b p-4">
                <h2 className="text-lg font-semibold text-slate-950">Activity</h2>
              </div>
              <div className="divide-y">
                {events.length === 0 ? (
                  <div className="p-6 text-sm text-slate-500">No activity yet.</div>
                ) : events.map((event) => (
                  <div key={event._id} className="p-4">
                    <div className="text-sm font-medium text-slate-950">{event.action.replace(/_/g, " ")}</div>
                    <div className="text-xs text-slate-500">{event.actorEmail || event.actorType} · {new Date(event.createdAt).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </section>
          </main>

          <aside className="rounded-md border bg-white p-4">
            <h2 className="text-lg font-semibold text-slate-950">Create packet</h2>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Packet title</label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`${candidateName(onboarding)} onboarding packet`} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Message</label>
                <Textarea value={message} onChange={(event) => setMessage(event.target.value)} />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">Documents</div>
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {documents.map((document) => (
                    <button key={document._id} type="button" onClick={() => toggleDocument(document._id)} className="flex w-full items-center gap-3 rounded-md border p-3 text-left hover:bg-slate-50">
                      <Checkbox checked={selectedDocumentIds.includes(document._id)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{document.title}</div>
                        <div className="text-xs text-slate-500">{document.signatureFields?.length || 0} fields</div>
                      </div>
                      <FileText className="h-4 w-4 text-slate-400" />
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-3 rounded-md border p-3 text-sm">
                <Checkbox checked={sendNow} onCheckedChange={(checked) => setSendNow(Boolean(checked))} />
                Send immediately
              </label>
              <Button className="w-full" onClick={createPacket} disabled={creating || selectedDocuments.length === 0}>
                <Send className="h-4 w-4" />
                {creating ? "Creating..." : "Create packet"}
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
