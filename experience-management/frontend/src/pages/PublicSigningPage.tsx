import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, ChevronRight, Clock3, Download, FileSignature, Library,
  Loader2, LockKeyhole, PenLine, Pencil, ShieldCheck, Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { Link, useParams } from '@/lib/router';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { SignatureCanvas, SigningDocument } from '@/components/esign/SigningDocument';
import type {
  AuthSession, ESignField, ESignPublicDetail, ESignPublicSession, ESignSavedSignature,
  ESignSignatureLibrary, ESignSignatureMode, ESignSignatureValue
} from '@/types';

function isComplete(field: ESignField) {
  if (!field.required || field.hasValue === true) return true;
  if (field.type === 'checkbox') return field.value === true;
  if (typeof field.value === 'object' && field.value) {
    const signature = field.value as ESignSignatureValue;
    return Boolean(signature.value || signature.dataUrl || signature.displayText || signature.previewUrl);
  }
  if (Array.isArray(field.value)) return field.value.length > 0;
  return String(field.value ?? '').trim().length > 0;
}

function initialsFor(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 3).map((part) => part[0]?.toUpperCase()).join('').slice(0, 12);
}

function valuePresent(field: ESignField, value: ESignField['value']) {
  if (['name', 'email', 'date_signed'].includes(field.type)) return true;
  if (field.type === 'checkbox') return value === true;
  if (typeof value === 'object' && value && !Array.isArray(value)) {
    const signature = value as ESignSignatureValue;
    return Boolean(signature.value || signature.dataUrl || signature.displayText || signature.previewUrl);
  }
  if (Array.isArray(value)) return value.length > 0;
  return String(value ?? '').trim().length > 0;
}

function readableStatus(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMoment(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : '';
}

function PublicFrame({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background">
    <header className="flex h-14 items-center border-b bg-card px-4 sm:px-6">
      <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">S</div>
      <div className="ml-2 text-sm font-semibold">Seemplify eSignature</div>
    </header>
    {children}
  </div>;
}

function SavedSignaturePreview({ signature }: { signature: ESignSavedSignature }) {
  return <div className="flex h-14 w-full items-center justify-center overflow-hidden border bg-white px-3 text-slate-900">
    {signature.previewUrl
      ? <img src={signature.previewUrl} className="h-full max-w-full object-contain" alt={`${signature.label} preview`} />
      : <span className="truncate font-serif text-xl italic">{signature.displayText || 'Saved signature'}</span>}
  </div>;
}

export function PublicSigningPage() {
  const params = useParams<{ token?: string }>();
  const token = params.token || new URLSearchParams(window.location.search).get('token') || '';
  const [session, setSession] = useState<ESignPublicSession | null>(null);
  const [detail, setDetail] = useState<ESignPublicDetail | null>(null);
  const [accountSession, setAccountSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [signatureField, setSignatureField] = useState<ESignField | null>(null);
  const [signatureMode, setSignatureMode] = useState<ESignSignatureMode>('typed');
  const [typedSignature, setTypedSignature] = useState('');
  const [drawnSignature, setDrawnSignature] = useState('');
  const [uploadedSignature, setUploadedSignature] = useState('');
  const [signatureLabel, setSignatureLabel] = useState('');
  const [editingSignatureId, setEditingSignatureId] = useState<string | null>(null);
  const [signatureLibrary, setSignatureLibrary] = useState<ESignSignatureLibrary | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [signatureWorking, setSignatureWorking] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [completed, setCompleted] = useState(false);
  const [pendingSaves, setPendingSaves] = useState(0);
  const pendingSavesRef = useRef(0);

  async function loadDetail() {
    const next = await api<ESignPublicDetail>('/api/public/esign/envelope');
    setDetail(next);
    setSession(next);
    setCompleted(next.recipient.status === 'completed' || next.envelope.status === 'completed');
  }

  async function loadSignatureLibrary() {
    try {
      setLibraryLoading(true);
      setLibraryError('');
      setSignatureLibrary(await api<ESignSignatureLibrary>('/api/public/esign/signatures'));
    } catch (reason) {
      setLibraryError(reason instanceof Error ? reason.message : 'Saved signatures could not be loaded.');
    } finally {
      setLibraryLoading(false);
    }
  }

  useEffect(() => {
    void api<AuthSession>('/api/auth/session').then(setAccountSession).catch(() => undefined);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const next = token
          ? await api<ESignPublicSession>('/api/public/esign/session', json('POST', { token }))
          : await api<ESignPublicSession>('/api/public/esign/session');
        if (token) window.history.replaceState({}, document.title, '/sign');
        setSession(next);
        if (next.authenticated && (next.consented || next.envelope.status === 'completed')) {
          await loadDetail();
          if (next.consented && next.envelope.status !== 'completed') await loadSignatureLibrary();
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'This signing link is invalid or no longer available.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    try {
      setWorking(true);
      const next = await api<ESignPublicSession>('/api/public/esign/access-code', json('POST', { code: accessCode }));
      setSession(next);
      setAccessCode('');
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'The access code was not accepted.');
    } finally {
      setWorking(false);
    }
  }

  async function consent() {
    try {
      setWorking(true);
      const next = await api<ESignPublicSession>('/api/public/esign/consent', json('POST', { agreed: true }));
      setSession(next);
      await Promise.all([loadDetail(), loadSignatureLibrary()]);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'Consent could not be recorded.');
    } finally {
      setWorking(false);
    }
  }

  function localField(id: string, value: ESignField['value']) {
    setDetail((current) => current ? {
      ...current,
      fields: current.fields.map((field) => field.id === id
        ? {
          ...field,
          value,
          hasValue: valuePresent(field, value),
          signaturePreview: typeof value === 'object' && value && !Array.isArray(value) && 'mode' in value
            ? null
            : field.signaturePreview
        }
        : field)
    } : current);
  }

  function beginFieldSave() {
    pendingSavesRef.current += 1;
    setPendingSaves(pendingSavesRef.current);
  }

  function finishFieldSave() {
    pendingSavesRef.current = Math.max(0, pendingSavesRef.current - 1);
    setPendingSaves(pendingSavesRef.current);
  }

  async function saveField(id: string, value: ESignField['value']) {
    beginFieldSave();
    try {
      const body = typeof value === 'object' && value && !Array.isArray(value) && 'mode' in value
        ? { signature: value }
        : { value };
      await api(`/api/public/esign/fields/${id}`, json('PUT', body));
      localField(id, value);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'This field could not be saved.');
      await loadDetail().catch(() => undefined);
    } finally {
      finishFieldSave();
    }
  }

  function resetSignatureDraft(field?: ESignField | null) {
    const saved = typeof field?.value === 'object' && field.value ? field.value as ESignSignatureValue : null;
    const nextMode = field?.signaturePreview?.mode || saved?.mode || 'typed';
    setSignatureMode(nextMode);
    setTypedSignature(field?.signaturePreview?.displayText || saved?.displayText || (saved?.value && saved.value !== 'Signature saved' ? saved.value : '')
      || (field?.type === 'initials' ? initialsFor(session?.recipient.name || '') : session?.recipient.name || ''));
    setDrawnSignature('');
    setUploadedSignature('');
    setSignatureLabel(field?.type === 'initials' ? 'My initials' : 'My signature');
    setEditingSignatureId(null);
  }

  function openSignature(field: ESignField) {
    setSignatureField(field);
    resetSignatureDraft(field);
    if (!signatureLibrary && !libraryLoading) void loadSignatureLibrary();
  }

  function signatureInput() {
    return {
      mode: signatureMode,
      ...(signatureLabel.trim() ? { label: signatureLabel.trim() } : {}),
      ...(signatureMode === 'typed' ? { value: typedSignature.trim() }
        : { dataUrl: signatureMode === 'drawn' ? drawnSignature : uploadedSignature })
    };
  }

  function currentSignatureValue(): ESignSignatureValue {
    return signatureMode === 'typed'
      ? { mode: 'typed', value: typedSignature.trim(), displayText: typedSignature.trim() }
      : { mode: signatureMode, dataUrl: signatureMode === 'drawn' ? drawnSignature : uploadedSignature };
  }

  function signatureReady() {
    if (signatureMode === 'typed') return Boolean(typedSignature.trim());
    return Boolean(signatureMode === 'drawn' ? drawnSignature : uploadedSignature);
  }

  function optimisticSavedValue(signature: ESignSavedSignature): ESignSignatureValue {
    return {
      mode: signature.mode,
      value: signature.displayText || 'Signature saved',
      displayText: signature.displayText,
      previewUrl: signature.previewUrl
    };
  }

  async function applySavedSignature(signature: ESignSavedSignature, field = signatureField) {
    if (!field) return;
    localField(field.id, optimisticSavedValue(signature));
    setSignatureField(null);
    beginFieldSave();
    try {
      await api(`/api/public/esign/fields/${field.id}`, json('PUT', { savedSignatureId: signature.id }));
      await loadDetail();
      toast.success('Signature applied');
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'The saved signature could not be applied.');
      await loadDetail().catch(() => undefined);
    } finally {
      finishFieldSave();
    }
  }

  async function applySignatureOnce() {
    if (!signatureField || !signatureReady()) return toast.error('Add a signature before applying it.');
    const field = signatureField;
    const signature = currentSignatureValue();
    localField(field.id, signature);
    setSignatureField(null);
    await saveField(field.id, signature);
  }

  async function saveAndApplySignature() {
    if (!signatureField || !signatureReady()) return toast.error('Add a signature before saving it.');
    const field = signatureField;
    try {
      setSignatureWorking(true);
      const result = editingSignatureId
        ? await api<{ signature: ESignSavedSignature }>(`/api/public/esign/signatures/${editingSignatureId}`, json('PUT', signatureInput()))
        : await api<{ signature: ESignSavedSignature }>('/api/public/esign/signatures', json('POST', signatureInput()));
      setSignatureLibrary((current) => current ? {
        ...current,
        signatures: editingSignatureId
          ? current.signatures.map((item) => item.id === result.signature.id ? result.signature : item)
          : [result.signature, ...current.signatures]
      } : current);
      await applySavedSignature(result.signature, field);
      await loadSignatureLibrary();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'The signature could not be saved for reuse.');
    } finally {
      setSignatureWorking(false);
    }
  }

  function editSavedSignature(signature: ESignSavedSignature) {
    setEditingSignatureId(signature.id);
    setSignatureMode(signature.mode);
    setSignatureLabel(signature.label);
    setTypedSignature(signature.displayText || '');
    setDrawnSignature('');
    setUploadedSignature('');
  }

  async function removeSavedSignature(signature: ESignSavedSignature) {
    if (!window.confirm(`Remove “${signature.label}” from your saved signatures? Signatures already applied to documents will not change.`)) return;
    try {
      setSignatureWorking(true);
      await api(`/api/public/esign/signatures/${signature.id}`, { method: 'DELETE' });
      setSignatureLibrary((current) => current ? { ...current, signatures: current.signatures.filter((item) => item.id !== signature.id) } : current);
      if (editingSignatureId === signature.id) resetSignatureDraft(signatureField);
      toast.success('Saved signature removed');
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'The saved signature could not be removed.');
    } finally {
      setSignatureWorking(false);
    }
  }

  const missing = useMemo(() => detail?.fields.filter((field) => !isComplete(field)) || [], [detail]);

  function nextRequired() {
    const field = missing[0];
    if (!field) return;
    const element = document.querySelector<HTMLElement>(`[data-sign-field-id="${CSS.escape(field.id)}"]`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => element?.focus(), 350);
  }

  async function finish() {
    if (pendingSavesRef.current > 0) return toast.message('Wait for your latest field changes to save.');
    if (missing.length) {
      nextRequired();
      return toast.error(`${missing.length} required field${missing.length === 1 ? ' is' : 's are'} incomplete.`);
    }
    try {
      setWorking(true);
      const next = await api<ESignPublicSession>('/api/public/esign/complete', json('POST', {}));
      setSession(next);
      await loadDetail();
      setCompleted(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'The agreement could not be completed.');
    } finally {
      setWorking(false);
    }
  }

  async function decline() {
    if (declineReason.trim().length < 2) return;
    try {
      setWorking(true);
      await api('/api/public/esign/decline', json('POST', { reason: declineReason.trim() }));
      setDeclineOpen(false);
      setSession((current) => current ? { ...current, recipient: { ...current.recipient, status: 'declined' } } : current);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : 'The agreement could not be declined.');
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <PublicFrame><div className="mx-auto mt-20 h-64 max-w-lg animate-pulse border bg-muted" /></PublicFrame>;

  if (error || !session) return <PublicFrame><main className="mx-auto max-w-lg px-4 py-16">
    <div className="border bg-card p-6">
      <AlertCircle className="h-6 w-6 text-destructive" />
      <h1 className="mt-4 text-xl font-semibold">Signing link unavailable</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{error || 'This invitation is invalid, expired, declined or has been voided.'}</p>
    </div>
  </main></PublicFrame>;

  if (session.recipient.status === 'declined') return <PublicFrame><main className="mx-auto max-w-lg px-4 py-16">
    <div className="border bg-card p-6">
      <h1 className="text-xl font-semibold">Agreement declined</h1>
      <p className="mt-2 text-sm text-muted-foreground">Your response has been recorded and the sender has been notified.</p>
    </div>
  </main></PublicFrame>;

  if (!session.authenticated) return <PublicFrame><main className="mx-auto max-w-md px-4 py-16">
    <div className="border bg-card p-6">
      <LockKeyhole className="h-6 w-6 text-primary" />
      <h1 className="mt-4 text-xl font-semibold">Enter your access code</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{session.envelope.title} is protected. Ask the sender for the code they shared separately from this email.</p>
      <form className="mt-6 space-y-4" onSubmit={authenticate}>
        <div><Label className="field-label" htmlFor="signing-access-code">Access code</Label><Input id="signing-access-code" type="password" autoComplete="one-time-code" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} required autoFocus /></div>
        <Button className="w-full" disabled={working || !accessCode}>{working ? <Loader2 className="animate-spin" /> : <LockKeyhole />}{working ? 'Checking' : 'Continue'}</Button>
      </form>
    </div>
  </main></PublicFrame>;

  if (!session.consented && session.envelope.status !== 'completed') return <PublicFrame><main className="mx-auto max-w-2xl px-4 py-12">
    <div className="border bg-card p-6 sm:p-8">
      <ShieldCheck className="h-6 w-6 text-primary" />
      <h1 className="mt-4 text-xl font-semibold">Review and consent</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Before opening “{session.envelope.title}”, review the electronic-record disclosure below.</p>
      <div className="mt-6 border bg-muted/20 p-4 text-sm leading-6"><p>{session.disclosure.text}</p><p className="mt-3 text-xs text-muted-foreground">Disclosure version {session.disclosure.version}</p></div>
      <label className="mt-5 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 rounded border-input text-primary focus:ring-primary" checked={consentChecked} onChange={(event) => setConsentChecked(event.target.checked)} /><span><span className="font-medium">I agree to use electronic records and signatures for this agreement.</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Do not continue if you are not the named recipient.</span></span></label>
      <Button className="mt-6" disabled={!consentChecked || working} onClick={() => void consent()}>{working ? <Loader2 className="animate-spin" /> : <ChevronRight />}{working ? 'Opening' : 'Agree and review'}</Button>
    </div>
  </main></PublicFrame>;

  if (!detail) return <PublicFrame><div className="mx-auto mt-20 h-64 max-w-lg animate-pulse border bg-muted" /></PublicFrame>;

  if (completed) {
    const observer = ['cc', 'viewer'].includes(detail.recipient.role);
    const participants = detail.recipients || [];
    const completedParticipants = participants.filter((recipient) => recipient.status === 'completed').length;
    const matchingAccount = Boolean(
      accountSession?.authenticated && accountSession.emailVerified && accountSession.user
      && accountSession.user.email.toLowerCase() === detail.recipient.email.toLowerCase()
    );
    const documentState = detail.envelope.status === 'completed'
      ? { label: 'Completed', detail: 'The completed files and certificate are ready.', tone: 'text-emerald-700' }
      : detail.envelope.status === 'failed'
        ? { label: 'Final copy needs attention', detail: 'The sender has been notified and can retry final preparation.', tone: 'text-amber-700' }
        : detail.envelope.status === 'finalizing'
          ? { label: 'Preparing final copies', detail: 'Everyone has finished. The completed PDF and certificate are being prepared.', tone: 'text-blue-700' }
          : { label: 'Waiting for other recipients', detail: `Your part is complete. ${completedParticipants} of ${participants.length || 1} recipients have finished.`, tone: 'text-blue-700' };

    return <PublicFrame><main className="mx-auto max-w-3xl px-4 py-10 sm:py-12">
      <div className="border bg-card p-6 sm:p-8">
        <CheckCircle2 className="h-7 w-7 text-emerald-700" />
        <h1 className="mt-4 text-xl font-semibold">{observer ? 'Agreement complete' : 'Signing complete'}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{observer ? `“${detail.envelope.title}” has been completed and shared with you.` : `Your part of “${detail.envelope.title}” is complete.`}</p>

        <section className="mt-6 border-t pt-5" aria-labelledby="document-state-heading">
          <div className="flex items-start gap-3"><Clock3 className={`mt-0.5 h-5 w-5 shrink-0 ${documentState.tone}`} /><div><h2 id="document-state-heading" className="text-sm font-semibold">Current document state</h2><p className={`mt-1 text-sm font-medium ${documentState.tone}`}>{documentState.label}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{documentState.detail}</p></div></div>
        </section>

        {detail.artifacts.length > 0 ? <section className="mt-6 space-y-2 border-t pt-5" aria-labelledby="completed-files-heading">
          <h2 id="completed-files-heading" className="text-sm font-semibold">Completed files</h2>
          {detail.artifacts.map((artifact) => <Button variant="outline" className="w-full justify-start" asChild key={artifact.id}><a href={artifact.contentUrl || `/api/public/esign/artifacts/${artifact.id}/content`}><Download />{artifact.name}</a></Button>)}
        </section> : <div className="mt-6 border-t pt-5"><div className="text-sm font-semibold">Final copies are not ready yet</div><p className="mt-1 text-xs leading-5 text-muted-foreground">You will receive an email when the completed PDF and certificate are ready.</p></div>}

        {participants.length > 0 && <section className="mt-6 border-t pt-5" aria-labelledby="signing-activity-heading">
          <div className="flex items-end justify-between gap-4"><div><h2 id="signing-activity-heading" className="text-sm font-semibold">Signing activity</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">A compact view of routing order and recipient progress.</p></div><span className="text-xs tabular-nums text-muted-foreground">{completedParticipants}/{participants.length} complete</span></div>
          <ol className="mt-3 divide-y border">
            {participants.map((participant, index) => <li className="flex items-start justify-between gap-4 px-3 py-3" key={participant.id}>
              <div className="flex min-w-0 items-start gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center border bg-muted/25 text-xs font-semibold">{participant.routingOrder || index + 1}</span><div className="min-w-0"><div className="truncate text-sm font-medium">{participant.id === detail.recipient.id ? `${participant.name} (you)` : participant.name}</div><div className="mt-0.5 text-xs capitalize text-muted-foreground">{participant.role}</div></div></div>
              <div className="shrink-0 text-right"><div className={`text-xs font-medium ${participant.status === 'completed' ? 'text-emerald-700' : 'text-muted-foreground'}`}>{readableStatus(participant.status)}</div>{participant.completedAt && <div className="mt-0.5 text-[11px] text-muted-foreground">{formatMoment(participant.completedAt)}</div>}</div>
            </li>)}
          </ol>
        </section>}

        {detail.accountOption && <section className="mt-6 border-t pt-5" aria-labelledby="document-account-heading">
          <div className="flex items-start gap-3"><Library className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><h2 id="document-account-heading" className="text-sm font-semibold">Keep your signed documents together</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{matchingAccount ? `You are signed in as ${detail.recipient.email}. Open My documents to follow the current state and return to completed files.` : `Sign in or create an optional account with ${detail.recipient.email} to view this agreement and future completed documents.`}</p></div></div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {matchingAccount ? <Button asChild><Link to={detail.accountOption.documentsPath}>View My documents</Link></Button> : <><Button asChild><Link to={detail.accountOption.loginPath}>Sign in</Link></Button><Button variant="outline" asChild><Link to={detail.accountOption.signupPath}>Create optional account</Link></Button></>}
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">Your signature is complete. An account is not required to finish this agreement; signing up is entirely optional.</p>
        </section>}
      </div>
    </main></PublicFrame>;
  }

  const signatureCount = signatureLibrary?.signatures.length || 0;
  const atSignatureLimit = Boolean(signatureLibrary && signatureCount >= signatureLibrary.maxSignatures && !editingSignatureId);
  const fieldLabel = signatureField?.type === 'initials' ? 'initials' : 'signature';

  return <PublicFrame>
    <div className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur">
      <div className="min-w-0"><div className="truncate text-sm font-semibold">{detail.envelope.title}</div><div className="text-xs text-muted-foreground">Signing as {detail.recipient.name}</div></div>
      <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground" aria-live="polite">{pendingSaves ? 'Saving fields…' : `${missing.length} required remaining`}</span>{missing.length > 0 && <Button variant="outline" size="sm" onClick={nextRequired}>Next required <ChevronRight /></Button>}<Button size="sm" disabled={working || pendingSaves > 0 || missing.length > 0} onClick={() => void finish()}>{working ? <Loader2 className="animate-spin" /> : <FileSignature />}{working ? 'Finishing' : 'Finish'}</Button></div>
    </div>
    <main className="bg-muted/35 px-3 py-6 sm:px-6">
      <div className="mx-auto max-w-[900px] space-y-10">
        {detail.documents.map((document) => <SigningDocument key={document.id} document={document} fields={detail.fields.filter((field) => field.documentId === document.id)} onLocalChange={localField} onSave={(fieldId, value) => void saveField(fieldId, value)} onAdoptSignature={openSignature} />)}
        <div className="flex flex-col justify-between gap-3 border bg-card p-4 sm:flex-row sm:items-center"><div><div className="text-sm font-semibold">Finished reviewing?</div><p className="mt-1 text-xs text-muted-foreground">Complete every required field, then select Finish.</p></div><div className="flex gap-2"><Button variant="ghost" onClick={() => setDeclineOpen(true)}>Decline</Button><Button disabled={working || pendingSaves > 0 || missing.length > 0} onClick={() => void finish()}><FileSignature />Finish</Button></div></div>
      </div>
    </main>

    <Dialog open={Boolean(signatureField)} onOpenChange={(open) => { if (!open) setSignatureField(null); }}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{signatureField?.type === 'initials' ? 'Choose your initials' : 'Choose your signature'}</DialogTitle><DialogDescription>Apply a saved choice or create one by typing, drawing or uploading an image. You can change it until you finish signing.</DialogDescription></DialogHeader>

        <section className="border bg-muted/15 p-3" aria-labelledby="saved-signatures-heading">
          <div className="flex items-start justify-between gap-4"><div><h3 id="saved-signatures-heading" className="text-sm font-semibold">Saved signatures</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{signatureLibrary?.identity.accountLinked ? `Linked to your verified account for ${signatureLibrary.identity.maskedEmail}. These can be reused on future agreements.` : signatureLibrary ? `Protected for recipient ${signatureLibrary.identity.maskedEmail}. They are available only after that recipient passes the signing-link checks.` : 'Loading the signatures available to this recipient…'}</p></div>{signatureLibrary && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{signatureCount}/{signatureLibrary.maxSignatures}</span>}</div>
          {libraryError && <div className="mt-3 border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">{libraryError} You can still apply a signature to this agreement without saving it for reuse.</div>}
          {libraryLoading ? <div className="mt-4 flex items-center text-xs text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading saved signatures…</div>
            : signatureLibrary?.signatures.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{signatureLibrary.signatures.map((signature) => <article className="border bg-card p-3" key={signature.id}>
              <SavedSignaturePreview signature={signature} />
              <div className="mt-2 flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-sm font-medium">{signature.label}</div><div className="mt-0.5 text-[11px] capitalize text-muted-foreground">{signature.mode} · {signature.scope === 'account' ? 'Account' : 'Recipient'} scope</div></div></div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => void applySavedSignature(signature)} disabled={signatureWorking}>Use</Button>
                {signature.canManage && <>
                  <Button size="sm" variant="outline" onClick={() => editSavedSignature(signature)} disabled={signatureWorking}><Pencil />Change</Button>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${signature.label}`} onClick={() => void removeSavedSignature(signature)} disabled={signatureWorking}><Trash2 />Remove</Button>
                </>}
              </div>
            </article>)}</div>
              : !libraryError && <div className="mt-4 border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">No saved signatures yet. Create one below and choose Save and apply.</div>}
        </section>

        <section className="border-t pt-4" aria-labelledby="signature-editor-heading">
          <div className="flex items-start justify-between gap-4"><div><h3 id="signature-editor-heading" className="text-sm font-semibold">{editingSignatureId ? 'Change saved signature' : `Create ${fieldLabel}`}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{editingSignatureId ? 'The existing saved version remains unchanged until you save a replacement.' : 'Apply once for this field, or save it securely for future reuse.'}</p></div>{editingSignatureId && <Button size="sm" variant="ghost" onClick={() => resetSignatureDraft(signatureField)}>Cancel changes</Button>}</div>
          <div className="mt-4"><Label className="field-label" htmlFor="signature-label">Saved signature label</Label><Input id="signature-label" value={signatureLabel} maxLength={80} onChange={(event) => setSignatureLabel(event.target.value)} placeholder={signatureField?.type === 'initials' ? 'My initials' : 'My signature'} /><p className="mt-1 text-xs text-muted-foreground">Used only to identify this signature in your saved list.</p></div>
          <Tabs className="mt-4" value={signatureMode} onValueChange={(value) => setSignatureMode(value as ESignSignatureMode)}>
            <TabsList className="w-full"><TabsTrigger value="typed">Type</TabsTrigger><TabsTrigger value="drawn">Draw</TabsTrigger><TabsTrigger value="uploaded">Upload</TabsTrigger></TabsList>
            <TabsContent value="typed"><Label className="field-label" htmlFor="typed-signature">{signatureField?.type === 'initials' ? 'Initials' : 'Full name'}</Label><Input id="typed-signature" className="h-14 font-serif text-xl italic" value={typedSignature} maxLength={signatureField?.type === 'initials' ? 12 : 100} onChange={(event) => setTypedSignature(signatureField?.type === 'initials' ? event.target.value.toUpperCase() : event.target.value)} /><div className="mt-3 flex h-16 items-center justify-center border bg-white px-4 font-serif text-2xl italic text-slate-900" aria-label="Typed signature preview">{typedSignature || 'Signature preview'}</div></TabsContent>
            <TabsContent value="drawn"><SignatureCanvas onChange={setDrawnSignature} /></TabsContent>
            <TabsContent value="uploaded"><label className="flex min-h-36 cursor-pointer flex-col items-center justify-center border border-dashed bg-background px-4 text-center focus-within:ring-2 focus-within:ring-ring">{uploadedSignature ? <img src={uploadedSignature} className="h-24 max-w-full object-contain" alt="Uploaded signature preview" /> : <><FileSignature className="h-5 w-5 text-muted-foreground" /><span className="mt-2 text-sm font-medium">Choose a PNG or JPEG</span><span className="mt-1 text-xs text-muted-foreground">Maximum file size 2 MB</span></>}<input className="sr-only" type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (!['image/png', 'image/jpeg'].includes(file.type)) return toast.error('Choose a PNG or JPEG image.'); if (file.size > 2 * 1024 * 1024) return toast.error('Signature images must be smaller than 2 MB.'); const reader = new FileReader(); reader.onload = () => setUploadedSignature(String(reader.result || '')); reader.readAsDataURL(file); }} /></label>{uploadedSignature && <Button className="mt-2" size="sm" variant="ghost" onClick={() => setUploadedSignature('')}>Choose another image</Button>}</TabsContent>
          </Tabs>
        </section>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => setSignatureField(null)}>Cancel</Button>
          {!editingSignatureId && <Button variant="outline" disabled={signatureWorking || !signatureReady()} onClick={() => void applySignatureOnce()}>{signatureWorking ? <Loader2 className="animate-spin" /> : <PenLine />}Apply once</Button>}
          <Button disabled={signatureWorking || libraryLoading || Boolean(libraryError) || !signatureReady() || atSignatureLimit} onClick={() => void saveAndApplySignature()}>{signatureWorking ? <Loader2 className="animate-spin" /> : <Library />}{signatureWorking ? 'Saving' : editingSignatureId ? 'Save changes and apply' : 'Save and apply'}</Button>
        </DialogFooter>
        {atSignatureLimit && <p className="text-right text-xs text-destructive">Remove a saved signature before adding another. You can still Apply once.</p>}
      </DialogContent>
    </Dialog>

    <Dialog open={declineOpen} onOpenChange={setDeclineOpen}>
      <DialogContent><DialogHeader><DialogTitle>Decline agreement</DialogTitle><DialogDescription>The sender will be notified and this signing process will stop.</DialogDescription></DialogHeader><div><Label className="field-label" htmlFor="decline-reason">Reason <span className="text-destructive">*</span></Label><Textarea id="decline-reason" value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} rows={4} /></div><DialogFooter><Button variant="outline" onClick={() => setDeclineOpen(false)}>Cancel</Button><Button variant="destructive" disabled={working || declineReason.trim().length < 2} onClick={() => void decline()}>Decline agreement</Button></DialogFooter></DialogContent>
    </Dialog>
  </PublicFrame>;
}
