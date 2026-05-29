"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DocumentBuilder } from "@/components/onboarding/document-builder";
import { createDocument, renderDocument } from "@/services/onboardingService";
import { toast } from "sonner";

export default function NewOnboardingDocumentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [saving, setSaving] = useState(false);

  async function saveDocument(data: any) {
    try {
      setSaving(true);
      const document = await createDocument({
        ...data,
        templateId: searchParams.get("templateId") || undefined,
      });
      await renderDocument(document._id).catch(() => null);
      toast.success("Document created");
      router.push(`/onboarding/documents/${document._id}/prepare`);
    } catch (error: any) {
      toast.error(error.message || "Failed to create document");
    } finally {
      setSaving(false);
    }
  }

  return <DocumentBuilder saving={saving} onSave={saveDocument} />;
}
