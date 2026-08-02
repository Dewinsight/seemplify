"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ListChecks, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getCandidateList,
  getCandidateLists,
  type CandidateListDetail,
  type CandidateListSummary,
} from "@/services/candidateListService";
import type { CandidateData } from "@/services/candidateService";
import { toast } from "sonner";

function candidateName(candidate: CandidateData) {
  return `${candidate.firstName || ""} ${candidate.lastName || ""}`.trim() || candidate.email || "Candidate";
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
}

export default function CandidateListsPage() {
  const [lists, setLists] = useState<CandidateListSummary[]>([]);
  const [selectedListId, setSelectedListId] = useState("");
  const [selectedList, setSelectedList] = useState<CandidateListDetail | null>(null);
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function loadLists(preferredId?: string) {
    try {
      setLoadingLists(true);
      const nextLists = await getCandidateLists();
      setLists(nextLists);
      const nextId = preferredId || selectedListId || nextLists[0]?._id || "";
      setSelectedListId(nextId);
      if (nextId) await loadListDetail(nextId);
      if (!nextId) setSelectedList(null);
    } catch (error: any) {
      toast.error(error.message || "Failed to load candidate lists");
    } finally {
      setLoadingLists(false);
    }
  }

  async function loadListDetail(listId: string) {
    try {
      setLoadingDetail(true);
      const detail = await getCandidateList(listId);
      setSelectedList(detail);
    } catch (error: any) {
      toast.error(error.message || "Failed to load list");
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    loadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entries = selectedList?.entries || [];

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-screen-2xl space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <Button asChild variant="ghost" className="-ml-3 mb-2">
              <Link href="/candidates">
                <ArrowLeft className="h-4 w-4" />
                Candidates
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold text-slate-950">Candidate lists</h1>
            <p className="mt-1 text-sm text-slate-600">Saved selections from candidates, AI matching, and AI interviews.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => loadLists(selectedListId)} disabled={loadingLists || loadingDetail}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="rounded-md border bg-white">
            <div className="border-b p-4">
              <h2 className="font-semibold text-slate-950">Lists</h2>
              <p className="text-sm text-slate-500">{lists.length} saved</p>
            </div>
            <div className="max-h-[680px] overflow-auto">
              {loadingLists ? (
                <div className="p-4 text-sm text-slate-500">Loading lists...</div>
              ) : lists.length ? (
                lists.map((list) => (
                  <button
                    key={list._id}
                    type="button"
                    onClick={() => {
                      setSelectedListId(list._id);
                      loadListDetail(list._id);
                    }}
                    className={`block w-full border-b px-4 py-3 text-left hover:bg-slate-50 ${selectedListId === list._id ? "bg-blue-50" : "bg-white"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-slate-950">{list.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatDate(list.updatedAt)}</div>
                      </div>
                      <Badge variant="outline">{list.candidateCount}</Badge>
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-6 text-center text-sm text-slate-500">
                  <ListChecks className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                  No lists yet.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-md border bg-white">
            <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-semibold text-slate-950">{selectedList?.name || "List candidates"}</h2>
                <p className="text-sm text-slate-500">{selectedList?.description || `${entries.length} candidates`}</p>
              </div>
              {selectedList ? (
                <Badge variant="outline" className="w-fit">
                  {selectedList.source.replace(/_/g, " ")}
                </Badge>
              ) : null}
            </div>
            <div className="h-[680px] overflow-auto">
              {loadingDetail ? (
                <div className="p-4 text-sm text-slate-500">Loading candidates...</div>
              ) : entries.length ? (
                <Table>
                  <TableHeader className="sticky top-0 bg-white">
                    <TableRow>
                      <TableHead className="w-20">Rank</TableHead>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead className="w-24 text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry, index) => {
                      const candidate = typeof entry.candidate === "object" ? entry.candidate : null;
                      if (!candidate) return null;
                      return (
                        <TableRow key={`${candidate._id}-${index}`}>
                          <TableCell>{entry.rank || index + 1}</TableCell>
                          <TableCell>
                            <Link href={`/candidates/${candidate._id}`} className="font-medium text-slate-950 hover:underline">
                              {candidateName(candidate)}
                            </Link>
                          </TableCell>
                          <TableCell className="text-slate-600">{candidate.email || "-"}</TableCell>
                          <TableCell className="text-slate-600">{candidate.position || "-"}</TableCell>
                          <TableCell className="text-right">{typeof entry.score === "number" ? Math.round(entry.score) : "-"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-6 text-center text-sm text-slate-500">
                  <Users className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                  Select a list to review candidates.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
