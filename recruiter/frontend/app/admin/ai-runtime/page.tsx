"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, Menu, RefreshCw, Save } from "lucide-react";
import AdminHeader from "@/components/AdminHeader";
import AdminSidebar from "@/components/AdminSidebar";
import { useAdmin } from "@/context/AdminContext";
import { apiRequest } from "@/services/apiConfig";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";

interface RuntimeRoute {
  activity: string;
  enabled: boolean;
  codexModel: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
}

interface RuntimeSettings {
  providerEnabled: boolean;
  runtimePolicy: { chatgptEnabled: boolean; chatgptRequired: true; defaultRuntime: "chatgpt" };
  routes: RuntimeRoute[];
}

interface GatewayStatus {
  configured?: boolean;
  reachable?: boolean;
  ok?: boolean;
  service?: string;
  runtime?: string;
  persistence?: string;
  error?: string;
}

async function adminJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiRequest(path, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.msg || payload.message || "Request failed");
  return payload as T;
}

export default function AiRuntimePage() {
  const { checkPermission } = useAdmin();
  const { toast } = useToast();
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [gateway, setGateway] = useState<GatewayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const canManage = checkPermission("systemSettings");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSettings, nextGateway] = await Promise.all([
        adminJson<RuntimeSettings>("/api/admin/ai-runtime/settings"),
        adminJson<GatewayStatus>("/api/admin/ai-runtime/gateway/status")
      ]);
      setSettings(nextSettings);
      setGateway(nextGateway);
    } catch (error) {
      toast({ title: "Could not load ChatGPT runtime", description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function setAvailability(enabled: boolean) {
    if (!settings) return;
    setSaving("availability");
    try {
      const next = await adminJson<RuntimeSettings>("/api/admin/ai-runtime/provider", {
        method: "PUT", body: JSON.stringify({ providerEnabled: enabled })
      });
      setSettings(next);
      toast({ title: enabled ? "ChatGPT enabled" : "ChatGPT disabled" });
    } catch (error) {
      toast({ title: "Update failed", description: error instanceof Error ? error.message : "Try again." });
    } finally { setSaving(null); }
  }

  async function saveRoute(route: RuntimeRoute) {
    setSaving(route.activity);
    try {
      const next = await adminJson<RuntimeSettings>(`/api/admin/ai-runtime/routes/${encodeURIComponent(route.activity)}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: route.enabled, codexModel: route.codexModel, reasoningEffort: route.reasoningEffort })
      });
      setSettings(next);
      toast({ title: "Activity saved" });
    } catch (error) {
      toast({ title: "Update failed", description: error instanceof Error ? error.message : "Try again." });
    } finally { setSaving(null); }
  }

  function updateRoute(activity: string, patch: Partial<RuntimeRoute>) {
    setSettings((current) => current ? {
      ...current,
      routes: current.routes.map((route) => route.activity === activity ? { ...route, ...patch } : route)
    } : current);
  }

  const healthy = gateway?.ok === true && gateway?.reachable !== false;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <AdminSidebar />
      <div className="lg:pl-64">
        <AdminHeader />
        <main className="mx-auto max-w-7xl px-5 py-6 sm:px-7">
          <div className="mb-6 flex items-start justify-between gap-4 border-b border-gray-800 pb-5">
            <div className="flex items-start gap-3">
              <Sheet>
                <SheetTrigger asChild><Button variant="outline" size="icon" className="lg:hidden"><Menu className="h-4 w-4" /></Button></SheetTrigger>
                <SheetContent side="left" className="w-64 border-gray-800 bg-gray-950 p-0"><AdminSidebar /></SheetContent>
              </Sheet>
              <div>
                <h1 className="text-xl font-semibold text-white">ChatGPT runtime</h1>
                <p className="mt-1 text-sm text-gray-400">All Seemplify AI activity runs through each user&apos;s connected ChatGPT account.</p>
              </div>
            </div>
            <Button variant="outline" onClick={() => void load()} disabled={loading} className="border-gray-700 bg-transparent">
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
            </Button>
          </div>

          <section className="mb-6 grid gap-0 overflow-hidden rounded-lg border border-gray-800 bg-gray-900 md:grid-cols-[1fr_1fr]">
            <div className="border-b border-gray-800 p-5 md:border-b-0 md:border-r">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-medium text-white">Gateway</h2>
                  <p className="mt-1 text-sm text-gray-400">Azure VM · Codex app server · persistent server volume</p>
                </div>
                <div className={`flex items-center gap-2 text-sm font-medium ${healthy ? "text-emerald-400" : "text-red-400"}`}>
                  {healthy ? <Check className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
                  {loading ? "Checking" : healthy ? "Available" : "Unavailable"}
                </div>
              </div>
              {!healthy && gateway?.error ? <p className="mt-3 text-sm text-red-300">{gateway.error}</p> : null}
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-medium text-white">AI availability</h2>
                  <p className="mt-1 text-sm text-gray-400">Disabling this stops AI actions; there is no alternate provider.</p>
                </div>
                <Switch
                  aria-label="Enable ChatGPT runtime"
                  checked={settings?.providerEnabled !== false}
                  disabled={!canManage || saving === "availability" || !settings}
                  onCheckedChange={(checked) => void setAvailability(checked)}
                />
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
            <div className="border-b border-gray-800 px-5 py-4">
              <h2 className="font-medium text-white">Activity routing</h2>
              <p className="mt-1 text-sm text-gray-400">Choose the connected-account model preference and reasoning level for each activity.</p>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-gray-400">Activity</TableHead>
                    <TableHead className="text-gray-400">Model preference</TableHead>
                    <TableHead className="w-40 text-gray-400">Reasoning</TableHead>
                    <TableHead className="w-24 text-gray-400">Enabled</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(settings?.routes || []).map((route) => (
                    <TableRow key={route.activity} className="border-gray-800 hover:bg-gray-800/40">
                      <TableCell className="font-medium text-gray-200">{route.activity}</TableCell>
                      <TableCell>
                        <input
                          value={route.codexModel}
                          disabled={!canManage}
                          onChange={(event) => updateRoute(route.activity, { codexModel: event.target.value })}
                          className="h-9 w-full min-w-44 rounded-md border border-gray-700 bg-gray-950 px-3 text-sm outline-none focus:border-gray-500"
                        />
                      </TableCell>
                      <TableCell>
                        <Select value={route.reasoningEffort} disabled={!canManage} onValueChange={(value) => updateRoute(route.activity, { reasoningEffort: value as RuntimeRoute["reasoningEffort"] })}>
                          <SelectTrigger className="border-gray-700 bg-gray-950"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="xhigh">Extra high</SelectItem></SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Switch checked={route.enabled} disabled={!canManage} onCheckedChange={(checked) => updateRoute(route.activity, { enabled: checked })} /></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" disabled={!canManage || saving === route.activity} onClick={() => void saveRoute(route)} className="border-gray-700 bg-transparent">
                          <Save className="h-4 w-4" /><span className="sr-only">Save {route.activity}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
