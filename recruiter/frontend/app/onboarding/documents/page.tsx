"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FilePlus2, FileText, Trash2, Upload } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OnboardingStatusBadge } from "@/components/onboarding/status-badge";
import { deleteDocument, getDocuments, uploadDocument, type OnboardingDocument } from "@/services/onboardingService";
import { toast } from "sonner";

export default function OnboardingDocumentsPage() {
  const [documents, setDocuments] = useState<OnboardingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState("");
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

  async function handleDelete(document: OnboardingDocument) {
    try {
      setDeletingId(document._id);
      await deleteDocument(document._id);
      setDocuments((current) => current.filter((item) => item._id !== document._id));
      toast.success("Document removed from library");
    } catch (error: any) {
      toast.error(error.message || "Failed to remove document");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-screen-2xl px-4 py-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Document library</h1>
            <p className="mt-2 text-sm text-slate-600">Create reusable transition documents or upload files for signing. PDFs keep the exact final layout; DOCX files are converted with their page setup and A4 layout preserved.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild variant="outline">
              <Link href="/people-transitions/templates">
                <FileText className="h-4 w-4" />
                Templates
              </Link>
            </Button>
            <Button asChild>
              <Link href="/people-transitions/documents/new">
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
          <p className="mt-2 text-xs text-slate-500">For exact final output, upload the PDF. DOCX uploads use server-side LibreOffice conversion and keep the document page setup instead of rebuilding from text.</p>
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
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button asChild size="sm" variant="outline"><Link href={`/people-transitions/documents/${document._id}/edit`}>Edit</Link></Button>
                        <Button asChild size="sm"><Link href={`/people-transitions/documents/${document._id}/prepare`}>Prepare</Link></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline" disabled={deletingId === document._id}>
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete document from library?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This removes {document.title} from the document library. Candidate packets that were already sent or signed keep their own document copies.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-red-600 text-white hover:bg-red-700"
                                onClick={() => handleDelete(document)}
                              >
                                {deletingId === document._id ? "Deleting..." : "Delete"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
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
