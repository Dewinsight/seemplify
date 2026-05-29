"use client"

import Link from "next/link"
import { MouseEvent, TouchEvent, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, Download, Eraser, PenLine } from "lucide-react"
import { toast } from "sonner"
import { getAccessToken, getDocument, signDocument } from "@/lib/api"
import type { CandidateDocumentPayload } from "@/lib/types"

export default function CandidateSignDocumentPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [payload, setPayload] = useState<CandidateDocumentPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [drawing, setDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login")
      return
    }

    getDocument(params.id)
      .then((result) => setPayload(result.data))
      .catch((error) => toast.error(error.message || "Failed to load document"))
      .finally(() => setLoading(false))
  }, [params.id, router])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext("2d")
    if (!context) return
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.lineWidth = 3
    context.lineCap = "round"
    context.strokeStyle = "#111827"
  }, [])

  function pointFromMouse(event: MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  function pointFromTouch(event: TouchEvent<HTMLCanvasElement>) {
    const touch = event.touches[0] || event.changedTouches[0]
    const canvas = canvasRef.current
    if (!canvas || !touch) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: (touch.clientX - rect.left) * (canvas.width / rect.width),
      y: (touch.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  function start(point: { x: number; y: number } | null) {
    if (!point) return
    const context = canvasRef.current?.getContext("2d")
    if (!context) return
    context.beginPath()
    context.moveTo(point.x, point.y)
    setDrawing(true)
  }

  function move(point: { x: number; y: number } | null) {
    if (!drawing || !point) return
    const context = canvasRef.current?.getContext("2d")
    if (!context) return
    context.lineTo(point.x, point.y)
    context.stroke()
    setHasSignature(true)
  }

  function stop() {
    setDrawing(false)
  }

  function clearSignature() {
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.strokeStyle = "#111827"
    setHasSignature(false)
  }

  async function submitSignature() {
    const canvas = canvasRef.current
    if (!canvas || !hasSignature) {
      toast.error("Draw your signature first")
      return
    }

    try {
      setSubmitting(true)
      await signDocument(params.id, canvas.toDataURL("image/png"))
      toast.success("Document signed")
      router.push(`/documents/${params.id}/complete`)
    } catch (error: any) {
      toast.error(error.message || "Could not sign document")
    } finally {
      setSubmitting(false)
    }
  }

  const previewUrl = payload?.document.signedPdf?.url || payload?.document.pdfSnapshot?.url

  return (
    <main className="min-h-screen">
      <section className="mx-auto max-w-7xl px-4 py-6">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Link>

        {loading && <div className="mt-6 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600">Loading document...</div>}

        {!loading && payload && (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
            <section className="min-h-[720px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-soft">
              <div className="border-b border-slate-200 p-4">
                <h1 className="text-xl font-semibold text-slate-950">{payload.document.title}</h1>
                <p className="mt-1 text-sm text-slate-600">{payload.envelope.title}</p>
              </div>
              {previewUrl ? (
                <iframe className="h-[720px] w-full bg-slate-100" src={previewUrl} title={payload.document.title} />
              ) : (
                <div className="flex h-[720px] items-center justify-center p-6 text-center text-sm text-slate-600">
                  No PDF preview is available yet. Contact your recruiter.
                </div>
              )}
            </section>

            <aside className="rounded-md border border-slate-200 bg-white p-5 shadow-soft">
              <div className="mb-5">
                <div className="text-sm font-semibold uppercase tracking-wide text-blue-700">Signature</div>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950">Complete your signature</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Your signature will be stamped into the recruiter-provided PDF with date and audit metadata.
                </p>
              </div>

              {!payload.canSign && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  This document is not currently waiting for your signature. It may already be signed or waiting for another signer.
                </div>
              )}

              <div className="mt-5">
                <canvas
                  ref={canvasRef}
                  width={760}
                  height={220}
                  className="signature-canvas h-44 w-full rounded-md border border-slate-300 bg-white"
                  onMouseDown={(event) => start(pointFromMouse(event))}
                  onMouseMove={(event) => move(pointFromMouse(event))}
                  onMouseUp={stop}
                  onMouseLeave={stop}
                  onTouchStart={(event) => {
                    event.preventDefault()
                    start(pointFromTouch(event))
                  }}
                  onTouchMove={(event) => {
                    event.preventDefault()
                    move(pointFromTouch(event))
                  }}
                  onTouchEnd={stop}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={clearSignature} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <Eraser className="h-4 w-4" />
                    Clear
                  </button>
                  <button
                    onClick={submitSignature}
                    disabled={!payload.canSign || !hasSignature || submitting}
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <PenLine className="h-4 w-4" />
                    {submitting ? "Signing..." : "Sign document"}
                  </button>
                </div>
              </div>

              <div className="mt-6 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                <div className="flex items-center gap-2 font-medium text-slate-950">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  Audit trail enabled
                </div>
                <p>Opening and signing events are recorded against this onboarding packet.</p>
              </div>

              {payload.downloadUrl && (
                <Link href={`/documents/${params.id}/download`} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  <Download className="h-4 w-4" />
                  Download available copy
                </Link>
              )}
            </aside>
          </div>
        )}
      </section>
    </main>
  )
}
