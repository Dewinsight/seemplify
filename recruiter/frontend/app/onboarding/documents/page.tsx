"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FilePlus2, FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OnboardingStatusBadge } from "@/components/onboarding/status-badge";
import { getDocuments, uploadDocument, type OnboardingDocument } from "@/services/onboardingService";
import { toast } from "sonner";

export default function OnboardingDocumentsPage() {
  const [documents, setDocuments] = useState<OnboardingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);

  async function loadDocuments() {
    try {
      setLoading(true);
      setDocuments(await getDocuments());
    } catch (error: any) {
      toast.error(error.message || "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDocuments();
  }, []);

  async function handleUpload() {
    if (!file) return toast.error("Choose a PDF or DOCX document");
    const formData = new FormData();
    formData.append("document", file);
    if (title.trim()) formData.append("title", title.trim());
    try {
      setUploading(true);
      await uploadDocument(formData);
      setTitle("");
      setFile(null);
      toast.success("Document uploaded");
      await loadDocuments();
    } catch (error: any) {
      toast.error(error.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-screen-2xl px-4 py-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Document library</h1>
            <p className="mt-2 text-sm text-slate-600">Create reusable onboarding documents or upload PDFs/DOCX files for signing.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild variant="outline">
              <Link href="/onboarding/templates">
                <FileText className="h-4 w-4" />
                Templates
              </Link>
            </Button>
            <Button asChild>
              <Link href="/onboarding/documents/new">
                <FilePlus2 className="h-4 w-4" />
                Build document
              </Link>
            </Button>
          </div>
        </div>

        <section className="mb-6 rounded-md border bg-white p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional document title" />
            <Input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setFile(event.target.files?.[0] || null)} />
            <Button onClick={handleUpload} disabled={uploading || !file}>
              <Upload className="h-4 w-4" />
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </div>
        </section>

        <section className="rounded-md border bg-white">
          <div className="border-b p-4">
            <h2 className="text-lg font-semibold text-slate-950">Documents</h2>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="py-10 text-center text-slate-500">Loading documents...</TableCell></TableRow>
                ) : documents.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-10 text-center text-slate-500">No documents yet.</TableCell></TableRow>
                ) : documents.map((document) => (
                  <TableRow key={document._id}>
                    <TableCell>
                      <div className="font-medium text-slate-950">{document.title}</div>
                      <div className="text-xs text-slate-500">{document.description}</div>
                    </TableCell>
                    <TableCell className="capitalize">{document.sourceType.replace(/_/g, " ")}</TableCell>
                    <TableCell><OnboardingStatusBadge status={document.status} /></TableCell>
                    <TableCell>{new Date(document.updatedAt).toLocaleDateString()}</TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button asChild size="sm" variant="outline"><Link href={`/onboarding/documents/${document._id}/edit`}>Edit</Link></Button>
                      <Button asChild size="sm"><Link href={`/onboarding/documents/${document._id}/prepare`}>Prepare</Link></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
    </div>
  );
}
