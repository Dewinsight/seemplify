import { FormEvent, useState } from 'react';
import { ArrowLeft, FilePlus2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { Link, useNavigate } from '@/lib/router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ESignEnvelopeDetail } from '@/types';

export function NewAgreementPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('Please review and sign this agreement');
  const [message, setMessage] = useState('Please review the attached document and complete the requested fields.');
  const [routingMode, setRoutingMode] = useState<'sequential' | 'parallel'>('sequential');
  const [working, setWorking] = useState(false);
  async function create(event: FormEvent) {
    event.preventDefault();
    if (title.trim().length < 2) return toast.error('Enter an agreement name.');
    try {
      setWorking(true);
      const detail = await api<ESignEnvelopeDetail>('/api/esign/envelopes', json('POST', {
        title: title.trim(), subject: subject.trim(), message: message.trim(), routingMode,
        expiresInDays: 30, reminderIntervalHours: 72
      }));
      toast.success('Agreement draft created'); navigate(`/agreements/${detail.envelope.id}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create the agreement.'); }
    finally { setWorking(false); }
  }
  return <div className="mx-auto max-w-2xl space-y-5">
    <Button variant="ghost" size="sm" asChild className="-ml-3"><Link to="/agreements"><ArrowLeft />All agreements</Link></Button>
    <div><h1 className="page-title">New agreement</h1><p className="page-description">Start the draft now. Documents, recipients and signing fields are added in the workspace.</p></div>
    <Card><CardHeader><CardTitle>Agreement details</CardTitle></CardHeader><CardContent><form className="space-y-4" onSubmit={create}>
      <div><Label className="field-label" htmlFor="agreement-title">Agreement name <span className="text-destructive" aria-hidden="true">*</span></Label><Input id="agreement-title" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} autoFocus /></div>
      <div><Label className="field-label" htmlFor="agreement-subject">Email subject</Label><Input id="agreement-subject" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={250} /></div>
      <div><Label className="field-label" htmlFor="agreement-message">Email message</Label><Textarea id="agreement-message" rows={6} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} /></div>
      <div><Label className="field-label" htmlFor="agreement-routing">Signing order</Label><select id="agreement-routing" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={routingMode} onChange={(event) => setRoutingMode(event.target.value as typeof routingMode)}><option value="sequential">In order</option><option value="parallel">Everyone at the same time</option></select><p className="mt-1 text-xs leading-5 text-muted-foreground">You can fine-tune each recipient's order before sending.</p></div>
      <div className="flex justify-end border-t pt-4"><Button disabled={working || title.trim().length < 2}>{working ? <Loader2 className="animate-spin" /> : <FilePlus2 />}{working ? 'Creating' : 'Create draft'}</Button></div>
    </form></CardContent></Card>
  </div>;
}
