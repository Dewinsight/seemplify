import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Mail, Plus, QrCode, Send } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { api, json } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Collector, Survey } from '@/types';

export function CollectTab({ survey, collectors, onRefresh }: { survey: Survey; collectors: Collector[]; onRefresh: () => void }) {
  const [name, setName] = useState('Web link');
  const [type, setType] = useState<Collector['type']>('web');
  const [selectedId, setSelectedId] = useState(collectors[0]?.id || '');
  const [emails, setEmails] = useState('');
  const [message, setMessage] = useState('We would value your feedback. It should only take a few minutes.');
  const [sending, setSending] = useState(false);
  useEffect(() => { if (!collectors.some((item) => item.id === selectedId)) setSelectedId(collectors[0]?.id || ''); }, [collectors, selectedId]);
  const selected = collectors.find((item) => item.id === selectedId) || collectors[0];

  async function createCollector() {
    try {
      const created = await api<Collector>(`/api/surveys/${survey.id}/collectors`, json('POST', { name, type }));
      setSelectedId(created.id); onRefresh(); toast.success('Collector created');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create collector'); }
  }
  async function copyUrl() {
    if (!selected) return;
    await navigator.clipboard.writeText(selected.publicUrl); toast.success('Survey link copied');
  }
  async function sendInvites() {
    if (!selected) return;
    const recipients = emails.split(/[\n,;]/).map((email) => email.trim()).filter(Boolean).map((email) => ({ email }));
    if (!recipients.length) return toast.error('Add at least one email address');
    try {
      setSending(true);
      const result = await api<{ outcomes: { email: string; status: string; error?: string }[]; email: { configured: boolean; mode: string } }>(`/api/collectors/${selected.id}/invitations`, json('POST', { recipients, message }));
      const failed = result.outcomes.filter((item) => item.status === 'failed');
      if (failed.length) toast.error(`${failed.length} invitation${failed.length === 1 ? '' : 's'} could not be delivered`);
      else toast.success(`${result.outcomes.length} invitation${result.outcomes.length === 1 ? '' : 's'} sent`);
      setEmails(''); onRefresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not send invitations'); }
    finally { setSending(false); }
  }

  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
    <div className="space-y-5">
      <Card><CardHeader><CardTitle>Distribution channels</CardTitle><CardDescription>Every response is attributed to its collector so channel performance stays measurable.</CardDescription></CardHeader>
        <CardContent className="px-0 pb-0">{collectors.length ? <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Collector</th><th>Channel</th><th>Responses</th><th>Recipients</th><th>Status</th><th /></tr></thead><tbody>{collectors.map((collector) => <tr key={collector.id} className={collector.id === selected?.id ? 'bg-muted/30' : ''}><td className="font-medium">{collector.name}</td><td className="capitalize">{collector.type}</td><td>{collector.responseCount || 0}</td><td>{collector.recipientCount || 0}</td><td><span className="inline-flex items-center gap-1.5 text-xs font-medium"><span className={`h-1.5 w-1.5 rounded-full ${collector.status === 'open' ? 'bg-emerald-500' : 'bg-slate-400'}`} />{collector.status}</span></td><td className="text-right"><Button size="sm" variant="ghost" onClick={() => setSelectedId(collector.id)}>Manage</Button></td></tr>)}</tbody></table></div> : <div className="border-t px-5 py-10 text-center text-sm text-muted-foreground">Create a collector to share this survey.</div>}</CardContent>
      </Card>
      {selected && <Card><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle>{selected.name}</CardTitle><CardDescription>Public collection link</CardDescription></div><Button variant="outline" size="sm" asChild><a href={selected.publicUrl} target="_blank" rel="noreferrer"><ExternalLink />Preview</a></Button></div></CardHeader><CardContent>
        <div className="flex flex-col gap-5 sm:flex-row"><div className="grid h-36 w-36 shrink-0 place-items-center border bg-white p-2"><QRCodeSVG value={selected.publicUrl} size={124} /></div><div className="min-w-0 flex-1 space-y-4"><div><Label htmlFor="collector-public-url" className="field-label">Survey URL</Label><div className="flex gap-2"><Input id="collector-public-url" readOnly value={selected.publicUrl} /><Button variant="outline" onClick={copyUrl}><Copy />Copy</Button></div></div><div className="grid gap-3 text-sm sm:grid-cols-3"><div><div className="text-muted-foreground">Responses</div><div className="mt-1 font-semibold">{selected.responseCount || 0}</div></div><div><div className="text-muted-foreground">Channel</div><div className="mt-1 font-semibold capitalize">{selected.type}</div></div><div><div className="text-muted-foreground">Access</div><div className="mt-1 font-semibold">Public link</div></div></div></div></div>
      </CardContent></Card>}
      {selected && (selected.type === 'email' || type === 'email') && <Card><CardHeader><CardTitle>Email invitations</CardTitle><CardDescription>Send personalised survey links through the shared Seemplify Brevo account.</CardDescription></CardHeader><CardContent className="space-y-4"><div><Label className="field-label">Recipients</Label><Textarea rows={4} value={emails} onChange={(event) => setEmails(event.target.value)} placeholder={'person@company.com\nanother@company.com'} /><p className="mt-1 text-xs text-muted-foreground">One address per line, or separate addresses with commas.</p></div><div><Label className="field-label">Invitation message</Label><Textarea rows={4} value={message} onChange={(event) => setMessage(event.target.value)} /></div><Button disabled={sending} onClick={sendInvites}><Send />{sending ? 'Sending…' : 'Send invitations'}</Button></CardContent></Card>}
    </div>
    <Card className="h-fit xl:sticky xl:top-24"><CardHeader><CardTitle>Add a collector</CardTitle><CardDescription>Use separate collectors to compare audiences and channels.</CardDescription></CardHeader><CardContent className="space-y-4"><div><Label className="field-label">Name</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div><div><Label className="field-label">Channel</Label><select value={type} onChange={(event) => setType(event.target.value as Collector['type'])} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="web">Web link</option><option value="email">Email</option><option value="qr">QR code</option><option value="kiosk">Kiosk</option><option value="api">API</option><option value="manual">Manual entry</option></select></div><Button onClick={createCollector}><Plus />Create collector</Button><div className="border-t pt-4"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Included</div><ul className="mt-3 space-y-2 text-sm text-muted-foreground">{['Collector-level reporting', 'QR-ready public URL', 'Anonymous response support', 'Automated Terra analysis'].map((item) => <li className="flex gap-2" key={item}><Check className="mt-0.5 h-4 w-4 text-primary" />{item}</li>)}</ul></div></CardContent></Card>
  </div>;
}
