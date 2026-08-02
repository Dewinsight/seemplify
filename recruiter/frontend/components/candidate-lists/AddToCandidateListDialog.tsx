"use client";

import { useEffect, useMemo, useState } from "react";
import { ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import {
  addCandidatesToList,
  createCandidateList,
  createCandidateListFromQuery,
  getCandidateLists,
  type CandidateListDetail,
  type CandidateListSource,
  type CandidateListSummary,
} from "@/services/candidateListService";

type RankedEntry = {
  candidateId?: string;
  candidate?: string;
  id?: string;
  rank?: number;
  score?: number;
  source?: CandidateListSource | string;
  notes?: string;
};

type QuerySource = {
  search?: string;
  status?: string;
  limit?: number;
};

type AddToCandidateListDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateIds?: string[];
  entries?: RankedEntry[];
  query?: QuerySource;
  source?: CandidateListSource;
  sourceRef?: Record<string, unknown>;
  defaultName?: string;
  defaultDescription?: string;
  countLabel?: string;
  onCompleted?: (list?: CandidateListDetail) => void;
};

const CREATE_NEW_VALUE = "__create_new__";

export function AddToCandidateListDialog({
  open,
  onOpenChange,
  candidateIds = [],
  entries = [],
  query,
  source = "manual",
  sourceRef,
  defaultName = "",
  defaultDescription = "",
  countLabel,
  onCompleted,
}: AddToCandidateListDialogProps) {
  const [lists, setLists] = useState<CandidateListSummary[]>([]);
  const [selectedListId, setSelectedListId] = useState(CREATE_NEW_VALUE);
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState(defaultDescription);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const count = useMemo(() => {
    if (query) return query.limit || 5000;
    return entries.length || candidateIds.length;
  }, [candidateIds.length, entries.length, query]);

  useEffect(() => {
    if (!open) return;

    setName(defaultName);
    setDescription(defaultDescription);
    setSelectedListId(CREATE_NEW_VALUE);

    if (query) {
      setLists([]);
      return;
    }

    let mounted = true;
    setIsLoading(true);
    getCandidateLists()
      .then((nextLists) => {
        if (mounted) setLists(nextLists);
      })
      .catch((error) => {
        toast({
          title: "Could not load lists",
          description: error instanceof Error ? error.message : "Try again.",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [defaultDescription, defaultName, open, query]);

  const save = async () => {
    if (query || selectedListId === CREATE_NEW_VALUE) {
      if (!name.trim()) {
        toast({ title: "List name is required", variant: "destructive" });
        return;
      }
    }

    if (!query && !entries.length && !candidateIds.length) {
      toast({ title: "Select at least one candidate", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      let savedList: CandidateListDetail | undefined;
      if (query) {
        savedList = await createCandidateListFromQuery({
          name: name.trim(),
          description,
          search: query.search,
          status: query.status,
          limit: query.limit,
        });
      } else if (selectedListId === CREATE_NEW_VALUE) {
        savedList = await createCandidateList({
          name: name.trim(),
          description,
          source,
          sourceRef,
          candidateIds,
          entries,
        });
      } else {
        savedList = await addCandidatesToList(selectedListId, {
          candidateIds,
          entries,
          source,
        });
      }

      toast({
        title: "Candidate list saved",
        description: query ? "A new list was created from the current candidate set." : "The selected candidates were added.",
      });
      onCompleted?.(savedList);
      onOpenChange(false);
    } catch (error) {
      toast({
        title: "Could not save list",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListPlus className="h-5 w-5" />
            Save candidate list
          </DialogTitle>
          <DialogDescription>
            {countLabel || `${count.toLocaleString()} candidate${count === 1 ? "" : "s"} will be saved.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!query && (
            <div className="space-y-2">
              <Label htmlFor="candidate-list-target">Destination</Label>
              <Select value={selectedListId} onValueChange={setSelectedListId} disabled={isLoading}>
                <SelectTrigger id="candidate-list-target">
                  <SelectValue placeholder="Choose a list" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CREATE_NEW_VALUE}>Create a new list</SelectItem>
                  {lists.map((list) => (
                    <SelectItem key={list._id} value={list._id}>
                      {list.name} ({list.candidateCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {(query || selectedListId === CREATE_NEW_VALUE) && (
            <>
              <div className="space-y-2">
                <Label htmlFor="candidate-list-name">List name</Label>
                <Input
                  id="candidate-list-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Senior product designers - top matches"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="candidate-list-description">Description</Label>
                <Textarea
                  id="candidate-list-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional context for this list"
                  rows={3}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={isSaving || isLoading}>
            {isSaving ? "Saving..." : "Save list"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
