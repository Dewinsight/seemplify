"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, Menu, RefreshCw, Save } from "lucide-react";
import AdminHeader from "@/components/AdminHeader";
import AdminSidebar from "@/components/AdminSidebar";
import { useAdmin } from "@/context/AdminContext";
import { apiRequest } from "@/services/apiConfig";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
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
  runtimePolicy: { localEnabled: boolean; chatgptEnabled: boolean; chatgptRequired: boolean; defaultRuntime: "local" | "chatgpt" };
  routes: RuntimeRoute[];
}

interface RuntimeModel {
  id: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort: string | null;
  supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
}

interface RuntimeModelCatalog {
  available: boolean;
  models: RuntimeModel[];
  message: string | null;
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

interface GatewayPair { local: GatewayStatus; chatgpt: GatewayStatus }

async function adminJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("adminToken");
  if (!token) throw new Error("Your admin session is unavailable. Please sign in again.");

  const response = await apiRequest(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
      "x-admin-auth-token": token
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.msg || payload.message || "Request failed");
  return payload as T;
}

export default function AiRuntimePage() {
  const { checkPermission } = useAdmin();
  const { toast } = useToast();
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [gateway, setGateway] = useState<GatewayPair | null>(null);
  const [modelCatalog, setModelCatalog] = useState<RuntimeModelCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const canManage = checkPermission("systemSettings");

  const loadModelCatalog = useCallback(async () => {
    setModelsLoading(true);
    try {
      setModelCatalog(await adminJson<RuntimeModelCatalog>("/api/admin/ai-runtime/models"));
    } catch (error) {
      setModelCatalog({
        available: false,
        models: [],
        message: error instanceof Error ? error.message : "The ChatGPT model catalogue is currently unavailable."
      });
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    void loadModelCatalog();
    try {
      const [nextSettings, nextGateway] = await Promise.all([
        adminJson<RuntimeSettings>("/api/admin/ai-runtime/settings"),
        adminJson<GatewayPair>("/api/admin/ai-runtime/gateway/status")
      ]);
      setSettings(nextSettings);
      setGateway(nextGateway);
    } catch (error) {
      toast({ title: "Could not load AI runtimes", description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setLoading(false);
    }
  }, [loadModelCatalog, toast]);

  useEffect(() => { void load(); }, [load]);

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

  async function saveRuntimePolicy(patch: Partial<RuntimeSettings["runtimePolicy"]>) {
    if (!settings) return;
    const nextPolicy = { ...settings.runtimePolicy, ...patch };
    if (!nextPolicy.localEnabled && !nextPolicy.chatgptEnabled) {
      toast({ title: "Keep one runtime enabled", description: "Seemplify needs at least one AI runtime." });
      return;
    }
    if (nextPolicy.defaultRuntime === "local" && !nextPolicy.localEnabled) nextPolicy.defaultRuntime = "chatgpt";
    if (nextPolicy.defaultRuntime === "chatgpt" && !nextPolicy.chatgptEnabled) nextPolicy.defaultRuntime = "local";
    setSaving("policy");
    try {
      const next = await adminJson<RuntimeSettings>("/api/admin/ai-runtime/runtime-policy", {
        method: "PUT", body: JSON.stringify(nextPolicy)
      });
      setSettings(next);
      toast({ title: "Runtime policy saved" });
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

  const localHealthy = gateway?.local?.reachable === true;
  const chatgptHealthy = gateway?.chatgpt?.reachable === true;

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 text-gray-100">
      <div className="hidden lg:flex">
        <AdminSidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AdminHeader>
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-gray-300 hover:bg-gray-700 hover:text-white lg:hidden"
                aria-label="Open admin navigation"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 border-gray-700 bg-gray-800 p-0 sm:max-w-64">
              <SheetHeader className="sr-only">
                <SheetTitle>Admin navigation</SheetTitle>
                <SheetDescription>Navigate the admin portal</SheetDescription>
              </SheetHeader>
              <AdminSidebar />
            </SheetContent>
          </Sheet>
        </AdminHeader>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-5 py-6 sm:px-7">
          <div className="mb-6 flex items-start justify-between gap-4 border-b border-gray-800 pb-5">
            <div>
              <h1 className="text-xl font-semibold text-white">AI runtimes</h1>
              <p className="mt-1 text-sm text-gray-400">Control platform availability, the workspace default, and per-user choice.</p>
            </div>
            <Button variant="outline" onClick={() => void load()} disabled={loading} className="border-gray-700 bg-transparent">
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
            </Button>
          </div>

          <section className="mb-6 overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
            <div className="grid md:grid-cols-2">
            <div className="border-b border-gray-800 p-5 md:border-b-0 md:border-r">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-medium text-white">Local inference</h2>
                  <p className="mt-1 text-sm text-gray-400">Uses the active Control Center engine and model.</p>
                </div>
                <div className={`flex items-center gap-2 text-sm font-medium ${localHealthy ? "text-emerald-400" : "text-red-400"}`}>
                  {localHealthy ? <Check className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
                  {loading ? "Checking" : localHealthy ? "Available" : "Unavailable"}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between"><span className="text-sm text-gray-300">Enabled for users</span><Switch checked={settings?.runtimePolicy.localEnabled === true} disabled={!canManage || saving === "policy" || !settings} onCheckedChange={(checked) => void saveRuntimePolicy({ localEnabled: checked })} /></div>
              {!localHealthy && gateway?.local?.error ? <p className="mt-3 text-sm text-red-300">{gateway.local.error}</p> : null}
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-medium text-white">ChatGPT Connect</h2>
                  <p className="mt-1 text-sm text-gray-400">Uses each person&apos;s connected ChatGPT account.</p>
                </div>
                <div className={`flex items-center gap-2 text-sm font-medium ${chatgptHealthy ? "text-emerald-400" : "text-red-400"}`}>{chatgptHealthy ? <Check className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}{loading ? "Checking" : chatgptHealthy ? "Available" : "Unavailable"}</div>
              </div>
              <div className="mt-4 flex items-center justify-between"><span className="text-sm text-gray-300">Enabled for users</span><Switch checked={settings?.runtimePolicy.chatgptEnabled === true} disabled={!canManage || saving === "policy" || !settings} onCheckedChange={(checked) => void saveRuntimePolicy({ chatgptEnabled: checked })} /></div>
              {!chatgptHealthy && gateway?.chatgpt?.error ? <p className="mt-3 text-sm text-red-300">{gateway.chatgpt.error}</p> : null}
            </div>
            </div>
            <div className="flex flex-col gap-3 border-t border-gray-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-sm font-medium text-white">Workspace default</p><p className="mt-0.5 text-sm text-gray-400">Used until a person makes their own choice. A single enabled runtime is automatic.</p></div>
              <Select value={settings?.runtimePolicy.defaultRuntime || "chatgpt"} disabled={!canManage || saving === "policy" || !settings} onValueChange={(value) => void saveRuntimePolicy({ defaultRuntime: value as "local" | "chatgpt" })}>
                <SelectTrigger className="w-52 border-gray-700 bg-gray-950"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="local" disabled={!settings?.runtimePolicy.localEnabled}>Local inference</SelectItem><SelectItem value="chatgpt" disabled={!settings?.runtimePolicy.chatgptEnabled}>ChatGPT Connect</SelectItem></SelectContent>
              </Select>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
            <div className="border-b border-gray-800 px-5 py-4">
              <h2 className="font-medium text-white">Activity routing</h2>
              <p className="mt-1 text-sm text-gray-400">Tune the connected-account model preference and reasoning level. Local inference follows Control Center.</p>
              {modelCatalog?.message ? <p className="mt-2 text-sm text-amber-300" role="status">{modelCatalog.message}</p> : null}
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
                        <Select
                          value={route.codexModel}
                          disabled={!canManage || modelsLoading}
                          onValueChange={(value) => updateRoute(route.activity, { codexModel: value })}
                        >
                          <SelectTrigger
                            className="h-9 min-w-56 border-gray-700 bg-gray-950"
                            aria-label={`Model for ${route.activity}`}
                          >
                            <SelectValue placeholder="Choose a model" />
                          </SelectTrigger>
                          <SelectContent>
                            {!modelCatalog?.models.some((model) => model.id === route.codexModel) && route.codexModel ? (
                              <SelectItem value={route.codexModel}>{route.codexModel} (saved; unavailable)</SelectItem>
                            ) : null}
                            {(modelCatalog?.models || []).map((model) => (
                              <SelectItem key={model.id} value={model.id}>
                                {model.displayName}{model.isDefault ? " (account default)" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
          </div>
        </main>
      </div>
    </div>
  );
}
