"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Download, Eraser, FileText, Mail, PenLine, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { OnboardingStatusBadge } from "@/components/onboarding/status-badge";
import {
  countersignEnvelope,
  getEnvelope,
  getEnvelopeAudit,
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

export default function OnboardingEnvelopePage() {
  const params = useParams<{ id: string }>();
  const [envelope, setEnvelope] = useState<OnboardingEnvelope | null>(null);
  const [audit, setAudit] = useState<OnboardingAuditEvent[]>([]);
  const [signature, setSignature] = useState("");
  const [voidReason, setVoidReason] = useState("");
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

  const internalPending = envelope.signers?.some((signer) => signer.role === "internal" && ["pending", "viewed"].includes(signer.status));

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
              <a href={`/api/onboarding/envelopes/${envelope._id}/download`} target="_blank" rel="noreferrer">
                <Download className="h-4 w-4" />
                Download
              </a>
            </Button>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <main className="space-y-5">
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
                        <Button asChild size="sm" variant="outline">
                          <a href={document.signedPdf?.downloadUrl || document.signedPdf?.url || document.pdfSnapshot?.downloadUrl || document.pdfSnapshot?.url} target="_blank" rel="noreferrer">Open</a>
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
                <h2 className="mb-3 text-lg font-semibold text-slate-950">Internal countersign</h2>
                <SignaturePad onChange={setSignature} />
                <Button className="mt-3 w-full" disabled={busy || !signature} onClick={() => action("Envelope countersigned", () => countersignEnvelope(envelope._id, signature))}>
                  <PenLine className="h-4 w-4" />
                  Countersign
                </Button>
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
