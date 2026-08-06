"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleDollarSign,
  Mail,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  UserPlus,
  Users
} from "lucide-react";
import { toast } from "sonner";
import aiInterviewService, { type AIInterview } from "@/services/aiInterviewService";
import { ADMIN_TOKEN_KEY, apiRequest, TOKEN_KEY } from "@/services/apiConfig";

const fieldClass = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";
const panelClass = "rounded-[1.35rem] border border-slate-200 bg-white shadow-sm";

function formatUsdFromCents(cents?: number) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

async function parseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Request failed with status ${response.status}`);
  return data;
}

export default function StandaloneAdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [wallet, setWallet] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [emailStatus, setEmailStatus] = useState<any>(null);
  const [interviews, setInterviews] = useState<AIInterview[]>([]);
  const [topUpAmount, setTopUpAmount] = useState("25.00");
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "recruiter" });

  const metrics = useMemo(() => ({
    users: users.length,
    interviews: interviews.length,
    completed: interviews.reduce((sum: number, interview: any) => sum + Number(interview.stats?.completed || 0), 0),
    wallet: wallet?.balanceCents || 0
  }), [interviews, users, wallet]);

  const logout = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY);
    }
    router.replace("/admin/login");
  };

  const load = async () => {
    setLoading(true);
    try {
      if (typeof window !== "undefined" && !localStorage.getItem(ADMIN_TOKEN_KEY)) {
        router.replace("/admin/login");
        return;
      }
      const me = await parseJson(await apiRequest("/api/admin/auth/me"));
      setAdmin(me.admin);
      const [settingsPayload, walletPayload, usersPayload, emailPayload, interviewPayload] = await Promise.all([
        apiRequest("/api/admin/settings").then(parseJson),
        apiRequest("/api/wallet").then(parseJson),
        apiRequest("/api/admin/users").then(parseJson),
        apiRequest("/api/admin/email-status").then(parseJson),
        aiInterviewService.list()
      ]);
      setSettings(settingsPayload.settings);
      setWallet(walletPayload.wallet);
      setLedger(walletPayload.ledger || []);
      setUsers(usersPayload.users || []);
      setEmailStatus(emailPayload);
      setInterviews(interviewPayload);
    } catch (error: any) {
      toast.error(error.message || "Could not load admin console");
      if (String(error.message || "").toLowerCase().includes("login") || String(error.message || "").toLowerCase().includes("permission")) {
        logout();
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveSettings = async () => {
    try {
      const payload = await parseJson(await apiRequest("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify(settings)
      }));
      setSettings(payload.settings);
      toast.success("Settings saved.");
      await load();
    } catch (error: any) {
      toast.error(error.message || "Could not save settings");
    }
  };

  const topUpWallet = async () => {
    const amountUsd = Number(topUpAmount);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      toast.error("Enter a valid top-up amount.");
      return;
    }
    try {
      const payload = await parseJson(await apiRequest("/api/wallet/top-up", {
        method: "POST",
        body: JSON.stringify({ amountUsd, note: "Standalone admin wallet load" })
      }));
      setWallet(payload.wallet);
      setLedger(payload.ledger || []);
      toast.success(`Wallet topped up by $${amountUsd.toFixed(2)}.`);
    } catch (error: any) {
      toast.error(error.message || "Could not top up wallet");
    }
  };

  const createUser = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await parseJson(await apiRequest("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(newUser)
      }));
      setNewUser({ name: "", email: "", password: "", role: "recruiter" });
      toast.success("User created.");
      await load();
    } catch (error: any) {
      toast.error(error.message || "Could not create user");
    }
  };

  const resetDemo = async () => {
    try {
      await parseJson(await apiRequest("/api/admin/seed-demo", { method: "POST" }));
      toast.success("Demo data reset in ai_recruiter.");
      await load();
    } catch (error: any) {
      toast.error(error.message || "Could not reset demo data");
    }
  };

  if (loading && !settings) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl border bg-white px-5 py-4 text-sm text-slate-600 shadow-sm">Loading standalone admin...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(15,23,42,0.10),transparent_34%),linear-gradient(135deg,#f8fafc_0%,#eef6ff_54%,#f6f7fb_100%)] text-slate-950">
      <header className="sticky top-0 z-30 border-b bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-semibold">AI Interview Admin</div>
              <div className="text-xs text-slate-500">Pricing, wallet, users, email, and operational settings</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {admin && <div className="hidden text-right text-xs text-slate-500 md:block"><div className="font-semibold text-slate-900">{admin.name}</div><div>{admin.email}</div></div>}
            <Link href="/app" className="inline-flex h-10 items-center rounded-xl border bg-white px-3 text-sm font-semibold shadow-sm">Recruiter app</Link>
            <button onClick={() => void load()} className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-3 text-sm font-semibold shadow-sm">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button onClick={logout} className="inline-flex h-10 items-center rounded-xl border bg-white px-3 text-sm font-semibold shadow-sm">Logout</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6">
        <section className="grid gap-4 md:grid-cols-4">
          {[
            { label: "Wallet balance", value: formatUsdFromCents(metrics.wallet), icon: CircleDollarSign, tone: "bg-emerald-50 text-emerald-700" },
            { label: "Interview price", value: formatUsdFromCents(settings?.interviewPriceCents), icon: Settings, tone: "bg-blue-50 text-blue-700" },
            { label: "Users", value: metrics.users, icon: Users, tone: "bg-violet-50 text-violet-700" },
            { label: "Completed sessions", value: metrics.completed, icon: CheckCircle2, tone: "bg-amber-50 text-amber-700" }
          ].map((metric) => (
            <div key={metric.label} className={`${panelClass} p-4`}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-slate-500">{metric.label}</div>
                <div className={`rounded-xl p-2 ${metric.tone}`}><metric.icon className="h-4 w-4" /></div>
              </div>
              <div className="mt-3 text-3xl font-bold">{metric.value}</div>
            </div>
          ))}
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_430px]">
          <div className="space-y-5">
            <div className={`${panelClass} p-5`}>
              <div className="flex items-center gap-2 text-xl font-semibold"><Settings className="h-5 w-5 text-blue-600" />Platform settings</div>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5 text-sm font-medium">Organization name
                  <input className={fieldClass} value={settings?.organizationName || ""} onChange={(event) => setSettings({ ...settings, organizationName: event.target.value })} />
                </label>
                <label className="space-y-1.5 text-sm font-medium">Price per candidate interview
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className={fieldClass}
                    value={Number(settings?.interviewPriceCents ?? 150) / 100}
                    onChange={(event) => setSettings({ ...settings, interviewPriceCents: Math.round(Number(event.target.value || 0) * 100) })}
                  />
                </label>
                <label className="space-y-1.5 text-sm font-medium">Max screen leave violations
                  <input type="number" className={fieldClass} value={settings?.maxFocusViolations || 3} onChange={(event) => setSettings({ ...settings, maxFocusViolations: Number(event.target.value) })} />
                </label>
                <label className="space-y-1.5 text-sm font-medium">Public recruiter signup
                  <select className={fieldClass} value={settings?.allowPublicSignup === false ? "false" : "true"} onChange={(event) => setSettings({ ...settings, allowPublicSignup: event.target.value === "true" })}>
                    <option value="true">Enabled</option>
                    <option value="false">Disabled</option>
                  </select>
                </label>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button onClick={saveSettings} className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white"><CheckCircle2 className="h-4 w-4" />Save settings</button>
                <button onClick={resetDemo} className="inline-flex h-11 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold"><RotateCcw className="h-4 w-4" />Reset demo data</button>
              </div>
            </div>

            <div className={`${panelClass} p-5`}>
              <div className="flex items-center gap-2 text-xl font-semibold"><UserPlus className="h-5 w-5 text-blue-600" />Users</div>
              <form onSubmit={createUser} className="mt-5 grid gap-3 md:grid-cols-[1fr_1fr_150px]">
                <input className={fieldClass} value={newUser.name} onChange={(event) => setNewUser({ ...newUser, name: event.target.value })} placeholder="Full name" />
                <input className={fieldClass} type="email" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} placeholder="email@example.com" />
                <select className={fieldClass} value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}>
                  <option value="recruiter">Recruiter</option>
                  <option value="admin">Admin</option>
                </select>
                <input className={fieldClass} type="password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} placeholder="Temporary password" />
                <button className="h-11 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white md:col-span-2">Create user</button>
              </form>
              <div className="mt-5 grid gap-2">
                {users.map((user) => (
                  <div key={user.id} className="flex items-center justify-between gap-3 rounded-2xl border bg-slate-50 p-3 text-sm">
                    <div>
                      <div className="font-semibold">{user.name}</div>
                      <div className="text-xs text-slate-500">{user.email}</div>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold capitalize">{user.role}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <aside className="space-y-5">
            <div className={`${panelClass} p-5`}>
              <div className="flex items-center gap-2 text-lg font-semibold"><Mail className="h-5 w-5 text-blue-600" />Email delivery</div>
              <div className="mt-4 grid gap-2 text-sm">
                <div className="rounded-2xl bg-slate-50 p-3"><span className="font-semibold">Mail service configured:</span> {emailStatus?.configured ? "Yes" : "No"}</div>
                <div className="rounded-2xl bg-slate-50 p-3"><span className="font-semibold">Mode:</span> {emailStatus?.mode || "unknown"}</div>
                <div className="rounded-2xl bg-slate-50 p-3"><span className="font-semibold">From:</span> {emailStatus?.fromName} &lt;{emailStatus?.fromEmail}&gt;</div>
              </div>
            </div>

            <div className={`${panelClass} p-5`}>
              <div className="flex items-center gap-2 text-lg font-semibold"><CircleDollarSign className="h-5 w-5 text-emerald-700" />Wallet</div>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className={fieldClass}
                  value={topUpAmount}
                  onChange={(event) => setTopUpAmount(event.target.value)}
                  placeholder="25.00"
                />
                <button onClick={topUpWallet} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white">
                  Top up
                </button>
              </div>
              <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
                {ledger.length ? ledger.map((entry) => (
                  <div key={entry._id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                    <div>
                      <div className="font-semibold capitalize">{String(entry.type || "").replace(/_/g, " ")}</div>
                      <div className="text-xs text-slate-500">{entry.description || "Wallet transaction"}</div>
                    </div>
                    <div className={entry.amountCents < 0 ? "font-bold text-rose-700" : "font-bold text-emerald-700"}>
                      {entry.amountCents < 0 ? "-" : "+"}{formatUsdFromCents(Math.abs(entry.amountCents))}
                    </div>
                  </div>
                )) : <div className="text-sm text-slate-500">No wallet transactions yet.</div>}
              </div>
            </div>
          </aside>
        </section>

        <section className={`${panelClass} mt-6 p-5`}>
          <div className="mb-4 flex items-center gap-2 text-xl font-semibold"><ShieldCheck className="h-5 w-5 text-blue-600" />Interview batches</div>
          <div className="grid gap-3 lg:grid-cols-2">
            {interviews.map((interview: any) => (
              <div key={interview._id} className="rounded-2xl border bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{interview.title}</div>
                    <div className="text-sm text-slate-500">{interview.job?.title || "No job"}</div>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold">{interview.status}</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded-xl bg-white p-2"><div className="font-bold">{interview.candidateCount}</div><div className="text-xs text-slate-500">Candidates</div></div>
                  <div className="rounded-xl bg-white p-2"><div className="font-bold">{interview.stats?.completed || 0}</div><div className="text-xs text-slate-500">Done</div></div>
                  <div className="rounded-xl bg-white p-2"><div className="font-bold">{formatUsdFromCents(interview.billing?.totalCents)}</div><div className="text-xs text-slate-500">Charged</div></div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
