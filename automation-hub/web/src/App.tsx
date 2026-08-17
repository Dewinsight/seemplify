import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity, Blocks, Check, ChevronRight, CirclePause, Code2, Command, ExternalLink,
  FileClock, History, Link2, LoaderCircle, LogOut, Play, Plus, RefreshCw, Settings2, ShieldCheck, Workflow, X,
} from "lucide-react";
import { api, mutate, setCsrf } from "./api";

type View = "templates" | "workflows" | "runs" | "approvals" | "connections" | "developer" | "commands" | "audit";
type Session = { authenticated: boolean; actor: any; csrfToken: string; testAuthEnabled: boolean };

const nav: Array<{ id: View; label: string; icon: typeof Workflow }> = [
  { id: "templates", label: "Templates", icon: Blocks },
  { id: "workflows", label: "Workflows", icon: Workflow },
  { id: "runs", label: "Runs", icon: Activity },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "connections", label: "Connections", icon: Link2 },
  { id: "developer", label: "Webhooks", icon: Code2 },
  { id: "commands", label: "Commands", icon: Command },
  { id: "audit", label: "Audit", icon: History },
];

const title: Record<View, string> = {
  templates: "Templates", workflows: "Workflows", runs: "Runs", approvals: "Approvals",
  connections: "Connections", developer: "Webhooks", commands: "Commands", audit: "Audit log",
};

function formatDate(value?: string) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function Status({ value }: { value: string }) { return <span className={`status status-${value.replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>; }

function Empty({ children }: { children: string }) { return <div className="empty">{children}</div>; }

function Login({ testAuth }: { testAuth: boolean }) {
  const [busy, setBusy] = useState("");
  const signIn = async (selected: string) => {
    setBusy(selected);
    try { await mutate("/auth/test-login", "POST", { actor: selected }); location.reload(); }
    finally { setBusy(""); }
  };
  return <main className="login-page">
    <section className="login-panel">
      <div className="product-mark"><Workflow size={22} /><span>Seemplify Automations</span></div>
      <h1>Sign in</h1>
      <p>Use your Seemplify Identity to manage workflows, approvals, and connections.</p>
      {testAuth ? <div className="test-login">
        <button className="button primary" onClick={() => signIn("maker")} disabled={Boolean(busy)}>{busy === "maker" && <LoaderCircle className="spin" size={16} />} Continue as workflow owner</button>
        <button className="button" onClick={() => signIn("reviewer")} disabled={Boolean(busy)}>Continue as independent reviewer</button>
        <button className="button" onClick={() => signIn("member")} disabled={Boolean(busy)}>Continue as member</button>
      </div> : <a className="button primary" href="/auth/login">Continue with Seemplify Identity</a>}
    </section>
  </main>;
}

function TemplatesView({ onCreated }: { onCreated: () => void }) {
  const [items, setItems] = useState<any[]>([]); const [busy, setBusy] = useState(""); const [notice, setNotice] = useState("");
  useEffect(() => { void api<any[]>("/api/templates").then(setItems); }, []);
  const useTemplate = async (id: string) => {
    setBusy(id); setNotice("");
    try { const workflow = await mutate<any>(`/api/workflows/from-template/${id}`, "POST"); setNotice(`${workflow.name} was added as a draft.`); onCreated(); }
    catch (error) { setNotice((error as Error).message); } finally { setBusy(""); }
  };
  return <div className="content-stack">
    {notice && <div className="notice" role="status">{notice}</div>}
    <div className="list-table template-list">
      {items.map((item) => <div className="template-row" key={item.id}>
        <div><div className="row-title">{item.name}</div><div className="row-description">{item.description}</div><span className="category">{item.category}</span></div>
        <button className="button" onClick={() => useTemplate(item.id)} disabled={busy === item.id}>{busy === item.id ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Use template</button>
      </div>)}
    </div>
  </div>;
}

function WorkflowDetail({ item, catalog, connectors, onClose, onChanged }: any) {
  const [draft, setDraft] = useState<any>(() => structuredClone(item.draft));
  const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");
  const actionById = useMemo(() => Object.fromEntries((catalog?.actions || []).map((action: any) => [action.id, action])), [catalog]);
  const save = async () => { setBusy("save"); setMessage(""); try { await mutate(`/api/workflows/${item.id}`, "PUT", draft); setMessage("Draft saved."); onChanged(); } catch (error) { setMessage((error as Error).message); } finally { setBusy(""); } };
  const publish = async () => { setBusy("publish"); setMessage(""); try { await save(); await mutate(`/api/workflows/${item.id}/publish`, "POST"); setMessage("Published. New events now use this version."); onChanged(); } catch (error) { setMessage((error as Error).message); } finally { setBusy(""); } };
  return <div className="drawer-backdrop"><section className="drawer" aria-label="Workflow editor">
    <header className="drawer-header"><div><h2>{item.name}</h2><p>{item.status === "published" ? "Editing creates a new draft version; the published version stays active until you publish again." : "Review the sequence and validation before publishing."}</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
    <div className="drawer-body">
      {message && <div className="notice" role="status">{message}</div>}
      <label className="field"><span>Name</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="field"><span>Description</span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <div className="sequence">
        <div className="sequence-item"><div className="sequence-index">1</div><div><span className="sequence-type">Trigger</span><strong>{catalog?.events?.find((event: any) => event.id === draft.trigger.eventId)?.label || draft.trigger.eventId}</strong></div></div>
        {draft.steps.map((step: any, index: number) => {
          const action = step.type === "action" ? actionById[step.actionId] : null;
          const available = action?.provider ? connectors?.find((connector: any) => connector.provider === action.provider)?.connections?.filter((connection: any) => connection.status === "connected") || [] : [];
          return <div className="sequence-item" key={step.id}>
            <div className="sequence-index">{index + 2}</div>
            <div className="sequence-main"><span className="sequence-type">{step.type}</span><strong>{step.type === "approval" ? step.purpose : action?.label || step.actionId}</strong>
              {action && <span className={`risk risk-${action.risk}`}>{action.risk}</span>}
              {action?.external && <label className="inline-field"><span>Connection</span><select value={step.connectionId || ""} onChange={(event) => setDraft({ ...draft, steps: draft.steps.map((candidate: any) => candidate.id === step.id ? { ...candidate, connectionId: event.target.value } : candidate) })}><option value="">Select connection</option>{available.map((connection: any) => <option value={connection.id} key={connection.id}>{connection.display_name}</option>)}</select></label>}
            </div>
          </div>;
        })}
      </div>
      <label className="field short"><span>Maximum runs per hour</span><input type="number" min="1" max="10000" value={draft.maximumRunsPerHour} onChange={(event) => setDraft({ ...draft, maximumRunsPerHour: Number(event.target.value) })} /></label>
      {item.compile?.issues?.length > 0 && <div className="validation"><strong>Draft needs attention</strong>{item.compile.issues.map((issue: any, index: number) => <div key={`${issue.code}-${index}`}>{issue.message}</div>)}</div>}
    </div>
    <footer className="drawer-footer"><button className="button" onClick={save} disabled={Boolean(busy)}>{busy === "save" ? <LoaderCircle className="spin" size={16} /> : <Settings2 size={16} />} Save draft</button><button className="button primary" onClick={publish} disabled={Boolean(busy)}>{busy === "publish" ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />} Publish</button></footer>
  </section></div>;
}

function WorkflowsView({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<any[]>([]); const [selected, setSelected] = useState<any>(null); const [catalog, setCatalog] = useState<any>(); const [connectors, setConnectors] = useState<any[]>();
  const load = useCallback(async () => { const [workflows, nextCatalog, nextConnectors] = await Promise.all([api<any[]>("/api/workflows"), api("/api/catalog"), api<any[]>("/api/connectors")]); setItems(workflows); setCatalog(nextCatalog); setConnectors(nextConnectors); if (selected) setSelected(workflows.find((item) => item.id === selected.id) || null); }, [selected?.id]);
  useEffect(() => { void load(); }, [refreshKey]);
  const state = async (id: string, status: string) => { await mutate(`/api/workflows/${id}/state`, "POST", { status }); await load(); };
  return <>
    {items.length ? <div className="list-table"><div className="table-head"><span>Workflow</span><span>Risk</span><span>Status</span><span>Updated</span><span></span></div>{items.map((item) => <div className="table-row" key={item.id}>
      <button className="name-button" onClick={() => setSelected(item)}><strong>{item.name}</strong><span>{item.description}</span></button>
      <span>{item.compile?.risk || "R0"}</span><Status value={item.status} /><span>{formatDate(item.updatedAt)}</span>
      <div className="row-actions">{item.status === "published" && <button className="icon-button" aria-label={`Pause ${item.name}`} onClick={() => state(item.id, "paused")}><CirclePause size={17} /></button>}<button className="icon-button" aria-label={`Open ${item.name}`} onClick={() => setSelected(item)}><ChevronRight size={18} /></button></div>
    </div>)}</div> : <Empty>No workflows yet. Start from a reviewed template.</Empty>}
    {selected && <WorkflowDetail item={selected} catalog={catalog} connectors={connectors} onClose={() => setSelected(null)} onChanged={load} />}
  </>;
}

function TestEvents({ onSent }: { onSent: () => void }) {
  const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");
  const fixtures: Record<string, any> = {
    payroll: { name: "payroll.run_ready_for_review.v1", subjectType: "payroll_run", subjectId: "payroll-aug-2026", subjectRevision: "7", dataClass: "restricted", payload: { runId: "payroll-aug-2026", runRevision: "7", totalsHash: "sha256-e2e-payroll-total", period: "2026-08", currency: "NGN", total: 48125000, reviewerId: "user-reviewer" } },
    reaction: { name: "workspace.message_reaction_added.v1", subjectType: "workspace_message", subjectId: "message-100", subjectRevision: "2", dataClass: "internal", payload: { messageId: "message-100", channelId: "channel-project", permalink: "https://workspace.test/channels/project/message-100", excerpt: "Prepare launch checklist", reaction: "eyes", actorId: "user-maker" } },
    leave: { name: "leave.request_submitted.v1", subjectType: "leave_request", subjectId: "leave-100", subjectRevision: "3", dataClass: "restricted", payload: { requestId: "leave-100", requestRevision: "3", employeeId: "employee-100", approverId: "user-reviewer", leaveType: "annual", startsAt: "2026-08-24", endsAt: "2026-08-28", teamChannelId: "channel-people" } },
    page: { name: "pages.page_published.v1", subjectType: "page", subjectId: "page-100", subjectRevision: "5", dataClass: "internal", payload: { pageId: "page-100", revision: "5", title: "Launch brief", content: "Approved launch content", classification: "internal", folderId: "drive-folder" } },
  };
  const send = async (key: string) => { setBusy(key); setMessage(""); const at = new Date().toISOString(); try { const result = await mutate<any>("/api/events/test", "POST", { ...fixtures[key], id: crypto.randomUUID(), schemaVersion: 1, occurredAt: at, correlationId: crypto.randomUUID() }); setMessage(result.runIds.length ? `Event accepted. ${result.runIds.length} workflow run started.` : "Event accepted; no published workflow matched it."); onSent(); } catch (error) { setMessage((error as Error).message); } finally { setBusy(""); } };
  return <div className="test-events"><div><strong>Acceptance fixtures</strong><span>These send canonical events through the same inbox and engine as signed product events.</span></div><div className="button-row"><button className="button" onClick={() => send("reaction")} disabled={Boolean(busy)}>Message reaction</button><button className="button" onClick={() => send("leave")} disabled={Boolean(busy)}>Leave submitted</button><button className="button" onClick={() => send("payroll")} disabled={Boolean(busy)}>Payroll ready</button><button className="button" onClick={() => send("page")} disabled={Boolean(busy)}>Page published</button></div>{message && <div className="notice">{message}</div>}</div>;
}

function RunsView({ testAuth, refreshKey, onChanged }: { testAuth: boolean; refreshKey: number; onChanged: () => void }) {
  const [items, setItems] = useState<any[]>([]); const [selected, setSelected] = useState<any>(); const [message, setMessage] = useState("");
  const load = useCallback(async () => { const runs = await api<any[]>("/api/runs"); setItems(runs); if (selected) setSelected(await api(`/api/runs/${selected.id}`)); }, [selected?.id]);
  useEffect(() => { void load(); }, [refreshKey]);
  const open = async (id: string) => setSelected(await api(`/api/runs/${id}`));
  const retry = async () => { try { setSelected(await mutate(`/api/runs/${selected.id}/retry`, "POST")); setMessage("Retry completed."); await load(); } catch (error) { setMessage((error as Error).message); } };
  return <div className="content-stack">{testAuth && <TestEvents onSent={() => { void load(); onChanged(); }} />}{items.length ? <div className="list-table"><div className="table-head runs"><span>Workflow</span><span>Status</span><span>Event</span><span>Started</span><span></span></div>{items.map((item) => <div className="table-row runs" key={item.id}><button className="name-button" onClick={() => open(item.id)}><strong>{item.workflowName}</strong><span>{item.id}</span></button><Status value={item.status} /><span className="truncate">{item.eventId}</span><span>{formatDate(item.createdAt)}</span><button className="icon-button" onClick={() => open(item.id)}><ChevronRight size={18} /></button></div>)}</div> : <Empty>No workflow runs yet.</Empty>}
    {selected && <div className="drawer-backdrop"><section className="drawer"><header className="drawer-header"><div><h2>{selected.workflow_name}</h2><p>{selected.id}</p></div><button className="icon-button" aria-label="Close" onClick={() => setSelected(null)}><X size={19} /></button></header><div className="drawer-body">{message && <div className="notice">{message}</div>}<dl className="details"><div><dt>Status</dt><dd><Status value={selected.status} /></dd></div><div><dt>Event</dt><dd>{selected.event_id}</dd></div><div><dt>Started</dt><dd>{formatDate(selected.created_at)}</dd></div>{selected.error_message && <div><dt>Error</dt><dd>{selected.error_message}</dd></div>}</dl><h3>Attempts</h3>{selected.attempts?.length ? <div className="activity-list">{selected.attempts.map((attempt: any) => <div key={attempt.id}><Status value={attempt.status} /><strong>{attempt.step_id}</strong><span>Attempt {attempt.attempt_number}</span>{attempt.error_message && <p>{attempt.error_message}</p>}</div>)}</div> : <Empty>No action attempts yet.</Empty>}</div>{selected.status === "failed" && <footer className="drawer-footer"><button className="button primary" onClick={retry}><RefreshCw size={16} /> Retry safe failure</button></footer>}</section></div>}
  </div>;
}

function ApprovalsView({ session, onChanged }: { session: Session; onChanged: () => void }) {
  const [items, setItems] = useState<any[]>([]); const [selected, setSelected] = useState<any>(); const [rationale, setRationale] = useState(""); const [message, setMessage] = useState("");
  const load = useCallback(async () => setItems(await api<any[]>("/api/approvals")), []); useEffect(() => { void load(); }, []);
  const decide = async (decision: string) => { setMessage(""); try { await mutate(`/api/approvals/${selected.id}/decision`, "POST", { decision, rationale }); setSelected(null); setRationale(""); await load(); onChanged(); } catch (error) { setMessage((error as Error).message); } };
  return <>{items.length ? <div className="list-table"><div className="table-head approvals"><span>Request</span><span>Risk</span><span>Status</span><span>Requested</span><span></span></div>{items.map((item) => <div className="table-row approvals" key={item.id}><button className="name-button" onClick={() => setSelected(item)}><strong>{item.purpose}</strong><span>{item.workflow_name}</span></button><span className={`risk risk-${item.risk_class}`}>{item.risk_class}</span><Status value={item.status} /><span>{formatDate(item.requested_at)}</span><button className="icon-button" onClick={() => setSelected(item)}><ChevronRight size={18} /></button></div>)}</div> : <Empty>No approvals yet.</Empty>}
    {selected && <div className="drawer-backdrop"><section className="drawer narrow"><header className="drawer-header"><div><h2>Approval request</h2><p>{selected.workflow_name}</p></div><button className="icon-button" aria-label="Close" onClick={() => setSelected(null)}><X size={19} /></button></header><div className="drawer-body">{message && <div className="notice error">{message}</div>}<dl className="details"><div><dt>Purpose</dt><dd>{selected.purpose}</dd></div><div><dt>Protected action</dt><dd>{selected.action_id}</dd></div><div><dt>Subject revision</dt><dd>{selected.subject_revision}</dd></div><div><dt>Payload hash</dt><dd className="mono">{selected.payload_hash}</dd></div><div><dt>Requester</dt><dd>{selected.requester_id}{selected.requester_id === session.actor.id && " (you)"}</dd></div><div><dt>Expires</dt><dd>{formatDate(selected.expires_at)}</dd></div></dl>{selected.status === "pending" && <label className="field"><span>Decision rationale</span><textarea value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="Required when rejecting; recommended when approving" /></label>}</div>{selected.status === "pending" && <footer className="drawer-footer split"><button className="button danger" onClick={() => decide("rejected")}><X size={16} /> Reject</button><button className="button primary" onClick={() => decide("approved")}><Check size={16} /> Approve exact action</button></footer>}</section></div>}
  </>;
}

function ConnectionsView() {
  const [items, setItems] = useState<any[]>([]); const [message, setMessage] = useState(""); const [confirming, setConfirming] = useState<any>(); const [connectionId, setConnectionId] = useState("");
  const load = useCallback(async () => setItems(await api<any[]>("/api/connectors")), []); useEffect(() => { void load(); }, []);
  const toggle = async (provider: string, enabled: boolean) => { setMessage(""); try { await mutate(`/api/connectors/${provider}`, "PUT", { enabled, allowedDataClasses: ["public", "internal"] }); await load(); } catch (error) { setMessage((error as Error).message); } };
  const connect = async (provider: string) => { setMessage(""); try { const session = await mutate<any>(`/api/connectors/${provider}/session`, "POST", { ownerType: "organization" }); if (session.connectLink) location.href = session.connectLink; else setConfirming({ provider }); } catch (error) { setMessage((error as Error).message); } };
  const confirm = async (event: FormEvent) => { event.preventDefault(); try { await mutate(`/api/connectors/${confirming.provider}/confirm`, "POST", { nangoConnectionId: connectionId, ownerType: "organization", displayName: `${confirming.provider} workspace` }); setConfirming(null); setConnectionId(""); await load(); } catch (error) { setMessage((error as Error).message); } };
  const revoke = async (id: string) => { setMessage(""); try { await mutate(`/api/connections/${id}`, "DELETE"); setMessage("Connection credentials revoked in Nango."); await load(); } catch (error) { setMessage((error as Error).message); await load(); } };
  const params = new URLSearchParams(location.search); useEffect(() => { const provider = params.get("connected_provider"), id = params.get("connection_id"); if (provider && id) { setConfirming({ provider }); setConnectionId(id); history.replaceState(null, "", location.pathname); } }, []);
  return <div className="content-stack">{message && <div className="notice">{message}</div>}<div className="connection-list">{items.map((item) => <section className="connection-row" key={item.provider}><div><div className="row-title">{item.label}</div><div className="row-description">{item.description}</div>{item.connections.map((connection: any) => <div className="connected-account" key={connection.id}>{connection.status === "connected" && <Check size={15} />}<span>{connection.display_name}</span><Status value={connection.status} /><button className="button subtle compact" aria-label={`Revoke ${connection.display_name}`} onClick={() => revoke(connection.id)} disabled={connection.status === "revoked"}>Revoke</button></div>)}</div><div className="row-actions">{!item.reviewed ? <button className="button pending" disabled>Adapter pending</button> : item.enabled ? <><button className="button" onClick={() => connect(item.provider)}><Plus size={16} /> Connect account</button><button className="button subtle" onClick={() => toggle(item.provider, false)}>Disable</button></> : <button className="button primary" onClick={() => toggle(item.provider, true)}>Enable</button>}</div></section>)}</div>{confirming && <div className="modal-backdrop"><form className="modal" onSubmit={confirm}><h2>Confirm {confirming.provider} connection</h2><p>After Nango completes authorization, enter the returned connection ID.</p><label className="field"><span>Connection ID</span><input autoFocus value={connectionId} onChange={(event) => setConnectionId(event.target.value)} required /></label><div className="modal-actions"><button type="button" className="button" onClick={() => setConfirming(null)}>Cancel</button><button className="button primary" type="submit">Confirm connection</button></div></form></div>}</div>;
}

function DeveloperView() {
  const [incoming, setIncoming] = useState<any[]>([]); const [outgoing, setOutgoing] = useState<any[]>([]); const [deliveries, setDeliveries] = useState<any[]>([]); const [oneTime, setOneTime] = useState(""); const [message, setMessage] = useState("");
  const load = useCallback(async () => { const [a, b, c] = await Promise.all([api<any[]>("/api/incoming-webhooks"), api<any[]>("/api/event-subscriptions"), api<any[]>("/api/webhook-deliveries")]); setIncoming(a); setOutgoing(b); setDeliveries(c); }, []); useEffect(() => { void load(); }, []);
  const createIncoming = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const element = event.currentTarget; const form = new FormData(element); setMessage(""); try { const result = await mutate<any>("/api/incoming-webhooks", "POST", { name: form.get("name"), allowedEventType: form.get("eventType") }); setOneTime(`Incoming URL (shown once): ${result.url}`); element.reset(); await load(); } catch (error) { setMessage((error as Error).message); } };
  const createOutgoing = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const element = event.currentTarget; const form = new FormData(element); setMessage(""); try { const result = await mutate<any>("/api/event-subscriptions", "POST", { name: form.get("name"), eventPattern: form.get("eventPattern"), targetUrl: form.get("targetUrl") }); setOneTime(`Signing secret (shown once): ${result.signingSecret}`); element.reset(); await load(); } catch (error) { setMessage((error as Error).message); } };
  return <div className="content-stack">{message && <div className="notice error" role="alert">{message}</div>}{oneTime && <div className="secret-once"><ShieldCheck size={18} /><span>{oneTime}</span></div>}<div className="two-column"><form className="form-section" onSubmit={createIncoming}><h2>Incoming webhook</h2><p>External tools can trigger only the event type scoped to this URL.</p><label className="field"><span>Name</span><input name="name" required /></label><label className="field"><span>Allowed source event type</span><input name="eventType" defaultValue="ticket.created" required /></label><button className="button primary"><Plus size={16} /> Create incoming webhook</button></form><form className="form-section" onSubmit={createOutgoing}><h2>Event subscription</h2><p>Send eligible Seemplify events to a signed HTTPS endpoint.</p><label className="field"><span>Name</span><input name="name" required /></label><label className="field"><span>Event pattern</span><input name="eventPattern" defaultValue="pages.*" required /></label><label className="field"><span>Target URL</span><input name="targetUrl" type="url" required /></label><button className="button primary"><Plus size={16} /> Create subscription</button></form></div><section><h2>Configured endpoints</h2><div className="activity-list">{[...incoming.map((item) => ({ ...item, kind: "Incoming", name: item.name, state: item.revoked_at ? "revoked" : "active" })), ...outgoing.map((item) => ({ ...item, kind: "Outgoing", state: item.status }))].map((item) => <div key={`${item.kind}-${item.id}`}><strong>{item.name}</strong><span>{item.kind}</span><Status value={item.state} /></div>)}</div></section>{deliveries.length > 0 && <section><h2>Delivery history</h2><div className="activity-list">{deliveries.map((item) => <div key={item.id}><strong>{item.subscription_name}</strong><span>Attempt {item.attempt}</span><Status value={item.status} /></div>)}</div></section>}</div>;
}

function CommandsView() {
  const [items, setItems] = useState<any[]>([]); const [connections, setConnections] = useState<any[]>([]); const [message, setMessage] = useState("");
  useEffect(() => { void Promise.all([api<any[]>("/api/commands"), api<any[]>("/api/connectors")]).then(([commands, connectors]) => { setItems(commands); setConnections(connectors.flatMap((connector) => connector.connections.filter((connection: any) => connection.status === "connected").map((connection: any) => ({ ...connection, provider: connector.provider })))) }); }, []);
  const execute = async (command: string, provider?: string) => { try { const connectionId = provider ? connections.find((connection) => connection.provider === provider)?.id : undefined; const result = await mutate<any>("/api/commands/execute", "POST", { command, connectionId, context: { messageId: "message-command", boardId: "inbox", to: "automation-recipient@example.test", subject: "Seemplify automation test", text: "Follow up from Workspace", permalink: "https://workspace.test/message-command" } }); setMessage(result.outcomeId ? `Command completed. Outcome: ${result.outcomeId}` : `${result.label || "Open result"}: ${result.url}`); } catch (error) { setMessage((error as Error).message); } };
  return <div className="content-stack">{message && <div className="notice">{message}</div>}<div className="list-table">{items.map((item) => <div className="command-row" key={item.command}><code>{item.command}</code><div><div className="row-title">{item.label}</div><div className="row-description">{item.internal ? "Available by default; product permissions still apply." : `Available only while ${item.provider} is installed and connected.`}</div></div><button className="button" onClick={() => execute(item.command, item.provider)}>Run test</button></div>)}</div></div>;
}

function AuditView() {
  const [items, setItems] = useState<any[]>([]); useEffect(() => { void api<any[]>("/api/audit").then(setItems); }, []);
  return items.length ? <div className="list-table"><div className="table-head audit"><span>Action</span><span>Actor</span><span>Target</span><span>Time</span></div>{items.map((item) => <div className="table-row audit" key={item.id}><strong>{item.action}</strong><span>{item.actor_id}</span><span>{item.target_type}: {item.target_id}</span><span>{formatDate(item.created_at)}</span></div>)}</div> : <Empty>No audit events yet.</Empty>;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null); const [testAuth, setTestAuth] = useState(false); const [view, setView] = useState<View>(() => new URLSearchParams(location.search).has("connected_provider") ? "connections" : "templates"); const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { void api<Session>("/api/session").then((value) => { setCsrf(value.csrfToken); setSession(value); setTestAuth(value.testAuthEnabled); }).catch(async () => { const response = await fetch("/api/session"); const value = await response.json(); setTestAuth(Boolean(value.testAuthEnabled)); setSession(null); }); }, []);
  const logoutNow = async () => { await mutate("/auth/logout", "POST"); location.reload(); };
  if (session === null && !testAuth) return <Login testAuth={false} />;
  if (!session?.authenticated) return <Login testAuth={testAuth} />;
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><Workflow size={20} /><span>Automations</span></div><nav>{nav.map((item) => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><Icon size={17} />{item.label}</button>; })}</nav><div className="sidebar-user"><div><strong>{session.actor.name}</strong><span>{session.actor.organizationName} · {session.actor.role}</span></div><button className="icon-button" aria-label="Sign out" onClick={logoutNow}><LogOut size={17} /></button></div></aside>
    <main className="main"><header className="page-header"><div><h1>{title[view]}</h1><p>{view === "approvals" ? "Decisions are bound to one action payload and entity revision." : view === "connections" ? "External providers are disabled until an administrator enables and connects them." : ""}</p></div><button className="icon-button" aria-label="Refresh" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={18} /></button></header><div className="page-content">
      {view === "templates" && <TemplatesView onCreated={() => { setRefreshKey((value) => value + 1); setView("workflows"); }} />}
      {view === "workflows" && <WorkflowsView refreshKey={refreshKey} />}
      {view === "runs" && <RunsView testAuth={session.testAuthEnabled} refreshKey={refreshKey} onChanged={() => setRefreshKey((value) => value + 1)} />}
      {view === "approvals" && <ApprovalsView session={session} onChanged={() => setRefreshKey((value) => value + 1)} />}
      {view === "connections" && <ConnectionsView />}
      {view === "developer" && <DeveloperView />}
      {view === "commands" && <CommandsView />}
      {view === "audit" && <AuditView />}
    </div></main>
  </div>;
}
