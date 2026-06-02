"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Eye, Plus, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PdfDocumentPreview } from "@/components/onboarding/pdf-document-preview";
import { OnboardingStatusBadge } from "@/components/onboarding/status-badge";
import {
  getEnvelopeDocumentPreviewBlob,
  getOnboarding,
  revealFormSubmission,
  retryOnboardingHandoff,
  reviewFormSubmission,
  type CandidateOnboarding,
  type OnboardingAuditEvent,
  type OnboardingEnvelopeDocument,
  type OnboardingFormSubmission,
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
  const [selectedReviewKey, setSelectedReviewKey] = useState("");
  const [reviewBlob, setReviewBlob] = useState<Blob | null>(null);
  const [revealedForms, setRevealedForms] = useState<Record<string, OnboardingFormSubmission>>({});
  const [reviewingFormId, setReviewingFormId] = useState("");
  const [retryingHandoff, setRetryingHandoff] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewReloadKey, setReviewReloadKey] = useState(0);

  async function load() {
    try {
      const onboardingResult = await getOnboarding(params.id);
      setOnboarding(onboardingResult.data);
      setEvents(onboardingResult.events || []);
    } catch (error: any) {
      toast.error(error.message || "Failed to load onboarding");
    }
  }

  async function revealSubmission(formId: string) {
    try {
      const revealed = await revealFormSubmission(formId);
      setRevealedForms((current) => ({ ...current, [formId]: revealed }));
      toast.success("Sensitive values revealed for this session");
    } catch (error: any) {
      toast.error(error.message || "Failed to reveal form values");
    }
  }

  async function reviewSubmission(formId: string, decision: "approved" | "rejected") {
    try {
      setReviewingFormId(formId);
      await reviewFormSubmission(formId, decision);
      toast.success(decision === "approved" ? "Form approved" : "Form sent back to candidate");
      setRevealedForms((current) => {
        const next = { ...current };
        delete next[formId];
        return next;
      });
      await load();
    } catch (error: any) {
      toast.error(error.message || "Failed to review form");
    } finally {
      setReviewingFormId("");
    }
  }

  async function retryHandoff() {
    try {
      setRetryingHandoff(true);
      await retryOnboardingHandoff(params.id);
      toast.success("Handoff retry completed");
      await load();
    } catch (error: any) {
      toast.error(error.message || "Failed to retry handoff");
    } finally {
      setRetryingHandoff(false);
    }
  }

  useEffect(() => {
    load();
  }, [params.id]);

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

        <main className="space-y-5">
            <section className="rounded-md border bg-white">
              <div className="border-b p-4">
                <h2 className="text-lg font-semibold text-slate-950">Timeline</h2>
                <p className="text-sm text-slate-500">Workflow items for forms, signatures, HR review, and completion handoff.</p>
              </div>
              <div className="divide-y">
                {(onboarding.workflowItems || []).length === 0 ? (
                  <div className="p-6 text-sm text-slate-500">No workflow items have been created.</div>
                ) : (onboarding.workflowItems || []).map((item) => (
                  <div key={item._id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-medium text-slate-950">{item.title}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {item.type} item owned by {item.ownerType}
                        {item.dueAt ? ` · due ${new Date(item.dueAt).toLocaleDateString()}` : ""}
                      </div>
                    </div>
                    <OnboardingStatusBadge status={item.status} />
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-md border bg-white">
              <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Candidate forms</h2>
                  <p className="text-sm text-slate-500">Masked by default. Revealing sensitive values is audited.</p>
                </div>
                {(onboarding.handoffs || []).some((handoff) => handoff.status === "failed") && (
                  <Button type="button" variant="outline" onClick={retryHandoff} disabled={retryingHandoff}>
                    <ArrowRight className="h-4 w-4" />
                    {retryingHandoff ? "Retrying..." : "Retry handoff"}
                  </Button>
                )}
              </div>
              <div className="divide-y">
                {(onboarding.forms || []).length === 0 ? (
                  <div className="p-6 text-sm text-slate-500">No candidate forms have been assigned.</div>
                ) : (onboarding.forms || []).map((form) => {
                  const visibleForm = revealedForms[form._id] || form;
                  return (
                    <div key={form._id} className="p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <ShieldCheck className="h-4 w-4 text-emerald-700" />
                            <h3 className="font-semibold text-slate-950">{form.title}</h3>
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
                            {form.hasSensitiveValues ? "Contains encrypted fields" : "No sensitive fields"} · {form.values?.length || 0} fields
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <OnboardingStatusBadge status={form.status} />
                          {form.hasSensitiveValues && (
                            <Button type="button" size="sm" variant="outline" onClick={() => revealSubmission(form._id)}>
                              <Eye className="h-4 w-4" />
                              Reveal
                            </Button>
                          )}
                          {form.status === "under_review" && (
                            <>
                              <Button type="button" size="sm" onClick={() => reviewSubmission(form._id, "approved")} disabled={reviewingFormId === form._id}>
                                <CheckCircle2 className="h-4 w-4" />
                                Approve
                              </Button>
                              <Button type="button" size="sm" variant="outline" onClick={() => reviewSubmission(form._id, "rejected")} disabled={reviewingFormId === form._id}>
                                <XCircle className="h-4 w-4" />
                                Reject
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="mt-4 overflow-hidden rounded-md border">
                        <table className="w-full min-w-[720px] text-sm">
                          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                            <tr>
                              <th className="px-3 py-2 font-semibold">Field</th>
                              <th className="px-3 py-2 font-semibold">Value</th>
                              <th className="px-3 py-2 font-semibold">Security</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {(visibleForm.values || []).map((value) => (
                              <tr key={value.key}>
                                <td className="px-3 py-2 font-medium text-slate-900">{value.label}</td>
                                <td className="px-3 py-2 text-slate-600">
                                  {value.revealedValue !== undefined ? String(value.revealedValue) : value.valuePreview || String(value.value || "") || "Not provided"}
                                </td>
                                <td className="px-3 py-2 text-slate-500">{value.sensitive ? "Encrypted" : "Standard"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

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
      </div>
    </div>
  );
}
