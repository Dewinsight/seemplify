"use client"

import { useEffect, useState } from "react"
import { FileWarning, Loader2 } from "lucide-react"
import type { SignatureField } from "@/lib/types"

interface RenderedPage {
  pageNumber: number
  width: number
  height: number
  dataUrl: string
}

interface PdfCanvasPreviewProps {
  blob: Blob | null
  title: string
  signatureFields?: SignatureField[]
  signaturePreviewUrl?: string
  fieldValues?: Record<string, string>
}

function fieldLabel(field: SignatureField) {
  if (field.type === "date") return "Date signed"
  if (field.type === "name") return "Name"
  if (field.type === "email") return "Email"
  if (field.type === "text") return field.placeholder || field.label || "Text"
  return field.label || "Signature"
}

export function PdfCanvasPreview({ blob, title, signatureFields = [], signaturePreviewUrl = "", fieldValues = {} }: PdfCanvasPreviewProps) {
  const [pages, setPages] = useState<RenderedPage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!blob) {
      setPages([])
      setError("")
      return
    }

    const sourceBlob = blob
    let cancelled = false
    setLoading(true)
    setError("")
    setPages([])

    async function renderPdf() {
      const pdfjsLib = await import("pdfjs-dist")
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString()

      const data = await sourceBlob.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data }).promise
      const renderedPages: RenderedPage[] = []

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        if (cancelled) break

        const page = await pdf.getPage(pageNumber)
        const viewport = page.getViewport({ scale: 1.35 })
        const canvas = window.document.createElement("canvas")
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Could not prepare PDF canvas")

        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, canvasContext: context, viewport }).promise

        renderedPages.push({
          pageNumber,
          width: canvas.width,
          height: canvas.height,
          dataUrl: canvas.toDataURL("image/png"),
        })
      }

      await pdf.destroy()
      if (!cancelled) setPages(renderedPages)
    }

    renderPdf()
      .catch((renderError) => {
        if (!cancelled) setError(renderError.message || "Could not render PDF preview")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [blob])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-3 p-6 text-sm text-slate-600">
        <Loader2 className="h-5 w-5 animate-spin text-blue-700" />
        Rendering PDF preview...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-md border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-900">
          <FileWarning className="mx-auto mb-3 h-8 w-8" />
          <p className="font-semibold">The PDF preview could not be rendered.</p>
          <p className="mt-2 leading-6">{error}</p>
        </div>
      </div>
    )
  }

  if (pages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-600">
        No PDF preview is available yet.
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-slate-100 px-4 py-6">
      <div className="mx-auto flex max-w-[920px] flex-col gap-5">
        {pages.map((page) => {
          const pageFields = signatureFields.filter((field) => field.page === page.pageNumber)

          return (
            <figure key={page.pageNumber} className="relative rounded-sm bg-white shadow-lg ring-1 ring-slate-200">
              <img
                src={page.dataUrl}
                alt={`${title} page ${page.pageNumber}`}
                width={page.width}
                height={page.height}
                className="h-auto w-full"
              />
              <div className="pointer-events-none absolute inset-0">
                {pageFields.map((field) => {
                  const showSignature = field.type === "signature" && Boolean(signaturePreviewUrl)
                  const typedValue = fieldValues[field.id] || (field.label ? fieldValues[field.label] : "") || ""
                  return (
                    <div
                      key={field.id}
                      className="absolute overflow-hidden bg-transparent"
                      style={{
                        left: `${field.x * 100}%`,
                        top: `${field.y * 100}%`,
                        width: `${field.width * 100}%`,
                        height: `${field.height * 100}%`,
                      }}
                    >
                      {showSignature ? (
                        <img
                          src={signaturePreviewUrl}
                          alt="Signature preview"
                          className="h-full w-full object-contain p-1"
                        />
                      ) : (
                        <div className={`flex h-full px-2 text-[11px] font-medium text-blue-800 ${field.multiline ? "items-start whitespace-pre-wrap break-words py-1" : "items-center"}`}>
                          {field.type === "text" && typedValue ? typedValue : fieldLabel(field)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </figure>
          )
        })}
      </div>
    </div>
  )
}
