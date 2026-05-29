"use client";

import { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  ListChecks,
  Mail,
  Plus,
  Search,
  Send,
  Signature,
  Trash2,
  Type,
  UserPlus,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { OnboardingStatusBadge } from "@/components/onboarding/status-badge";
import { PdfPagePreview } from "@/components/onboarding/pdf-page-preview";
import { getCandidateById, getCandidatesPaginated, type CandidateData } from "@/services/candidateService";
import { getCandidateList, getCandidateLists, type CandidateListSummary } from "@/services/candidateListService";
import organizationService from "@/services/organizationService";
import {
  createEnvelope,
  getDocumentPreviewBlob,
  getDocuments,
  newSignatureField,
  sendEnvelope,
  startOnboarding,
  type OnboardingDocument,
  type SignatureField,
} from "@/services/onboardingService";
import { toast } from "sonner";

type WizardStep = "candidate" | "documents" | "signers" | "fields" | "send";
type WizardSigner = {
  key: string;
  role: "candidate" | "internal";
  name: string;
  email: string;
  order: number;
  locked?: boolean;
  source?: "candidate" | "member" | "manual";
  memberId?: string;
  roleLabel?: string;
};
type OrganizationMember = {
  _id: string;
  role?: string;
  status?: string;
  user?: {
    _id?: string;
    email?: string;
    profile?: {
      firstName?: string;
      lastName?: string;
      displayName?: string;
    };
  };
};
type FieldResizeHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
type FieldInteraction =
  | { mode: "move"; id: string; dx: number; dy: number }
  | { mode: "resize"; id: string; handle: FieldResizeHandle; startX: number; startY: number; startField: SignatureField };

const steps: Array<{ key: WizardStep; label: string }> = [
  { key: "candidate", label: "Candidate" },
  { key: "documents", label: "Documents" },
  { key: "signers", label: "Signers" },
  { key: "fields", label: "Fields" },
  { key: "send", label: "Send" },
];

const fieldIcons = {
  signature: Signature,
  date: CalendarDays,
  name: UserRound,
  email: Mail,
  text: Type,
};

const resizeHandles: FieldResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const resizeHandleClassNames: Record<FieldResizeHandle, string> = {
  n: "left-1/2 top-[-6px] -translate-x-1/2 cursor-ns-resize",
  s: "bottom-[-6px] left-1/2 -translate-x-1/2 cursor-ns-resize",
  e: "right-[-6px] top-1/2 -translate-y-1/2 cursor-ew-resize",
  w: "left-[-6px] top-1/2 -translate-y-1/2 cursor-ew-resize",
  nw: "left-[-6px] top-[-6px] cursor-nwse-resize",
  ne: "right-[-6px] top-[-6px] cursor-nesw-resize",
  sw: "bottom-[-6px] left-[-6px] cursor-nesw-resize",
  se: "bottom-[-6px] right-[-6px] cursor-nwse-resize",
};

const MIN_FIELD_WIDTH = 0.06;
const MIN_FIELD_HEIGHT = 0.035;

function candidateName(candidate: CandidateData) {
  return `${candidate.firstName || ""} ${candidate.lastName || ""}`.trim() || candidate.email || "Candidate";
}

function candidateStatus(candidate: CandidateData) {
  return (candidate.status || "Candidate").replace(/_/g, " ");
}

function signerKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function memberName(member: OrganizationMember) {
  const profile = member.user?.profile || {};
  return profile.displayName ||
    `${profile.firstName || ""} ${profile.lastName || ""}`.trim() ||
    member.user?.email ||
    "Team member";
}

function memberEmail(member: OrganizationMember) {
  return member.user?.email || "";
}

function memberRoleLabel(role?: string) {
  return (role || "member").replace(/_/g, " ");
}

function roundUnit(value: number) {
  return Number(value.toFixed(4));
}

function clampUnit(value: number, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampFieldRect(rect: Pick<SignatureField, "x" | "y" | "width" | "height">) {
  const width = clampUnit(rect.width, MIN_FIELD_WIDTH, 1);
  const height = clampUnit(rect.height, MIN_FIELD_HEIGHT, 1);
  return {
    width: roundUnit(width),
    height: roundUnit(height),
    x: roundUnit(clampUnit(rect.x, 0, 1 - width)),
    y: roundUnit(clampUnit(rect.y, 0, 1 - height)),
  };
}

function fieldLabel(signer: WizardSigner, type: SignatureField["type"]) {
  const noun = type === "signature" ? "signature" : type === "date" ? "date signed" : type;
  return `${signer.name || signer.email || "Signer"} ${noun}`;
}

function normalizeDocumentFields(document: OnboardingDocument, signers: WizardSigner[]) {
  const signerKeys = new Set(signers.map((signer) => signer.key));
  const candidateSigner = signers.find((signer) => signer.role === "candidate");
  const firstInternalSigner = signers.find((signer) => signer.role === "internal");
  const sourceFields = document.signatureFields?.length ? document.signatureFields : [newSignatureField("candidate")];

  return sourceFields.map((field) => {
    const fallbackSigner = field.role === "internal" ? firstInternalSigner || candidateSigner : candidateSigner;
    const signer = field.signerKey && signerKeys.has(field.signerKey)
      ? signers.find((item) => item.key === field.signerKey)
      : fallbackSigner;

    return {
      ...field,
      signerKey: signer?.key || "candidate-primary",
      role: signer?.role || field.role || "candidate",
      label: field.label || (signer ? fieldLabel(signer, field.type) : field.type),
      ...clampFieldRect(field),
    };
  });
}

export default function NewOnboardingPage() {
  const searchParams = useSearchParams();
  const initialCandidateId = searchParams.get("candidateId") || "";
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [step, setStep] = useState<WizardStep>("candidate");
  const [candidates, setCandidates] = useState<CandidateData[]>([]);
  const [documents, setDocuments] = useState<OnboardingDocument[]>([]);
  const [candidateLists, setCandidateLists] = useState<CandidateListSummary[]>([]);
  const [organizationMembers, setOrganizationMembers] = useState<OrganizationMember[]>([]);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateData | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [selectedCandidateListId, setSelectedCandidateListId] = useState("all");
  const [candidateListLoading, setCandidateListLoading] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [manualSigners, setManualSigners] = useState<WizardSigner[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [documentFieldsById, setDocumentFieldsById] = useState<Record<string, SignatureField[]>>({});
  const [activeDocumentId, setActiveDocumentId] = useState("");
  const [activeFieldId, setActiveFieldId] = useState("");
  const [placementSignerKey, setPlacementSignerKey] = useState("candidate-primary");
  const [placementFieldType, setPlacementFieldType] = useState<SignatureField["type"]>("signature");
  const [fieldPreviewBlob, setFieldPreviewBlob] = useState<Blob | null>(null);
  const [fieldPreviewLoading, setFieldPreviewLoading] = useState(false);
  const [fieldPreviewError, setFieldPreviewError] = useState("");
  const [fieldPreviewPage, setFieldPreviewPage] = useState(1);
  const [fieldPreviewPageCount, setFieldPreviewPageCount] = useState(1);
  const [fieldPreviewPageSize, setFieldPreviewPageSize] = useState<{ width: number; height: number } | null>(null);
  const [interaction, setInteraction] = useState<FieldInteraction | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [sendingNow, setSendingNow] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const documentResult = await getDocuments();
        setDocuments(documentResult.filter((document) => document.status !== "archived"));

        if (selectedCandidateListId !== "all") return;

        const candidateResult = await getCandidatesPaginated({ page: 1, limit: 100, search: candidateSearch });
        setCandidates(candidateResult.candidates || []);
      } catch (error: any) {
        toast.error(error.message || "Failed to load onboarding data");
      }
    }
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [candidateSearch, selectedCandidateListId]);

  useEffect(() => {
    let cancelled = false;

    async function loadLists() {
      try {
        const lists = await getCandidateLists();
        if (!cancelled) setCandidateLists(lists);
      } catch (error: any) {
        if (!cancelled) toast.error(error.message || "Failed to load candidate lists");
      }
    }

    loadLists();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadMembers() {
      try {
        const result = await organizationService.getOrganizationMembers();
        if (!cancelled) setOrganizationMembers(result.members || []);
      } catch (error: any) {
        if (!cancelled) {
          setOrganizationMembers([]);
          toast.error(error.message || "Failed to load recruiter list");
        }
      }
    }

    loadMembers();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!initialCandidateId) return;
    async function loadCandidate() {
      try {
        const candidate = await getCandidateById(initialCandidateId);
        setSelectedCandidate(candidate);
        setSelectedCandidateIds([candidate._id]);
        setCandidateSearch(candidateName(candidate));
        setStep("documents");
      } catch (error: any) {
        toast.error(error.message || "Failed to preselect candidate");
      }
    }
    loadCandidate();
  }, [initialCandidateId]);

  const selectedCandidates = useMemo(() => {
    const byId = new Map(candidates.map((candidate) => [candidate._id, candidate]));
    if (selectedCandidate && !byId.has(selectedCandidate._id)) {
      byId.set(selectedCandidate._id, selectedCandidate);
    }
    return selectedCandidateIds
      .map((id) => byId.get(id))
      .filter(Boolean) as CandidateData[];
  }, [candidates, selectedCandidate, selectedCandidateIds]);

  const selectedCandidateCount = selectedCandidateIds.length;

  const candidateSigner = useMemo<WizardSigner | null>(() => {
    if (!selectedCandidateCount) return null;
    if (selectedCandidateCount > 1) {
      return {
        key: "candidate-primary",
        role: "candidate",
        name: `${selectedCandidateCount} selected candidates`,
        email: "Set per candidate",
        order: 1,
        locked: true,
        source: "candidate",
      };
    }
    if (!selectedCandidate) return null;
    return {
      key: "candidate-primary",
      role: "candidate",
      name: candidateName(selectedCandidate),
      email: selectedCandidate.email || "",
      order: 1,
      locked: true,
      source: "candidate",
    };
  }, [selectedCandidate, selectedCandidateCount]);

  const signers = useMemo(() => {
    const roster = candidateSigner ? [candidateSigner, ...manualSigners] : manualSigners;
    return roster
      .map((signer, index) => ({ ...signer, order: Math.max(1, Number(signer.order || index + 1)) }))
      .sort((a, b) => a.order - b.order);
  }, [candidateSigner, manualSigners]);

  const selectedDocuments = useMemo(
    () => documents.filter((document) => selectedDocumentIds.includes(document._id)),
    [documents, selectedDocumentIds]
  );
  const recruiterMembers = useMemo(() => {
    const allowedRoles = new Set(["owner", "admin", "hr_manager", "recruiter", "hiring_manager", "interviewer"]);
    return organizationMembers
      .filter((member) => member.status !== "inactive")
      .filter((member) => memberEmail(member))
      .filter((member) => !member.role || allowedRoles.has(member.role))
      .sort((a, b) => memberName(a).localeCompare(memberName(b)));
  }, [organizationMembers]);

  const activeDocument = selectedDocuments.find((document) => document._id === activeDocumentId) || selectedDocuments[0];
  const activeDocumentFields = activeDocument ? documentFieldsById[activeDocument._id] || [] : [];
  const visibleFields = activeDocumentFields.filter((field) => field.page === fieldPreviewPage);
  const activeField = activeDocumentFields.find((field) => field.id === activeFieldId);

  useEffect(() => {
    if (!selectedDocuments.length) {
      setActiveDocumentId("");
      return;
    }
    if (!selectedDocuments.some((document) => document._id === activeDocumentId)) {
      setActiveDocumentId(selectedDocuments[0]._id);
      setFieldPreviewPage(1);
    }
  }, [activeDocumentId, selectedDocuments]);

  useEffect(() => {
    setDocumentFieldsById((current) => {
      const next: Record<string, SignatureField[]> = {};
      selectedDocuments.forEach((document) => {
        next[document._id] = current[document._id] || normalizeDocumentFields(document, signers);
      });
      return next;
    });
  }, [selectedDocuments, signers]);

  useEffect(() => {
    const validKeys = new Set(signers.map((signer) => signer.key));
    if (!validKeys.has(placementSignerKey)) {
      setPlacementSignerKey(signers[0]?.key || "candidate-primary");
    }

    setDocumentFieldsById((current) => {
      const next: Record<string, SignatureField[]> = {};
      Object.entries(current).forEach(([documentId, fields]) => {
        next[documentId] = fields.map((field) => {
          const signer = field.signerKey && validKeys.has(field.signerKey)
            ? signers.find((item) => item.key === field.signerKey)
            : signers[0];
          return {
            ...field,
            signerKey: signer?.key || "candidate-primary",
            role: signer?.role || field.role || "candidate",
          };
        });
      });
      return next;
    });
  }, [placementSignerKey, signers]);

  useEffect(() => {
    if (!activeDocument?._id) {
      setFieldPreviewBlob(null);
      return;
    }

    let cancelled = false;
    async function loadPreview() {
      try {
        setFieldPreviewLoading(true);
        setFieldPreviewError("");
        const blob = await getDocumentPreviewBlob(activeDocument!._id);
        if (!cancelled) setFieldPreviewBlob(blob);
      } catch (error: any) {
        if (!cancelled) {
          setFieldPreviewBlob(null);
          setFieldPreviewError(error.message || "Failed to load document preview");
        }
      } finally {
        if (!cancelled) setFieldPreviewLoading(false);
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [activeDocument?._id, activeDocument?.pdfSnapshot?.renderedAt, activeDocument?.updatedAt]);

  const handlePreviewPageCount = useCallback((count: number) => {
    setFieldPreviewPageCount(count);
    setFieldPreviewPage((page) => Math.max(1, Math.min(page, count)));
  }, []);

  const handlePreviewPageRendered = useCallback((page: { width: number; height: number }) => {
    setFieldPreviewPageSize({ width: page.width, height: page.height });
  }, []);

  function setCandidateSelection(nextIds: string[], candidatePool = candidates) {
    const uniqueIds = [...new Set(nextIds)];
    setSelectedCandidateIds(uniqueIds);
    const firstCandidate = candidatePool.find((candidate) => candidate._id === uniqueIds[0]) || null;
    setSelectedCandidate(firstCandidate);
  }

  function toggleCandidate(candidate: CandidateData) {
    setSelectedCandidateIds((current) => {
      const next = current.includes(candidate._id)
        ? current.filter((id) => id !== candidate._id)
        : [...current, candidate._id];
      const firstCandidate = candidates.find((item) => item._id === next[0]) || null;
      setSelectedCandidate(firstCandidate);
      return next;
    });
  }

  async function handleCandidateListChange(listId: string) {
    setSelectedCandidateListId(listId);
    setCandidateSearch("");

    if (listId === "all") {
      setCandidateSelection([]);
      return;
    }

    try {
      setCandidateListLoading(true);
      const list = await getCandidateList(listId);
      const listCandidates = list.entries
        .map((entry) => typeof entry.candidate === "object" ? entry.candidate : null)
        .filter(Boolean) as CandidateData[];
      setCandidates(listCandidates);
      setCandidateSelection(listCandidates.map((candidate) => candidate._id), listCandidates);
    } catch (error: any) {
      toast.error(error.message || "Failed to load candidate list");
    } finally {
      setCandidateListLoading(false);
    }
  }

  function toggleVisibleCandidates() {
    const visibleIds = candidates.map((candidate) => candidate._id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedCandidateIds.includes(id));
    const nextIds = allSelected
      ? selectedCandidateIds.filter((id) => !visibleIds.includes(id))
      : [...selectedCandidateIds, ...visibleIds];
    setCandidateSelection(nextIds);
  }

  async function selectAllMatchingCandidates() {
    try {
      setCandidateListLoading(true);
      const result = await getCandidatesPaginated({ page: 1, limit: 5000, search: candidateSearch || undefined });
      const nextCandidates = result.candidates || [];
      setSelectedCandidateListId("all");
      setCandidates(nextCandidates);
      setCandidateSelection(nextCandidates.map((candidate) => candidate._id), nextCandidates);
      if (result.total > nextCandidates.length) {
        toast.info(`Selected ${nextCandidates.length.toLocaleString()} candidates. Narrow the search to select beyond the 5,000 limit.`);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to select matching candidates");
    } finally {
      setCandidateListLoading(false);
    }
  }

  function toggleDocument(id: string) {
    setSelectedDocumentIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function addManualSigner() {
    setManualSigners((current) => [
      ...current,
      {
        key: signerKey("internal"),
        role: "internal",
        name: "",
        email: "",
        order: current.length + 2,
        source: "manual",
      },
    ]);
  }

  function addRecruiterSigner(memberId = selectedMemberId) {
    const member = recruiterMembers.find((item) => item._id === memberId);
    if (!member) {
      toast.error("Select a recruiter first");
      return;
    }

    const email = memberEmail(member).trim().toLowerCase();
    if (signers.some((signer) => signer.email.trim().toLowerCase() === email)) {
      toast.error("That signer is already added");
      return;
    }

    setManualSigners((current) => [
      ...current,
      {
        key: signerKey("internal-member"),
        role: "internal",
        name: memberName(member),
        email,
        order: current.length + 2,
        source: "member",
        memberId: member._id,
        roleLabel: memberRoleLabel(member.role),
      },
    ]);
    setSelectedMemberId("");
  }

  function updateManualSigner(key: string, patch: Partial<WizardSigner>) {
    setManualSigners((current) => current.map((signer) => signer.key === key ? { ...signer, ...patch } : signer));
  }

  function removeManualSigner(key: string) {
    setManualSigners((current) => current.filter((signer) => signer.key !== key));
  }

  function updateActiveDocumentFields(updater: (fields: SignatureField[]) => SignatureField[]) {
    if (!activeDocument) return;
    setDocumentFieldsById((current) => ({
      ...current,
      [activeDocument._id]: updater(current[activeDocument._id] || []),
    }));
  }

  function updateField(id: string, patch: Partial<SignatureField>) {
    updateActiveDocumentFields((fields) => fields.map((field) => field.id === id ? { ...field, ...patch } : field));
  }

  function updateFieldRect(id: string, patch: Partial<Pick<SignatureField, "x" | "y" | "width" | "height">>) {
    updateActiveDocumentFields((fields) => fields.map((field) => {
      if (field.id !== id) return field;
      return {
        ...field,
        ...clampFieldRect({
          x: patch.x ?? field.x,
          y: patch.y ?? field.y,
          width: patch.width ?? field.width,
          height: patch.height ?? field.height,
        }),
      };
    }));
  }

  function removeField(id: string) {
    updateActiveDocumentFields((fields) => fields.filter((field) => field.id !== id));
    if (activeFieldId === id) setActiveFieldId("");
  }

  function addPlacementField() {
    if (!activeDocument) return;
    const signer = signers.find((item) => item.key === placementSignerKey) || signers[0];
    if (!signer) {
      toast.error("Add a signer first");
      return;
    }

    const base = newSignatureField(signer.role);
    const field: SignatureField = {
      ...base,
      id: `${signer.key}-${placementFieldType}-${Date.now()}`,
      signerKey: signer.key,
      role: signer.role,
      type: placementFieldType,
      label: fieldLabel(signer, placementFieldType),
      page: fieldPreviewPage,
      x: 0.12,
      y: placementFieldType === "date" ? 0.78 : 0.68,
      width: placementFieldType === "signature" ? 0.32 : 0.22,
      height: placementFieldType === "signature" ? 0.08 : 0.05,
      required: true,
    };
    updateActiveDocumentFields((fields) => [...fields, field]);
    setActiveFieldId(field.id);
  }

  function onMovePointerDown(event: PointerEvent<HTMLDivElement>, field: SignatureField) {
    const page = pageRef.current?.getBoundingClientRect();
    if (!page) return;
    event.preventDefault();
    const fieldLeft = field.x * page.width;
    const fieldTop = field.y * page.height;
    setInteraction({
      mode: "move",
      id: field.id,
      dx: event.clientX - page.left - fieldLeft,
      dy: event.clientY - page.top - fieldTop,
    });
    setActiveFieldId(field.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onResizePointerDown(event: PointerEvent<HTMLSpanElement>, field: SignatureField, handle: FieldResizeHandle) {
    event.preventDefault();
    event.stopPropagation();
    setActiveFieldId(field.id);
    setInteraction({
      mode: "resize",
      id: field.id,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startField: field,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!interaction) return;
    const page = pageRef.current?.getBoundingClientRect();
    if (!page) return;

    if (interaction.mode === "move") {
      const field = activeDocumentFields.find((item) => item.id === interaction.id);
      if (!field) return;
      updateFieldRect(interaction.id, {
        x: (event.clientX - page.left - interaction.dx) / page.width,
        y: (event.clientY - page.top - interaction.dy) / page.height,
      });
      return;
    }

    const dx = (event.clientX - interaction.startX) / page.width;
    const dy = (event.clientY - interaction.startY) / page.height;
    const start = interaction.startField;
    let x = start.x;
    let y = start.y;
    let width = start.width;
    let height = start.height;

    if (interaction.handle.includes("e")) width = start.width + dx;
    if (interaction.handle.includes("s")) height = start.height + dy;
    if (interaction.handle.includes("w")) {
      x = start.x + dx;
      width = start.width - dx;
      if (width < MIN_FIELD_WIDTH) {
        width = MIN_FIELD_WIDTH;
        x = start.x + start.width - MIN_FIELD_WIDTH;
      }
    }
    if (interaction.handle.includes("n")) {
      y = start.y + dy;
      height = start.height - dy;
      if (height < MIN_FIELD_HEIGHT) {
        height = MIN_FIELD_HEIGHT;
        y = start.y + start.height - MIN_FIELD_HEIGHT;
      }
    }

    if (x < 0) {
      width += x;
      x = 0;
    }
    if (y < 0) {
      height += y;
      y = 0;
    }
    if (x + width > 1) width = 1 - x;
    if (y + height > 1) height = 1 - y;

    updateFieldRect(interaction.id, { x, y, width, height });
  }

  function canOpenStep(target: WizardStep) {
    if (target === "candidate") return true;
    if (!selectedCandidateCount) return false;
    if (target === "documents") return true;
    if (!selectedDocumentIds.length) return false;
    if (target === "signers" || target === "fields" || target === "send") return true;
    return false;
  }

  function continueFromDocuments() {
    if (!selectedDocumentIds.length) {
      toast.error("Select at least one document");
      return;
    }
    setStep("signers");
  }

  function continueFromSigners() {
    const missingEmail = signers.some((signer) => !(signer.locked && signer.role === "candidate") && !signer.email.trim());
    if (missingEmail) {
      toast.error("Every signer needs an email address");
      return;
    }
    setStep("fields");
  }

  async function submit() {
    if (!selectedCandidateCount) return toast.error("Select at least one candidate");
    if (!selectedCandidates.length) return toast.error("Selected candidate records are not loaded");

    try {
      setSubmitting(true);
      const createdEnvelopeIds: string[] = [];

      for (const candidate of selectedCandidates) {
        const candidateDisplayName = candidateName(candidate);
        const onboardingResult = await startOnboarding(candidate._id, {
          title: title.trim() || `${candidateDisplayName} onboarding`,
          notes,
        });

        if (!selectedDocumentIds.length) continue;

        const actualCandidateSigner: WizardSigner = {
          key: "candidate-primary",
          role: "candidate",
          name: candidateDisplayName,
          email: candidate.email || "",
          order: 1,
          locked: true,
          source: "candidate",
        };

        const signersForCandidate = signers.map((signer) => (
          signer.locked && signer.role === "candidate"
            ? actualCandidateSigner
            : {
                key: signer.key,
                role: signer.role,
                name: signer.name,
                email: signer.email,
                order: signer.order,
              }
        ));

        const documentFieldsForCandidate = Object.fromEntries(selectedDocumentIds.map((id) => [
          id,
          (documentFieldsById[id] || []).map((field) => (
            field.signerKey === "candidate-primary"
              ? { ...field, role: "candidate" as const, label: fieldLabel(actualCandidateSigner, field.type) }
              : field
          )),
        ]));

        const envelope = await createEnvelope({
          onboardingId: onboardingResult.data._id,
          documentIds: selectedDocumentIds,
          title: title.trim() || `${candidateDisplayName} onboarding packet`,
          message,
          signers: signersForCandidate,
          documentFields: documentFieldsForCandidate,
        });
        if (sendingNow) {
          await sendEnvelope(envelope._id);
        }
        createdEnvelopeIds.push(envelope._id);
      }

      if (selectedDocumentIds.length > 0) {
        toast.success(
          selectedCandidateCount > 1
            ? `${selectedCandidateCount} onboarding packets ${sendingNow ? "created and sent" : "created as drafts"}`
            : sendingNow ? "Onboarding started and sent" : "Onboarding draft created"
        );
        if (createdEnvelopeIds.length === 1) {
          window.location.href = `/onboarding/envelopes/${createdEnvelopeIds[0]}`;
          return;
        }
        window.location.href = "/onboarding";
        return;
      }

      toast.success(selectedCandidateCount > 1 ? `${selectedCandidateCount} onboarding records started` : "Onboarding started");
      window.location.href = "/onboarding";
    } catch (error: any) {
      toast.error(error.message || "Failed to start onboarding");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-screen-2xl px-4 py-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Button asChild variant="ghost" className="-ml-3 mb-2">
              <Link href="/onboarding"><ArrowLeft className="h-4 w-4" /> Back</Link>
            </Button>
            <h1 className="text-3xl font-semibold text-slate-950">Begin onboarding</h1>
            <p className="mt-2 text-sm text-slate-600">Select the candidate, documents, signers, and exact signing fields.</p>
          </div>
          <div className="hidden gap-2 xl:flex">
            {steps.map((item, index) => (
              <button
                key={item.key}
                type="button"
                disabled={!canOpenStep(item.key)}
                onClick={() => canOpenStep(item.key) && setStep(item.key)}
                className={`rounded-md border px-3 py-2 text-sm ${step === item.key ? "border-blue-500 bg-blue-50 text-blue-700" : "bg-white text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"}`}
              >
                {index + 1}. {item.label}
              </button>
            ))}
          </div>
        </div>

        {step === "candidate" && (
          <section className="rounded-md border bg-white">
            <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Candidate</h2>
                <p className="text-sm text-slate-500">
                  {selectedCandidateCount ? `${selectedCandidateCount} selected` : "Choose candidates directly, from a saved list, or from the current search."}
                </p>
              </div>
              <div className="grid gap-2 md:w-[620px] md:grid-cols-[240px_minmax(0,1fr)]">
                <Select value={selectedCandidateListId} onValueChange={handleCandidateListChange} disabled={candidateListLoading}>
                  <SelectTrigger>
                    <SelectValue placeholder="Candidate list" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All candidates</SelectItem>
                    {candidateLists.map((list) => (
                      <SelectItem key={list._id} value={list._id}>
                        {list.name} ({list.candidateCount})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    value={candidateSearch}
                    onChange={(event) => {
                      setSelectedCandidateListId("all");
                      setCandidateSearch(event.target.value);
                    }}
                    placeholder="Search candidates"
                    className="pl-9"
                  />
                </div>
              </div>
            </div>
            <div className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-slate-600">
                  {selectedCandidateCount ? `${selectedCandidateCount} selected for onboarding` : `${candidates.length} visible candidates`}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={toggleVisibleCandidates} disabled={!candidates.length || candidateListLoading}>
                    <ListChecks className="h-4 w-4" />
                    {candidates.length && candidates.every((candidate) => selectedCandidateIds.includes(candidate._id)) ? "Clear visible" : "Select visible"}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={selectAllMatchingCandidates} disabled={candidateListLoading}>
                    Select all matching
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setCandidateSelection([])} disabled={!selectedCandidateCount}>
                    Clear
                  </Button>
                </div>
              </div>
              <div className="h-[440px] overflow-auto rounded-md border">
                <table className="w-full min-w-[760px] caption-bottom text-sm">
                  <TableHeader className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                    <TableRow className="hover:bg-white">
                      <TableHead className="w-14">
                        <Checkbox
                          checked={candidates.length > 0 && candidates.every((candidate) => selectedCandidateIds.includes(candidate._id))}
                          onCheckedChange={toggleVisibleCandidates}
                          aria-label="Select visible candidates"
                        />
                      </TableHead>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-28 text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidates.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="h-40 text-center text-sm text-slate-500">
                          No candidates found.
                        </TableCell>
                      </TableRow>
                    ) : candidates.map((candidate) => {
                      const selected = selectedCandidateIds.includes(candidate._id);
                      return (
                        <TableRow
                          key={candidate._id}
                          aria-selected={selected}
                          data-state={selected ? "selected" : undefined}
                          onClick={() => toggleCandidate(candidate)}
                          className={`cursor-pointer ${selected ? "bg-blue-50 hover:bg-blue-50" : "hover:bg-slate-50"}`}
                        >
                          <TableCell>
                            <Checkbox
                              checked={selected}
                              onCheckedChange={() => toggleCandidate(candidate)}
                              onClick={(event) => event.stopPropagation()}
                              aria-label={`Select ${candidateName(candidate)}`}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-slate-950">{candidateName(candidate)}</div>
                          </TableCell>
                          <TableCell className="text-slate-600">{candidate.email || "-"}</TableCell>
                          <TableCell className="text-slate-600">{candidate.position || "-"}</TableCell>
                          <TableCell>
                            <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium capitalize text-slate-600">
                              {candidateStatus(candidate)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant={selected ? "default" : "outline"}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleCandidate(candidate);
                              }}
                            >
                              {selected ? "Remove" : "Select"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </table>
              </div>
            </div>
            <div className="flex justify-end border-t p-4">
              <Button disabled={!selectedCandidateCount} onClick={() => setStep("documents")}>Continue</Button>
            </div>
          </section>
        )}

        {step === "documents" && (
          <section className="rounded-md border bg-white">
            <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Documents</h2>
                <p className="text-sm text-slate-500">Choose the documents that will receive signer fields.</p>
              </div>
              <Button asChild variant="outline">
                <Link href="/onboarding/documents/new"><FileText className="h-4 w-4" /> Build document</Link>
              </Button>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {documents.map((document) => {
                const selected = selectedDocumentIds.includes(document._id);
                return (
                  <div
                    key={document._id}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleDocument(document._id)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      toggleDocument(document._id);
                    }}
                    className={`rounded-md border p-4 text-left ${selected ? "border-blue-500 bg-blue-50" : "bg-white hover:bg-slate-50"}`}
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="font-semibold text-slate-950">{document.title}</div>
                      <span onClick={(event) => event.stopPropagation()}>
                        <Checkbox checked={selected} onCheckedChange={() => toggleDocument(document._id)} />
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <OnboardingStatusBadge status={document.status} />
                      <span className="text-xs text-slate-500">{document.signatureFields?.length || 0} saved fields</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between border-t p-4">
              <Button variant="outline" onClick={() => setStep("candidate")}>Back</Button>
              <Button onClick={continueFromDocuments}>Continue</Button>
            </div>
          </section>
        )}

        {step === "signers" && (
          <section className="rounded-md border bg-white">
            <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Signers</h2>
                <p className="text-sm text-slate-500">Select an internal recruiter or add a manual signer before placing fields.</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Select value={selectedMemberId || undefined} onValueChange={setSelectedMemberId}>
                  <SelectTrigger className="w-full sm:w-72">
                    <SelectValue placeholder={recruiterMembers.length ? "Select recruiter" : "No recruiters found"} />
                  </SelectTrigger>
                  <SelectContent>
                    {recruiterMembers.map((member) => (
                      <SelectItem key={member._id} value={member._id}>
                        {memberName(member)} - {memberRoleLabel(member.role)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={() => addRecruiterSigner()} disabled={!selectedMemberId}>
                  <UserPlus className="h-4 w-4" />
                  Add recruiter
                </Button>
                <Button type="button" onClick={addManualSigner}>
                  <Plus className="h-4 w-4" />
                  Add manual
                </Button>
              </div>
            </div>
            <div className="p-4">
              <div className="overflow-hidden rounded-md border">
                <table className="w-full min-w-[820px] text-sm">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Order</TableHead>
                      <TableHead>Signer</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead className="w-36">Type</TableHead>
                      <TableHead className="w-20 text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {signers.map((signer) => {
                      const detailsLocked = signer.locked || signer.source === "member";
                      return (
                        <TableRow key={signer.key}>
                          <TableCell>
                            <Input
                              type="number"
                              min="1"
                              value={signer.order}
                              disabled={signer.locked}
                              onChange={(event) => updateManualSigner(signer.key, { order: Number(event.target.value) || signer.order })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={signer.name}
                              disabled={detailsLocked}
                              placeholder="Signer name"
                              onChange={(event) => updateManualSigner(signer.key, { name: event.target.value })}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="email"
                              value={signer.email}
                              disabled={detailsLocked}
                              placeholder="name@example.com"
                              onChange={(event) => updateManualSigner(signer.key, { email: event.target.value })}
                            />
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium capitalize text-slate-600">
                              {signer.role === "candidate" ? "Candidate" : signer.source === "member" ? signer.roleLabel || "Recruiter" : "Manual"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            {!signer.locked && (
                              <Button type="button" variant="ghost" size="icon" onClick={() => removeManualSigner(signer.key)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </table>
              </div>
            </div>
            <div className="flex justify-between border-t p-4">
              <Button variant="outline" onClick={() => setStep("documents")}>Back</Button>
              <Button onClick={continueFromSigners}>Continue to field placement</Button>
            </div>
          </section>
        )}

        {step === "fields" && (
          <section className="rounded-md border bg-white">
            <div className="grid gap-0 xl:grid-cols-[240px_minmax(0,1fr)_330px]">
              <aside className="border-b p-4 xl:border-b-0 xl:border-r">
                <h2 className="text-lg font-semibold text-slate-950">Documents</h2>
                <div className="mt-4 grid gap-2">
                  {selectedDocuments.map((document) => (
                    <button
                      key={document._id}
                      type="button"
                      onClick={() => {
                        setActiveDocumentId(document._id);
                        setFieldPreviewPage(1);
                        setActiveFieldId("");
                      }}
                      className={`rounded-md border p-3 text-left text-sm ${activeDocument?._id === document._id ? "border-blue-500 bg-blue-50" : "hover:bg-slate-50"}`}
                    >
                      <div className="font-medium text-slate-950">{document.title}</div>
                      <div className="text-xs text-slate-500">{documentFieldsById[document._id]?.length || 0} fields</div>
                    </button>
                  ))}
                </div>
              </aside>

              <main className="p-4">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm font-medium text-slate-700">Page {fieldPreviewPage} of {fieldPreviewPageCount}</div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={fieldPreviewPage <= 1} onClick={() => setFieldPreviewPage((page) => Math.max(1, page - 1))}>
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={fieldPreviewPage >= fieldPreviewPageCount} onClick={() => setFieldPreviewPage((page) => Math.min(fieldPreviewPageCount, page + 1))}>
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div
                  ref={pageRef}
                  onPointerMove={onPointerMove}
                  onPointerUp={() => setInteraction(null)}
                  onPointerCancel={() => setInteraction(null)}
                  className="relative mx-auto w-full max-w-[760px] select-none overflow-hidden border bg-white shadow-sm"
                  style={{
                    aspectRatio: fieldPreviewPageSize ? `${fieldPreviewPageSize.width} / ${fieldPreviewPageSize.height}` : "8.5 / 11",
                    touchAction: "none",
                  }}
                >
                  {fieldPreviewLoading ? (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading document preview...</div>
                  ) : fieldPreviewBlob && activeDocument ? (
                    <PdfPagePreview
                      blob={fieldPreviewBlob}
                      title={activeDocument.title}
                      pageNumber={fieldPreviewPage}
                      onPageCount={handlePreviewPageCount}
                      onPageRendered={handlePreviewPageRendered}
                    />
                  ) : fieldPreviewError ? (
                    <div className="flex h-full items-center justify-center px-8 text-center text-sm text-slate-500">{fieldPreviewError}</div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-500">Select a document to place fields.</div>
                  )}

                  <div className="pointer-events-none absolute inset-0">
                    {visibleFields.map((field) => {
                      const Icon = fieldIcons[field.type] || Signature;
                      const signer = signers.find((item) => item.key === field.signerKey);
                      return (
                        <div
                          key={field.id}
                          role="button"
                          tabIndex={0}
                          onPointerDown={(event) => onMovePointerDown(event, field)}
                          className={`pointer-events-auto absolute flex cursor-move items-center gap-1 rounded border px-2 text-left text-[11px] font-medium shadow-sm ${activeFieldId === field.id ? "border-blue-500 bg-blue-50 text-blue-700" : "border-emerald-500 bg-emerald-50 text-emerald-700"}`}
                          style={{
                            left: `${field.x * 100}%`,
                            top: `${field.y * 100}%`,
                            width: `${field.width * 100}%`,
                            height: `${field.height * 100}%`,
                          }}
                        >
                          <Icon className="h-3 w-3" />
                          <span className="truncate">{field.label || signer?.name || field.type}</span>
                          {activeFieldId === field.id && resizeHandles.map((handle) => (
                            <span
                              key={handle}
                              aria-label={`Resize ${handle}`}
                              data-resize-handle={handle}
                              onPointerDown={(event) => onResizePointerDown(event, field, handle)}
                              className={`absolute h-3 w-3 rounded-sm border border-blue-600 bg-white shadow-sm ${resizeHandleClassNames[handle]}`}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </main>

              <aside className="border-t p-4 xl:border-l xl:border-t-0">
                <h2 className="text-lg font-semibold text-slate-950">Fields</h2>
                <div className="mt-4 space-y-3">
                  <div className="space-y-2">
                    <Label>Signer</Label>
                    <Select value={placementSignerKey} onValueChange={setPlacementSignerKey}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {signers.map((signer) => (
                          <SelectItem key={signer.key} value={signer.key}>{signer.name || signer.email || signer.role}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Field type</Label>
                    <Select value={placementFieldType} onValueChange={(value: SignatureField["type"]) => setPlacementFieldType(value)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="signature">Signature</SelectItem>
                        <SelectItem value="date">Date</SelectItem>
                        <SelectItem value="name">Name</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="text">Text</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" className="w-full" onClick={addPlacementField} disabled={!activeDocument || !signers.length}>
                    <Plus className="h-4 w-4" />
                    Add field
                  </Button>
                </div>

                {activeField ? (
                  <div className="mt-5 space-y-4 border-t pt-4">
                    <div className="space-y-2">
                      <Label>Assigned signer</Label>
                      <Select
                        value={activeField.signerKey || placementSignerKey}
                        onValueChange={(value) => {
                          const signer = signers.find((item) => item.key === value);
                          if (!signer) return;
                          updateField(activeField.id, {
                            signerKey: signer.key,
                            role: signer.role,
                            label: fieldLabel(signer, activeField.type),
                          });
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {signers.map((signer) => (
                            <SelectItem key={signer.key} value={signer.key}>{signer.name || signer.email || signer.role}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Label</Label>
                      <Input value={activeField.label || ""} onChange={(event) => updateField(activeField.id, { label: event.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {(["x", "y", "width", "height"] as const).map((key) => (
                        <div key={key} className="space-y-2">
                          <Label>{key}</Label>
                          <Input type="number" step="0.01" min="0" max="1" value={activeField[key]} onChange={(event) => updateFieldRect(activeField.id, { [key]: Number(event.target.value) })} />
                        </div>
                      ))}
                    </div>
                    <Button type="button" variant="destructive" className="w-full" onClick={() => removeField(activeField.id)}>
                      <Trash2 className="h-4 w-4" />
                      Remove field
                    </Button>
                  </div>
                ) : (
                  <p className="mt-5 border-t pt-4 text-sm text-slate-500">Select a field on the document to edit it.</p>
                )}
              </aside>
            </div>
            <div className="flex justify-between border-t p-4">
              <Button variant="outline" onClick={() => setStep("signers")}>Back</Button>
              <Button onClick={() => setStep("send")}>Continue</Button>
            </div>
          </section>
        )}

        {step === "send" && (
          <section className="rounded-md border bg-white p-4">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Packet title</Label>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={selectedCandidateCount === 1 && selectedCandidate ? `${candidateName(selectedCandidate)} onboarding packet` : "Onboarding packet"} />
                </div>
                <div className="space-y-2">
                  <Label>Internal notes</Label>
                  <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-24" />
                </div>
                <div className="space-y-2">
                  <Label>Candidate message</Label>
                  <Textarea value={message} onChange={(event) => setMessage(event.target.value)} className="min-h-24" />
                </div>
                <label className="flex items-center gap-3 rounded-md border p-3 text-sm">
                  <Checkbox checked={sendingNow} onCheckedChange={(checked) => setSendingNow(Boolean(checked))} />
                  Send the packet immediately after creating it
                </label>
              </div>

              <aside className="rounded-md border bg-slate-50 p-4">
                <h2 className="font-semibold text-slate-950">Summary</h2>
                <div className="mt-4 space-y-4 text-sm">
                  <div>
                    <div className="text-xs uppercase text-slate-500">Candidates</div>
                    <div className="font-medium text-slate-950">{selectedCandidateCount ? `${selectedCandidateCount} selected` : "Not selected"}</div>
                    {selectedCandidateCount === 1 && selectedCandidate ? (
                      <div className="text-slate-500">{selectedCandidate.email}</div>
                    ) : (
                      <div className="text-slate-500">One packet is created per candidate.</div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs uppercase text-slate-500">Signers</div>
                    <div className="mt-2 space-y-2">
                      {signers.map((signer) => (
                        <div key={signer.key} className="rounded border bg-white px-3 py-2">
                          <div className="font-medium text-slate-900">{signer.name || signer.email}</div>
                          <div className="text-xs text-slate-500">{signer.email} - order {signer.order}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-slate-500">Documents</div>
                    <div className="mt-2 space-y-2">
                      {selectedDocuments.map((document) => (
                        <div key={document._id} className="rounded border bg-white px-3 py-2">
                          <div className="font-medium text-slate-900">{document.title}</div>
                          <div className="text-xs text-slate-500">{documentFieldsById[document._id]?.length || 0} fields</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Button className="w-full" onClick={submit} disabled={submitting || !selectedCandidateCount || !selectedDocumentIds.length}>
                    {sendingNow ? <Send className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                    {submitting ? "Creating..." : sendingNow ? "Create and send" : "Create draft"}
                  </Button>
                </div>
              </aside>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
