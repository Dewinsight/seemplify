"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bot, Copy, ExternalLink, Loader2, RefreshCw, Unplug } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  aiAccountService, requiresChatGptSetup, type AiDeviceLogin, type AiRuntimeAccount, type AiRuntimePolicy
} from "@/services/aiAccountService"

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 120000

const statusTone: Record<AiRuntimeAccount["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  connected: { label: "Connected", variant: "default" },
  pending: { label: "Waiting for OpenAI", variant: "secondary" },
  disconnected: { label: "Not connected", variant: "outline" },
  error: { label: "Needs attention", variant: "destructive" }
}

export default function AiAccountPage() {
  const [account, setAccount] = useState<AiRuntimeAccount | null>(null)
  const [policy, setPolicy] = useState<AiRuntimePolicy | null>(null)
  const [deviceLogin, setDeviceLogin] = useState<AiDeviceLogin | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState("")
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollDeadline = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null }
    if (pollDeadline.current) { clearTimeout(pollDeadline.current); pollDeadline.current = null }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const { account: next, runtimePolicy } = await aiAccountService.read()
      setAccount(next)
      setPolicy(runtimePolicy || null)
      setError(next.lastError || "")
      return next
    } catch (reason: any) {
      setError(reason?.message || "Your ChatGPT connection could not be checked.")
      return null
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => stopPolling, [stopPolling])

  /** The device code is entered on OpenAI's site, so the only signal we get is
   * the account turning connected. Poll, then give up rather than spin. */
  const startPolling = useCallback(() => {
    stopPolling()
    pollTimer.current = setInterval(async () => {
      const next = await refresh()
      if (next?.status === "connected") {
        stopPolling()
        setDeviceLogin(null)
        toast.success(`Connected as ${next.connectedEmail || "your ChatGPT account"}.`)
      }
    }, POLL_INTERVAL_MS)
    pollDeadline.current = setTimeout(() => {
      stopPolling()
      setDeviceLogin(null)
      setError("The sign-in timed out. Start it again to get a new code.")
    }, POLL_TIMEOUT_MS)
  }, [refresh, stopPolling])

  async function connect() {
    setWorking("connect"); setError("")
    try {
      const { login, account: next } = await aiAccountService.startLogin()
      setAccount(next)
      if (login.connected) { toast.success("Your ChatGPT account is already connected."); return }
      setDeviceLogin(login)
      setCopied(false)
      startPolling()
    } catch (reason: any) {
      const message = reason?.message || "ChatGPT sign-in could not be started."
      setError(message); toast.error(message)
    } finally { setWorking("") }
  }

  async function cancel() {
    setWorking("cancel")
    stopPolling()
    try {
      const { account: next } = await aiAccountService.cancelLogin()
      setAccount(next)
      setDeviceLogin(null)
    } catch (reason: any) {
      setError(reason?.message || "The pending sign-in could not be cancelled.")
    } finally { setWorking("") }
  }

  async function setConsent(acknowledged: boolean) {
    setWorking("consent")
    try {
      const { account: next } = await aiAccountService.setConsent(acknowledged)
      setAccount(next)
      toast.success(acknowledged
        ? "ChatGPT may now run your AI tasks."
        : "Consent withdrawn. Your AI tasks will not use ChatGPT.")
    } catch (reason: any) {
      const message = reason?.message || "Your consent choice could not be saved."
      setError(message); toast.error(message)
    } finally { setWorking("") }
  }

  async function disconnect() {
    setWorking("disconnect")
    try {
      const { account: next } = await aiAccountService.disconnect()
      setAccount(next)
      toast.success("ChatGPT account disconnected.")
    } catch (reason: any) {
      const message = reason?.message || "The ChatGPT account could not be disconnected."
      setError(message); toast.error(message)
    } finally { setWorking("") }
  }

  async function copyCode() {
    if (!deviceLogin?.userCode) return
    try {
      await navigator.clipboard.writeText(deviceLogin.userCode)
      setCopied(true)
    } catch {
      setError("Clipboard access is unavailable. Select and copy the code manually.")
    }
  }

  const status = account ? statusTone[account.status] : statusTone.disconnected
  const connected = account?.status === "connected"
  const setupRequired = requiresChatGptSetup(account, policy)

  return (
    <div className="space-y-6" data-testid="ai-account-page">
      <div>
        <h3 className="text-lg font-medium">ChatGPT account</h3>
        <p className="text-sm text-muted-foreground">
          Connect your own ChatGPT plan so your AI work runs on it instead of shared platform capacity.
        </p>
      </div>
      <Separator />

      {setupRequired && (
        <div
          data-testid="ai-account-setup-required"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          role="alert"
        >
          ChatGPT is the platform&apos;s AI runtime and the local runtime is disabled. Connect your account and accept
          the data-sharing notice to use AI features.
        </div>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Connection</CardTitle>
            </div>
            <Badge variant={status.variant} data-testid="ai-account-status">{status.label}</Badge>
          </div>
          <CardDescription>
            {connected
              ? `${account?.connectedEmail || "Your account"}${account?.planType ? ` · ${account.planType}` : ""} is connected. Inference runs on this plan and counts against its limits.`
              : "Sign in with a one-time code from OpenAI. Your credentials are never stored by Seemplify."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />Checking your connection…
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {!connected && (
                <Button onClick={connect} disabled={Boolean(working)} data-testid="ai-account-connect">
                  {working === "connect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Connect ChatGPT
                </Button>
              )}
              <Button variant="outline" onClick={() => void refresh()} disabled={Boolean(working)}>
                <RefreshCw className="mr-2 h-4 w-4" />Refresh
              </Button>
              {connected && (
                <Button variant="outline" onClick={disconnect} disabled={Boolean(working)} data-testid="ai-account-disconnect">
                  {working === "disconnect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unplug className="mr-2 h-4 w-4" />}
                  Disconnect
                </Button>
              )}
            </div>
          )}

          {connected && (
            <div className="rounded-md border p-4">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="ai-account-consent"
                  data-testid="ai-account-consent"
                  checked={Boolean(account?.dataSharingAcknowledgedAt)}
                  disabled={working === "consent"}
                  onCheckedChange={(value) => void setConsent(value === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor="ai-account-consent" className="text-sm font-medium">
                    Allow AI task content to be processed by OpenAI on my account
                  </Label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Candidate data, job descriptions, and interview content in the tasks you run will be sent to OpenAI
                    using this connection. Withdraw consent at any time and your AI tasks return to the platform runtime.
                  </p>
                  {!account?.routable && (
                    <p className="text-xs font-medium text-amber-600">
                      Consent is required before anything is routed to your account.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(deviceLogin)} onOpenChange={(open) => { if (!open) void cancel() }}>
        <DialogContent data-testid="ai-account-device-login">
          <DialogHeader>
            <DialogTitle>Finish signing in with OpenAI</DialogTitle>
            <DialogDescription>
              Open the secure page, enter this one-time code, then return here. This dialog updates on its own.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="ai-account-code">One-time code</Label>
            <div className="flex gap-2">
              <Input
                id="ai-account-code"
                data-testid="ai-account-code"
                readOnly
                value={deviceLogin?.userCode || ""}
                className="font-mono tracking-widest"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button type="button" variant="outline" onClick={copyCode} aria-label="Copy the ChatGPT sign-in code">
                <Copy className="mr-2 h-4 w-4" />{copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />Waiting for OpenAI…
            </p>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={cancel} disabled={working === "cancel"}>Cancel</Button>
            {deviceLogin?.verificationUrl && (
              <Button asChild>
                <a href={deviceLogin.verificationUrl} target="_blank" rel="noreferrer noopener">
                  Open OpenAI<ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
