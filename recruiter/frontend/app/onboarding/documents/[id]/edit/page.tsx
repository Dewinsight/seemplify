"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { DocumentBuilder } from "@/components/onboarding/document-builder";
import { getDocument, renderDocument, updateDocument, type OnboardingDocument } from "@/services/onboardingService";
import { toast } from "sonner";

export default function EditOnboardingDocumentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [document, setDocument] = useState<OnboardingDocument | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDocument(params.id)
      .then(setDocument)
      .catch((error) => toast.error(error.message || "Failed to load document"));
  }, [params.id]);

  async function saveDocument(data: any) {
    try {
      setSaving(true);
      const updated = await updateDocument(params.id, data);
      await renderDocument(updated._id).catch(() => null);
      toast.success("Document saved");
      router.push(`/onboarding/documents/${updated._id}/prepare`);
    } catch (error: any) {
      toast.error(error.message || "Failed to save document");
    } finally {
      setSaving(false);
    }
  }

  if (!document) {
    return <div className="p-8 text-sm text-slate-500">Loading document...</div>;
  }

  return <DocumentBuilder initialDocument={document} saving={saving} onSave={saveDocument} />;
}
