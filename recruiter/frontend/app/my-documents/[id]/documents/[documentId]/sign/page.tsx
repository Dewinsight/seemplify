"use client";

import Link from "next/link";
import { ChangeEvent, MouseEvent, PointerEvent, TouchEvent, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Crop, Download, Eraser, ExternalLink, FileSignature, FileWarning, Loader2, PenLine, RefreshCw, Save, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/candidate-portal/candidate-ui";
import { PdfCanvasPreview } from "@/components/candidate-portal/pdf-canvas-preview";
import { useCandidateBrand } from "@/lib/candidate-portal/use-candidate-brand";
import {
  getMySigningDocumentDownloadBlob,
  getMySigningDocumentPreviewBlob,
  getMySigningEnvelope,
  signMySigningDocument,
  type MySigningDocument,
  type MySigningEnvelope,
  type SignatureField,
} from "@/services/onboardingService";

type SignatureMode = "draw" | "upload";

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type CropHandle = "nw" | "ne" | "sw" | "se";

type CropInteraction =
  | { mode: "move"; startX: number; startY: number; startRect: CropRect }
  | { mode: "resize"; handle: CropHandle; startX: number; startY: number; startRect: CropRect };

interface SavedSignature {
  id: string;
  label: string;
  dataUrl: string;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_CROP_RECT: CropRect = { x: 8, y: 18, width: 84, height: 58 };
const MIN_CROP_SIZE = 12;
const MAX_SAVED_SIGNATURES = 8;
const SAVED_SIGNATURE_STORAGE_PREFIX = "digilog:staff-signatures";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function signerQuery(signerKey?: string) {
  return signerKey ? `?signer=${encodeURIComponent(signerKey)}` : "";
}

function packetHref(envelopeId: string, signerKey?: string) {
  return `/my-documents/${envelopeId}${signerQuery(signerKey)}`;
}

function documentHref(envelopeId: string, documentId: string, signerKey?: string) {
  return `/my-documents/${envelopeId}/documents/${documentId}/sign${signerQuery(signerKey)}`;
}

function completeHref(envelopeId: string, documentId: string, signerKey?: string) {
  return `/my-documents/${envelopeId}/documents/${documentId}/complete${signerQuery(signerKey)}`;
}

function signatureStorageKey(envelope?: MySigningEnvelope | null) {
  const signer = envelope?.signer;
  const identity = signer?._id || signer?.email || "staff";
  return `${SAVED_SIGNATURE_STORAGE_PREFIX}:${identity}`;
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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

function documentComplete(document?: MySigningDocument | null) {
  return document?.status === "completed" || document?.status === "signed";
}

export default function MyDocumentSignPage() {
  const params = useParams<{ id: string; documentId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const signerKey = searchParams.get("signer") || "";
  const brand = useCandidateBrand();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const cropAreaRef = useRef<HTMLDivElement | null>(null);
  const uploadedImageRef = useRef<HTMLImageElement | null>(null);
  const uploadedSignatureUrlRef = useRef("");
  const [envelope, setEnvelope] = useState<MySigningEnvelope | null>(null);
  const [document, setDocument] = useState<MySigningDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [signatureMode, setSignatureMode] = useState<SignatureMode>("draw");
  const [drawing, setDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [signaturePreviewUrl, setSignaturePreviewUrl] = useState("");
  const [uploadedSignatureUrl, setUploadedSignatureUrl] = useState("");
  const [cropRect, setCropRect] = useState<CropRect>(DEFAULT_CROP_RECT);
  const [cropInteraction, setCropInteraction] = useState<CropInteraction | null>(null);
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([]);
  const [selectedSavedSignatureId, setSelectedSavedSignatureId] = useState("");
  const [saveSignatureLabel, setSaveSignatureLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [imageFieldValues, setImageFieldValues] = useState<Record<string, string>>({});
  const [imageFieldNames, setImageFieldNames] = useState<Record<string, string>>({});

  function replaceUploadedSignatureUrl(nextUrl: string) {
    if (uploadedSignatureUrlRef.current) {
      URL.revokeObjectURL(uploadedSignatureUrlRef.current);
    }
    uploadedSignatureUrlRef.current = nextUrl;
    setUploadedSignatureUrl(nextUrl);
  }

  function readSavedSignatures(nextEnvelope?: MySigningEnvelope | null) {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(signatureStorageKey(nextEnvelope));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((signature): signature is SavedSignature => Boolean(signature?.id && signature?.label && signature?.dataUrl))
        .slice(0, MAX_SAVED_SIGNATURES);
    } catch {
      return [];
    }
  }

  function persistSavedSignatures(nextSignatures: SavedSignature[], nextEnvelope: MySigningEnvelope | null = envelope) {
    if (typeof window === "undefined" || !nextEnvelope) return false;
    try {
      window.localStorage.setItem(signatureStorageKey(nextEnvelope), JSON.stringify(nextSignatures.slice(0, MAX_SAVED_SIGNATURES)));
      return true;
    } catch {
      toast.error("Could not save this signature in your browser");
      return false;
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEnvelope(null);
    setDocument(null);
    setSignatureMode("draw");
    setHasSignature(false);
    setSignaturePreviewUrl("");
    setSelectedSavedSignatureId("");
    setSaveSignatureLabel("");
    setCropRect(DEFAULT_CROP_RECT);
    setCropInteraction(null);
    replaceUploadedSignatureUrl("");
    setPreviewBlob(null);
    setPreviewUrl("");
    setPreviewError("");
    setFieldValues({});
    setImageFieldValues({});
    setImageFieldNames({});
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = "#111827";
    }

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
        setSavedSignatures(readSavedSignatures(loadedEnvelope));
        const nextValues: Record<string, string> = {};
        (loadedDocument.signatureFields || [])
          .filter((field) => field.type === "text")
          .forEach((field) => {
            nextValues[field.id] = "";
            if (field.label) nextValues[field.label] = "";
            if (field.key) nextValues[field.key] = "";
          });
        setFieldValues(nextValues);
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

  useEffect(() => {
    return () => {
      if (uploadedSignatureUrlRef.current) {
        URL.revokeObjectURL(uploadedSignatureUrlRef.current);
        uploadedSignatureUrlRef.current = "";
      }
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 3;
    context.lineCap = "round";
    context.strokeStyle = "#111827";
  }, []);

  function updateSignaturePreview() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSignaturePreviewUrl(canvas.toDataURL("image/png"));
    setSelectedSavedSignatureId("");
  }

  function pointFromMouse(event: MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function pointFromTouch(event: TouchEvent<HTMLCanvasElement>) {
    const touch = event.touches[0] || event.changedTouches[0];
    const canvas = canvasRef.current;
    if (!canvas || !touch) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (touch.clientX - rect.left) * (canvas.width / rect.width),
      y: (touch.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function start(point: { x: number; y: number } | null) {
    if (!point) return;
    setSignatureMode("draw");
    setSelectedSavedSignatureId("");
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.beginPath();
    context.moveTo(point.x, point.y);
    setDrawing(true);
  }

  function move(point: { x: number; y: number } | null) {
    if (!drawing || !point) return;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.lineTo(point.x, point.y);
    context.stroke();
    setHasSignature(true);
    updateSignaturePreview();
  }

  function stop() {
    if (drawing && hasSignature) updateSignaturePreview();
    setDrawing(false);
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#111827";
    setHasSignature(false);
    setSignaturePreviewUrl("");
    setSelectedSavedSignatureId("");
  }

  function handleSignatureUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Upload an image file for your signature");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Signature image must be 10MB or smaller");
      return;
    }

    replaceUploadedSignatureUrl(URL.createObjectURL(file));
    setSignatureMode("upload");
    setCropRect(DEFAULT_CROP_RECT);
    setCropInteraction(null);
    setHasSignature(false);
    setSignaturePreviewUrl("");
    setSelectedSavedSignatureId("");
  }

  function clearUploadedSignature() {
    replaceUploadedSignatureUrl("");
    setCropRect(DEFAULT_CROP_RECT);
    setCropInteraction(null);
    setHasSignature(false);
    setSignaturePreviewUrl("");
    setSelectedSavedSignatureId("");
  }

  async function uploadDocumentImageField(fieldId: string, label: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Upload an image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be 10MB or smaller");
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setImageFieldValues((current) => ({ ...current, [fieldId]: dataUrl }));
      setImageFieldNames((current) => ({ ...current, [fieldId]: file.name || label }));
    } catch (error: any) {
      toast.error(error.message || "Could not load image");
    }
  }

  function clearDocumentImageField(fieldId: string) {
    setImageFieldValues((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
    setImageFieldNames((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  }

  function beginCropMove(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setCropInteraction({
      mode: "move",
      startX: event.clientX,
      startY: event.clientY,
      startRect: cropRect,
    });
  }

  function beginCropResize(handle: CropHandle, event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setCropInteraction({
      mode: "resize",
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startRect: cropRect,
    });
  }

  function updateCropFromPointer(event: PointerEvent<HTMLDivElement>) {
    if (!cropInteraction || !cropAreaRef.current) return;
    const bounds = cropAreaRef.current.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const deltaX = ((event.clientX - cropInteraction.startX) / bounds.width) * 100;
    const deltaY = ((event.clientY - cropInteraction.startY) / bounds.height) * 100;
    const startRect = cropInteraction.startRect;

    if (cropInteraction.mode === "move") {
      setCropRect({
        ...startRect,
        x: clamp(startRect.x + deltaX, 0, 100 - startRect.width),
        y: clamp(startRect.y + deltaY, 0, 100 - startRect.height),
      });
      return;
    }

    let left = startRect.x;
    let top = startRect.y;
    let right = startRect.x + startRect.width;
    let bottom = startRect.y + startRect.height;

    if (cropInteraction.handle.includes("w")) left = clamp(left + deltaX, 0, right - MIN_CROP_SIZE);
    if (cropInteraction.handle.includes("e")) right = clamp(right + deltaX, left + MIN_CROP_SIZE, 100);
    if (cropInteraction.handle.includes("n")) top = clamp(top + deltaY, 0, bottom - MIN_CROP_SIZE);
    if (cropInteraction.handle.includes("s")) bottom = clamp(bottom + deltaY, top + MIN_CROP_SIZE, 100);

    setCropRect({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    });
  }

  function endCropInteraction(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setCropInteraction(null);
  }

  function applyUploadedCrop() {
    const image = uploadedImageRef.current;
    if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) {
      toast.error("Wait for the signature image to finish loading");
      return;
    }

    const sourceX = (cropRect.x / 100) * image.naturalWidth;
    const sourceY = (cropRect.y / 100) * image.naturalHeight;
    const sourceWidth = (cropRect.width / 100) * image.naturalWidth;
    const sourceHeight = (cropRect.height / 100) * image.naturalHeight;
    const scale = Math.min(1, 900 / sourceWidth, 360 / sourceHeight);
    const outputWidth = Math.max(1, Math.round(sourceWidth * scale));
    const outputHeight = Math.max(1, Math.round(sourceHeight * scale));
    const cropCanvas = window.document.createElement("canvas");
    const context = cropCanvas.getContext("2d");
    if (!context) {
      toast.error("Could not crop the signature image");
      return;
    }

    cropCanvas.width = outputWidth;
    cropCanvas.height = outputHeight;
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
    setSignaturePreviewUrl(cropCanvas.toDataURL("image/png"));
    setHasSignature(true);
    setSelectedSavedSignatureId("");
    toast.success("Signature crop applied");
  }

  function saveCurrentSignature() {
    if (!signaturePreviewUrl) {
      toast.error("Add a signature before saving");
      return;
    }
    const now = new Date().toISOString();
    const nextSignature: SavedSignature = {
      id: `sig_${Date.now()}`,
      label: saveSignatureLabel.trim() || `Signature ${savedSignatures.length + 1}`,
      dataUrl: signaturePreviewUrl,
      createdAt: now,
      updatedAt: now,
    };
    const nextSignatures = [nextSignature, ...savedSignatures.filter((signature) => signature.dataUrl !== signaturePreviewUrl)].slice(0, MAX_SAVED_SIGNATURES);
    if (!persistSavedSignatures(nextSignatures)) return;
    setSavedSignatures(nextSignatures);
    setSelectedSavedSignatureId(nextSignature.id);
    setSaveSignatureLabel("");
    toast.success("Signature saved");
  }

  function selectSavedSignature(signature: SavedSignature) {
    setSignaturePreviewUrl(signature.dataUrl);
    setHasSignature(true);
    setSelectedSavedSignatureId(signature.id);
    toast.success("Signature selected");
  }

  function deleteSavedSignature(signatureId: string) {
    const nextSignatures = savedSignatures.filter((signature) => signature.id !== signatureId);
    if (!persistSavedSignatures(nextSignatures)) return;
    setSavedSignatures(nextSignatures);
    if (selectedSavedSignatureId === signatureId) {
      setSelectedSavedSignatureId("");
      setHasSignature(false);
      setSignaturePreviewUrl("");
    }
  }

  function setTextField(field: SignatureField, value: string) {
    setFieldValues((current) => ({
      ...current,
      [field.id]: value,
      ...(field.key ? { [field.key]: value } : {}),
      ...(field.label ? { [field.label]: value } : {}),
    }));
  }

  async function submitDocument() {
    if (!document || !envelope) return;
    const isFillOnly = document.actionType === "document_fill" || document.actionType === "document_review";
    if (!isFillOnly && !signaturePreviewUrl) {
      toast.error("Add your signature first");
      return;
    }
    const missingField = (document.signatureFields || [])
      .filter((field) => field.type === "text" && field.required !== false)
      .find((field) => !String(fieldValues[field.id] || "").trim());
    if (missingField) {
      toast.error(`${missingField.label || "Text field"} is required`);
      return;
    }
    const missingImageField = (document.signatureFields || [])
      .filter((field) => field.type === "image" && field.required !== false)
      .find((field) => !String(imageFieldValues[field.id] || "").trim());
    if (missingImageField) {
      toast.error(`${missingImageField.label || "Image field"} is required`);
      return;
    }

    try {
      setSubmitting(true);
      const result = await signMySigningDocument(
        envelope._id,
        document._id,
        { signatureDataUrl: signaturePreviewUrl, fieldValues, imageFieldValues },
        signerKey || envelope.signer.key,
      );
      if (result.nextDocumentId) {
        toast.success(isFillOnly ? "Document completed. Opening next document." : "Document signed. Opening next document.");
        router.push(documentHref(envelope._id, result.nextDocumentId, signerKey || envelope.signer.key));
        return;
      }
      toast.success(isFillOnly ? "Document completed" : "Document signed");
      router.push(completeHref(envelope._id, document._id, signerKey || envelope.signer.key));
    } catch (error: any) {
      toast.error(error.message || "Could not submit document");
    } finally {
      setSubmitting(false);
    }
  }

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

  const fields = document?.signatureFields || [];
  const textFields = fields.filter((field) => field.type === "text");
  const imageFields = fields.filter((field) => field.type === "image");
  const requiresSignature = fields.some((field) => field.type === "signature");
  const isFillOnly = Boolean(document?.actionType === "document_fill" || document?.actionType === "document_review" || !requiresSignature);
  const hasInputFields = textFields.length > 0 || imageFields.length > 0;
  const canSubmit = Boolean(
    envelope?.canSign &&
    envelope.signer.role === "internal" &&
    document &&
    !documentComplete(document) &&
    document.status !== "voided"
  );
  const submitLabel = document?.actionType === "document_review"
    ? "Complete review"
    : isFillOnly
      ? "Complete document"
      : "Sign document";
  const submitDisabled = !canSubmit || submitting || (!isFillOnly && !signaturePreviewUrl);

  return (
    <main className={`min-h-[calc(100vh-76px)] bg-gradient-to-br ${brand.softGradientClass}`}>
      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Link href={packetHref(params.id, signerKey)} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" />
          Back to packet
        </Link>

        {loading && <div className="mt-5 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">Loading document...</div>}

        {!loading && (!document || !envelope) && (
          <div className="mt-5 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
            This document is unavailable or is not assigned to you.
          </div>
        )}

        {!loading && document && envelope && (
          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
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
                    Preparing PDF preview...
                  </div>
                ) : previewBlob ? (
                  <PdfCanvasPreview
                    blob={previewBlob}
                    title={document.title}
                    signatureFields={fields as any}
                    signaturePreviewUrl={signaturePreviewUrl}
                    fieldValues={fieldValues}
                    imageFieldValues={imageFieldValues}
                  />
                ) : previewError ? (
                  <div className="flex h-full items-center justify-center p-6">
                    <div className="max-w-md rounded-md border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-900">
                      <FileWarning className="mx-auto mb-3 h-8 w-8" />
                      <p className="font-semibold">The document preview could not be loaded.</p>
                      <p className="mt-2 leading-6">{previewError}</p>
                      <button
                        type="button"
                        onClick={() => setPreviewReloadKey((value) => value + 1)}
                        className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-amber-900 px-4 text-sm font-semibold text-white hover:bg-amber-800"
                      >
                        Retry preview
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-600">
                    No PDF preview is available yet.
                  </div>
                )}
              </div>
              <div className="border-t border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
                This is the prepared PDF copy assigned to you for signing. The original packet stays locked while you complete it.
              </div>
            </section>

            <aside className="h-fit space-y-4 lg:sticky lg:top-24">
              <section className="rounded-md border border-border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Packet documents</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Only documents assigned to you are shown.</p>
                  </div>
                  <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${brand.accentBgClass} ${brand.accentTextClass}`}>
                    {envelope.documents.findIndex((item) => item._id === document._id) + 1}/{envelope.documents.length}
                  </span>
                </div>
                <ol className="mt-4 space-y-2">
                  {envelope.documents.map((item, index) => {
                    const active = item._id === document._id;
                    const done = documentComplete(item);
                    const canOpen = done || canSubmit || item._id === document._id;
                    const content = (
                      <>
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-sm font-semibold ${active ? "border-primary bg-muted text-primary" : done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-white text-muted-foreground"}`}>
                          {done ? <CheckCircle2 className="h-4 w-4" /> : <FileSignature className="h-4 w-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-foreground">{index + 1}. {item.title}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{item.signatureFields.length} assigned field{item.signatureFields.length === 1 ? "" : "s"}</span>
                        </span>
                      </>
                    );

                    return (
                      <li key={item._id}>
                        {canOpen ? (
                          <Link href={documentHref(envelope._id, item._id, signerKey || envelope.signer.key)} className={`flex w-full items-start gap-3 rounded-md border p-3 text-left transition ${active ? "border-primary bg-muted" : "border-border bg-white hover:bg-muted"}`}>
                            {content}
                          </Link>
                        ) : (
                          <div className="flex w-full items-start gap-3 rounded-md border border-border bg-white p-3 text-left opacity-70">
                            {content}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>

              <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-5">
                  <div className={`text-sm font-semibold ${brand.accentTextClass}`}>
                    {isFillOnly ? (hasInputFields ? "Fillable fields" : "Document completion") : "Signature"}
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold text-slate-950">
                    {isFillOnly ? (hasInputFields ? "Complete required fields" : "Review and complete") : "Complete your signature"}
                  </h2>
                  <p className="mt-2 text-sm text-slate-600">
                    {isFillOnly
                      ? hasInputFields
                        ? "Your field values will be stamped into the prepared PDF with audit metadata."
                        : "Your name, email, or date fields will be stamped into the prepared PDF with audit metadata."
                      : "Your signature will be stamped into the prepared PDF with date and audit metadata."}
                  </p>
                </div>

                {!canSubmit && !documentComplete(document) && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    This document is not currently waiting for your action. It may already be completed or waiting for another signer.
                  </div>
                )}

                {textFields.length > 0 && (
                  <div className="mt-5 space-y-4 border-t border-slate-200 pt-5">
                    {textFields.map((field) => (
                      <label key={field.id} className="block">
                        <span className="text-sm font-semibold text-slate-950">
                          {field.label || "Text field"}
                          {field.required !== false && <span className="text-rose-600"> *</span>}
                        </span>
                        {field.multiline ? (
                          <textarea
                            value={fieldValues[field.id] || ""}
                            placeholder={field.placeholder || ""}
                            rows={Math.max(3, Math.round((field.height || 0.12) * 24))}
                            onChange={(event) => setTextField(field, event.target.value)}
                            disabled={!canSubmit}
                            className="mt-2 min-h-24 w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        ) : (
                          <input
                            value={fieldValues[field.id] || ""}
                            placeholder={field.placeholder || ""}
                            onChange={(event) => setTextField(field, event.target.value)}
                            disabled={!canSubmit}
                            className="mt-2 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        )}
                      </label>
                    ))}
                  </div>
                )}

                {imageFields.length > 0 && (
                  <div className="mt-5 space-y-4 border-t border-slate-200 pt-5">
                    {imageFields.map((field) => {
                      const uploadedImage = imageFieldValues[field.id] || "";
                      return (
                        <label key={field.id} className="block">
                          <span className="text-sm font-semibold text-slate-950">
                            {field.label || "Image upload"}
                            {field.required !== false && <span className="text-rose-600"> *</span>}
                          </span>
                          {field.placeholder && <span className="mt-1 block text-xs text-slate-500">{field.placeholder}</span>}
                          <span className="mt-2 block rounded-md border border-dashed border-slate-300 bg-slate-50 p-4">
                            {uploadedImage ? (
                              <span className="flex items-center gap-3">
                                <span className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-white">
                                  <img src={uploadedImage} alt={field.label || "Uploaded image"} className="max-h-full max-w-full object-contain" />
                                </span>
                                <span className="min-w-0 flex-1 text-sm text-slate-700">
                                  <span className="block truncate font-medium text-slate-950">{imageFieldNames[field.id] || "Image selected"}</span>
                                  <button
                                    type="button"
                                    onClick={() => clearDocumentImageField(field.id)}
                                    disabled={!canSubmit}
                                    className="mt-1 text-xs font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    Remove image
                                  </button>
                                </span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                                <Upload className="h-4 w-4" />
                                Upload image
                              </span>
                            )}
                            <input
                              type="file"
                              accept="image/*"
                              disabled={!canSubmit}
                              onChange={(event) => uploadDocumentImageField(field.id, field.label || "Image upload", event)}
                              className="mt-3 block w-full text-sm text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}

                {!isFillOnly ? (
                  <div className="mt-5 space-y-5">
                    {savedSignatures.length > 0 && (
                      <div className="border-t border-slate-200 pt-5">
                        <div className="text-sm font-semibold text-slate-950">Saved signatures</div>
                        <div className="mt-3 space-y-2">
                          {savedSignatures.map((signature) => {
                            const selected = selectedSavedSignatureId === signature.id;
                            return (
                              <div key={signature.id} className={`flex items-center gap-2 rounded-md border p-2 ${selected ? "border-slate-950 bg-slate-50" : "border-slate-200 bg-white"}`}>
                                <button
                                  type="button"
                                  onClick={() => selectSavedSignature(signature)}
                                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                >
                                  <span className="flex h-12 w-24 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-white">
                                    <img src={signature.dataUrl} alt={signature.label} className="max-h-10 max-w-full object-contain" />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium text-slate-950">{signature.label}</span>
                                    <span className="block text-xs text-slate-500">{selected ? "Selected" : "Use this signature"}</span>
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteSavedSignature(signature.id)}
                                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-rose-700"
                                  aria-label={`Delete ${signature.label}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 rounded-md border border-slate-200 bg-slate-50 p-1">
                      <button
                        type="button"
                        onClick={() => setSignatureMode("draw")}
                        disabled={!canSubmit}
                        className={`inline-flex h-9 items-center justify-center gap-2 rounded px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${signatureMode === "draw" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950"}`}
                      >
                        <PenLine className="h-4 w-4" />
                        Draw
                      </button>
                      <button
                        type="button"
                        onClick={() => setSignatureMode("upload")}
                        disabled={!canSubmit}
                        className={`inline-flex h-9 items-center justify-center gap-2 rounded px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${signatureMode === "upload" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-950"}`}
                      >
                        <Upload className="h-4 w-4" />
                        Upload
                      </button>
                    </div>

                    {signatureMode === "draw" ? (
                      <div>
                        <canvas
                          ref={canvasRef}
                          width={760}
                          height={220}
                          className="signature-canvas h-44 w-full rounded-md border border-slate-300 bg-white"
                          onMouseDown={(event) => canSubmit && start(pointFromMouse(event))}
                          onMouseMove={(event) => canSubmit && move(pointFromMouse(event))}
                          onMouseUp={stop}
                          onMouseLeave={stop}
                          onTouchStart={(event) => {
                            if (!canSubmit) return;
                            event.preventDefault();
                            start(pointFromTouch(event));
                          }}
                          onTouchMove={(event) => {
                            if (!canSubmit) return;
                            event.preventDefault();
                            move(pointFromTouch(event));
                          }}
                          onTouchEnd={stop}
                        />
                        <button
                          type="button"
                          onClick={clearSignature}
                          disabled={!canSubmit}
                          className="mt-3 inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Eraser className="h-4 w-4" />
                          Clear
                        </button>
                      </div>
                    ) : (
                      <div>
                        <input
                          ref={uploadInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleSignatureUpload}
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => uploadInputRef.current?.click()}
                            disabled={!canSubmit}
                            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Upload className="h-4 w-4" />
                            Choose image
                          </button>
                          {uploadedSignatureUrl && (
                            <button
                              type="button"
                              onClick={clearUploadedSignature}
                              disabled={!canSubmit}
                              className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <X className="h-4 w-4" />
                              Remove
                            </button>
                          )}
                        </div>

                        {uploadedSignatureUrl ? (
                          <div className="mt-3">
                            <div
                              ref={cropAreaRef}
                              className="relative overflow-hidden rounded-md border border-slate-300 bg-slate-50"
                              onPointerMove={updateCropFromPointer}
                              onPointerUp={endCropInteraction}
                              onPointerCancel={endCropInteraction}
                            >
                              <img
                                ref={uploadedImageRef}
                                src={uploadedSignatureUrl}
                                alt="Uploaded signature"
                                draggable={false}
                                className="block max-h-64 w-full select-none object-contain"
                              />
                              <div className="absolute inset-0 bg-foreground/10" />
                              <div
                                className="absolute cursor-move border-2 border-foreground bg-white/10"
                                style={{
                                  left: `${cropRect.x}%`,
                                  top: `${cropRect.y}%`,
                                  width: `${cropRect.width}%`,
                                  height: `${cropRect.height}%`,
                                }}
                                onPointerDown={beginCropMove}
                              >
                                {(["nw", "ne", "sw", "se"] as CropHandle[]).map((handle) => (
                                  <button
                                    key={handle}
                                    type="button"
                                    onPointerDown={(event) => beginCropResize(handle, event)}
                                    className={`absolute h-4 w-4 rounded-sm border border-foreground bg-white ${
                                      handle === "nw"
                                        ? "-left-2 -top-2 cursor-nwse-resize"
                                        : handle === "ne"
                                          ? "-right-2 -top-2 cursor-nesw-resize"
                                          : handle === "sw"
                                            ? "-bottom-2 -left-2 cursor-nesw-resize"
                                            : "-bottom-2 -right-2 cursor-nwse-resize"
                                    }`}
                                    aria-label={`Resize crop ${handle}`}
                                  />
                                ))}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={applyUploadedCrop}
                              disabled={!canSubmit}
                              className="mt-3 inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Crop className="h-4 w-4" />
                              Apply crop
                            </button>
                          </div>
                        ) : (
                          <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
                            Upload a signature image, then crop the area to stamp on the PDF.
                          </div>
                        )}
                      </div>
                    )}

                    <div className="border-t border-slate-200 pt-5">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                          value={saveSignatureLabel}
                          onChange={(event) => setSaveSignatureLabel(event.target.value)}
                          placeholder={`Signature ${savedSignatures.length + 1}`}
                          disabled={!canSubmit}
                          className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        <button
                          type="button"
                          onClick={saveCurrentSignature}
                          disabled={!canSubmit || !signaturePreviewUrl}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Save className="h-4 w-4" />
                          Save signature
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={submitDocument}
                        disabled={submitDisabled}
                        className={`mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${brand.primaryButtonClass}`}
                      >
                        <PenLine className="h-4 w-4" />
                        {submitting ? "Signing..." : submitLabel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={submitDocument}
                    disabled={submitDisabled}
                    className={`mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${brand.primaryButtonClass}`}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {submitting ? "Completing..." : submitLabel}
                  </button>
                )}

                <div className="mt-6 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  <div className="flex items-center gap-2 font-medium text-slate-950">
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                    Secure signing
                  </div>
                  <p>Your {isFillOnly ? "completion" : "signature"} is saved to this packet when you submit.</p>
                </div>

                <button
                  type="button"
                  onClick={downloadCopy}
                  disabled={downloading}
                  className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {downloading ? "Preparing PDF..." : "Download available copy"}
                </button>
              </section>
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}
