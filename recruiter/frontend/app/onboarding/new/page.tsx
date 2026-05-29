"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, FileText, Search, Send, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { OnboardingStatusBadge } from "@/components/onboarding/status-badge";
import { getCandidateById, getCandidatesPaginated, type CandidateData } from "@/services/candidateService";
import { createEnvelope, getDocuments, sendEnvelope, startOnboarding, type OnboardingDocument } from "@/services/onboardingService";
import { toast } from "sonner";

function candidateName(candidate: CandidateData) {
  return `${candidate.firstName || ""} ${candidate.lastName || ""}`.trim() || candidate.email || "Candidate";
}

function candidateStatus(candidate: CandidateData) {
  return (candidate.status || "Candidate").replace(/_/g, " ");
}

export default function NewOnboardingPage() {
  const searchParams = useSearchParams();
  const initialCandidateId = searchParams.get("candidateId") || "";
  const [step, setStep] = useState<"candidate" | "documents" | "send">("candidate");
  const [candidates, setCandidates] = useState<CandidateData[]>([]);
  const [documents, setDocuments] = useState<OnboardingDocument[]>([]);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateData | null>(null);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [internalSignerEmail, setInternalSignerEmail] = useState("");
  const [internalSignerName, setInternalSignerName] = useState("");
  const [sendingNow, setSendingNow] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [candidateResult, documentResult] = await Promise.all([
          getCandidatesPaginated({ page: 1, limit: 100, search: candidateSearch }),
          getDocuments(),
        ]);
        setCandidates(candidateResult.candidates || []);
        setDocuments(documentResult.filter((document) => document.status !== "archived"));
      } catch (error: any) {
        toast.error(error.message || "Failed to load onboarding data");
      }
    }
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [candidateSearch]);

  useEffect(() => {
    if (!initialCandidateId) return;
    async function loadCandidate() {
      try {
        const candidate = await getCandidateById(initialCandidateId);
        setSelectedCandidate(candidate);
        setCandidateSearch(candidateName(candidate));
        setStep("documents");
      } catch (error: any) {
        toast.error(error.message || "Failed to preselect candidate");
      }
    }
    loadCandidate();
  }, [initialCandidateId]);

  const selectedDocuments = useMemo(
    () => documents.filter((document) => selectedDocumentIds.includes(document._id)),
    [documents, selectedDocumentIds]
  );

  function toggleDocument(id: string) {
    setSelectedDocumentIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function submit() {
    if (!selectedCandidate) return toast.error("Select a candidate");
    try {
      setSubmitting(true);
      const onboardingResult = await startOnboarding(selectedCandidate._id, {
        title: title.trim() || `${candidateName(selectedCandidate)} onboarding`,
        notes,
      });

      if (selectedDocumentIds.length > 0) {
        const envelope = await createEnvelope({
          onboardingId: onboardingResult.data._id,
          documentIds: selectedDocumentIds,
          title: title.trim() || `${candidateName(selectedCandidate)} onboarding packet`,
          message,
          internalSigner: internalSignerEmail.trim()
            ? { email: internalSignerEmail.trim(), name: internalSignerName.trim() || internalSignerEmail.trim() }
            : undefined,
        });
        if (sendingNow) {
          await sendEnvelope(envelope._id);
        }
        toast.success(sendingNow ? "Onboarding started and sent" : "Onboarding draft created");
        window.location.href = `/onboarding/envelopes/${envelope._id}`;
        return;
      }

      toast.success("Onboarding started");
      window.location.href = `/onboarding/${onboardingResult.data._id}`;
    } catch (error: any) {
      toast.error(error.message || "Failed to start onboarding");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-screen-2xl px-4 py-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <Button asChild variant="ghost" className="-ml-3 mb-2">
              <Link href="/onboarding"><ArrowLeft className="h-4 w-4" /> Back</Link>
            </Button>
            <h1 className="text-3xl font-semibold text-slate-950">Begin onboarding</h1>
            <p className="mt-2 text-sm text-slate-600">Select a candidate, choose documents, and send a signing packet.</p>
          </div>
          <div className="hidden gap-2 md:flex">
            {(["candidate", "documents", "send"] as const).map((item, index) => (
              <button key={item} onClick={() => setStep(item)} className={`rounded-md border px-3 py-2 text-sm capitalize ${step === item ? "border-blue-500 bg-blue-50 text-blue-700" : "bg-white text-slate-600"}`}>
                {index + 1}. {item}
              </button>
            ))}
          </div>
        </div>

        {step === "candidate" && (
          <section className="rounded-md border bg-white">
            <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Candidate</h2>
                <p className="text-sm text-slate-500">Candidates stay external until they become organization members later.</p>
              </div>
              <div className="relative md:w-96">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Search candidates" className="pl-9" />
              </div>
            </div>
            <div className="p-4">
              <div className="h-[440px] overflow-auto rounded-md border">
                <table className="w-full min-w-[760px] caption-bottom text-sm">
                  <TableHeader className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                    <TableRow className="hover:bg-white">
                      <TableHead className="w-14">Select</TableHead>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-28 text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidates.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="h-40 text-center text-sm text-slate-500">
                          No candidates found.
                        </TableCell>
                      </TableRow>
                    ) : candidates.map((candidate) => {
                      const selected = selectedCandidate?._id === candidate._id;
                      return (
                        <TableRow
                          key={candidate._id}
                          aria-selected={selected}
                          data-state={selected ? "selected" : undefined}
                          onClick={() => setSelectedCandidate(candidate)}
                          className={`cursor-pointer ${selected ? "bg-blue-50 hover:bg-blue-50" : "hover:bg-slate-50"}`}
                        >
                          <TableCell>
                            <span className={`flex h-7 w-7 items-center justify-center rounded-full border ${selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-transparent"}`}>
                              <Check className="h-4 w-4" />
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-slate-950">{candidateName(candidate)}</div>
                          </TableCell>
                          <TableCell className="text-slate-600">{candidate.email || "-"}</TableCell>
                          <TableCell className="text-slate-600">{candidate.position || "-"}</TableCell>
                          <TableCell>
                            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium capitalize text-slate-600">
                              {candidateStatus(candidate)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant={selected ? "default" : "outline"}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedCandidate(candidate);
                              }}
                            >
                              {selected ? "Selected" : "Select"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </table>
              </div>
            </div>
            <div className="flex justify-end border-t p-4">
              <Button disabled={!selectedCandidate} onClick={() => setStep("documents")}>Continue</Button>
            </div>
          </section>
        )}

        {step === "documents" && (
          <section className="rounded-md border bg-white">
            <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Documents</h2>
                <p className="text-sm text-slate-500">Choose existing documents or create a new one before sending.</p>
              </div>
              <Button asChild variant="outline">
                <Link href="/onboarding/documents/new"><FileText className="h-4 w-4" /> Build document</Link>
              </Button>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {documents.map((document) => {
                const selected = selectedDocumentIds.includes(document._id);
                return (
                  <button key={document._id} type="button" onClick={() => toggleDocument(document._id)} className={`rounded-md border p-4 text-left ${selected ? "border-blue-500 bg-blue-50" : "bg-white hover:bg-slate-50"}`}>
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="font-semibold text-slate-950">{document.title}</div>
                      <Checkbox checked={selected} />
                    </div>
                    <div className="flex items-center gap-2">
                      <OnboardingStatusBadge status={document.status} />
                      <span className="text-xs text-slate-500">{document.signatureFields?.length || 0} fields</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between border-t p-4">
              <Button variant="outline" onClick={() => setStep("candidate")}>Back</Button>
              <Button onClick={() => setStep("send")}>Continue</Button>
            </div>
          </section>
        )}

        {step === "send" && (
          <section className="rounded-md border bg-white p-4">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Packet title</Label>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={selectedCandidate ? `${candidateName(selectedCandidate)} onboarding packet` : "Onboarding packet"} />
                </div>
                <div className="space-y-2">
                  <Label>Internal notes</Label>
                  <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-24" />
                </div>
                <div className="space-y-2">
                  <Label>Candidate message</Label>
                  <Textarea value={message} onChange={(event) => setMessage(event.target.value)} className="min-h-24" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Internal countersigner name</Label>
                    <Input value={internalSignerName} onChange={(event) => setInternalSignerName(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Internal countersigner email</Label>
                    <Input type="email" value={internalSignerEmail} onChange={(event) => setInternalSignerEmail(event.target.value)} />
                  </div>
                </div>
                <label className="flex items-center gap-3 rounded-md border p-3 text-sm">
                  <Checkbox checked={sendingNow} onCheckedChange={(checked) => setSendingNow(Boolean(checked))} />
                  Send the packet immediately after creating it
                </label>
              </div>

              <aside className="rounded-md border bg-slate-50 p-4">
                <h2 className="font-semibold text-slate-950">Summary</h2>
                <div className="mt-4 space-y-4 text-sm">
                  <div>
                    <div className="text-xs uppercase text-slate-500">Candidate</div>
                    <div className="font-medium text-slate-950">{selectedCandidate ? candidateName(selectedCandidate) : "Not selected"}</div>
                    <div className="text-slate-500">{selectedCandidate?.email}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-slate-500">Documents</div>
                    <div className="mt-2 space-y-2">
                      {selectedDocuments.length === 0 ? <p className="text-slate-500">No documents selected.</p> : selectedDocuments.map((document) => (
                        <div key={document._id} className="rounded border bg-white px-3 py-2">{document.title}</div>
                      ))}
                    </div>
                  </div>
                  <Button className="w-full" onClick={submit} disabled={submitting || !selectedCandidate}>
                    {sendingNow ? <Send className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                    {submitting ? "Creating..." : sendingNow ? "Create and send" : "Create draft"}
                  </Button>
                </div>
              </aside>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
