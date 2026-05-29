"use client";

import { useEffect, useState } from "react";
import { FileWarning, Loader2 } from "lucide-react";

interface RenderedPage {
  dataUrl: string;
  pageNumber: number;
  totalPages: number;
  width: number;
  height: number;
}

interface PdfPagePreviewProps {
  blob: Blob | null;
  pageNumber: number;
  title: string;
  onPageCount?: (count: number) => void;
}

export function PdfPagePreview({ blob, pageNumber, title, onPageCount }: PdfPagePreviewProps) {
  const [renderedPage, setRenderedPage] = useState<RenderedPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!blob) {
      setRenderedPage(null);
      setError("");
      onPageCount?.(1);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    setRenderedPage(null);

    async function renderPage() {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

      const data = await blob!.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const totalPages = pdf.numPages || 1;
      const safePageNumber = Math.max(1, Math.min(pageNumber, totalPages));
      const page = await pdf.getPage(safePageNumber);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = window.document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        await pdf.destroy();
        throw new Error("Could not prepare PDF preview canvas");
      }

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: context, viewport }).promise;
      await pdf.destroy();

      if (!cancelled) {
        onPageCount?.(totalPages);
        setRenderedPage({
          dataUrl: canvas.toDataURL("image/png"),
          pageNumber: safePageNumber,
          totalPages,
          width: canvas.width,
          height: canvas.height,
        });
      }
    }

    renderPage()
      .catch((renderError) => {
        if (!cancelled) {
          setError(renderError.message || "Could not render PDF preview");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [blob, onPageCount, pageNumber]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-3 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        Rendering document preview...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-sm rounded-md border border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-900">
          <FileWarning className="mx-auto mb-3 h-7 w-7" />
          <p className="font-semibold">The PDF preview could not be rendered.</p>
          <p className="mt-2 text-xs leading-5">{error}</p>
        </div>
      </div>
    );
  }

  if (!renderedPage) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-500">No PDF preview is available yet.</div>;
  }

  return (
    <img
      src={renderedPage.dataUrl}
      alt={`${title} page ${renderedPage.pageNumber}`}
      width={renderedPage.width}
      height={renderedPage.height}
      className="h-full w-full object-fill"
      draggable={false}
    />
  );
}
