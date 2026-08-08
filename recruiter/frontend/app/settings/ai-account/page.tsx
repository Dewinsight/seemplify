"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Copy, ExternalLink, Loader2, RefreshCw, Unplug } from "lucide-react"
import { OpenAILogo } from "@/components/ui/openai-logo"
import { ChatGptPlanLimits } from "@/components/ui/chatgpt-plan-limits"
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
  // OpenAI throttles repeated device logins; the wait comes back with the
  // refusal so it can be counted down rather than retried blindly.
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [cooldownLeft, setCooldownLeft] = useState(0)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollDeadline = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!cooldownUntil) return
    const tick = () => {
      const left = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
      setCooldownLeft(left)
      if (left === 0) { setCooldownUntil(0); setError("") }
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [cooldownUntil])

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

  // Connecting is the acknowledgement: the data-sharing notice sits beside the
  // connection the whole time, so a connected account consents automatically.
  // Only an explicit withdrawal (unticking the box) is remembered and honoured.
  const autoConsentRef = useRef(false)
  const WITHDRAWN_KEY = "seemplify_ai_consent_withdrawn"
  useEffect(() => {
    if (autoConsentRef.current || !account) return
    if (account.status !== "connected" || account.dataSharingAcknowledgedAt) return
    if (localStorage.getItem(WITHDRAWN_KEY) === "true") return
    autoConsentRef.current = true
    void (async () => {
      try {
        const { account: next } = await aiAccountService.setConsent(true)
        setAccount(next)
      } catch {
        autoConsentRef.current = false
      }
    })()
  }, [account])

  // The runtime-gate dialog deep-links here with ?connect=1 so "Use ChatGPT"
  // flows straight into the device-code sign-in without a second click.
  const autoConnectRef = useRef(false)
  useEffect(() => {
    if (autoConnectRef.current || loading || !account) return
    const params = new URLSearchParams(window.location.search)
    if (params.get("connect") !== "1") return
    autoConnectRef.current = true
    if (account.status !== "connected") void connect()
  }, [loading, account])

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
    if (cooldownLeft > 0) return
    setWorking("connect"); setError("")
    try {
      const { login, account: next } = await aiAccountService.startLogin()
      setAccount(next)
      if (login.connected) { toast.success("Your ChatGPT account is already connected."); return }
      setDeviceLogin(login)
      setCopied(false)
      startPolling()
    } catch (reason: any) {
      const wait = Number(reason?.retryAfterSeconds) || 0
      if (wait > 0) setCooldownUntil(Date.now() + wait * 1000)
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

  async function resetLogin() {
    setWorking("reset")
    stopPolling()
    try {
      const { account: next } = await aiAccountService.resetLogin()
      setAccount(next)
      setDeviceLogin(null)
      setCooldownUntil(0)
      setCooldownLeft(0)
      setError("")
      toast.success("ChatGPT sign-in was reset. You can start again now.")
    } catch (reason: any) {
      const message = reason?.message || "The ChatGPT sign-in could not be reset."
      setError(message)
      toast.error(message)
    } finally { setWorking("") }
  }

  async function setConsent(acknowledged: boolean) {
    setWorking("consent")
    try {
      const { account: next } = await aiAccountService.setConsent(acknowledged)
      setAccount(next)
      if (acknowledged) localStorage.removeItem(WITHDRAWN_KEY)
      else localStorage.setItem(WITHDRAWN_KEY, "true")
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
  const cooling = cooldownLeft > 0
  const countdown = `${Math.floor(cooldownLeft / 60)}:${String(cooldownLeft % 60).padStart(2, "0")}`

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
          ChatGPT is the platform&apos;s only AI runtime. Connect your account and accept
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
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0d0d0d] text-white dark:bg-white dark:text-[#0d0d0d]">
                <OpenAILogo className="h-4 w-4" />
              </span>
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
                <Button
                  onClick={connect}
                  disabled={Boolean(working) || cooling}
                  className="bg-[#0d0d0d] text-white hover:bg-[#2f2f2f] disabled:opacity-60 dark:bg-white dark:text-[#0d0d0d] dark:hover:bg-white/90"
                  data-testid="ai-account-connect"
                >
                  {working === "connect"
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <OpenAILogo className="mr-2 h-4 w-4" />}
                  {cooling ? `Try again in ${countdown}` : "Sign in with OpenAI"}
                </Button>
              )}
              <Button variant="outline" onClick={() => void refresh()} disabled={Boolean(working)}>
                <RefreshCw className="mr-2 h-4 w-4" />Refresh
              </Button>
              {!connected && error && (
                <Button
                  variant="outline"
                  onClick={() => void resetLogin()}
                  disabled={Boolean(working)}
                  data-testid="ai-account-reset"
                >
                  {working === "reset"
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <RefreshCw className="mr-2 h-4 w-4" />}
                  Reset sign-in
                </Button>
              )}
              {connected && (
                <Button variant="outline" onClick={disconnect} disabled={Boolean(working)} data-testid="ai-account-disconnect">
                  {working === "disconnect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unplug className="mr-2 h-4 w-4" />}
                  Disconnect
                </Button>
              )}
            </div>
          )}

          {connected && (
            <ChatGptPlanLimits
              planType={account?.planType}
              rateLimits={account?.rateLimits}
              usageLimit={account?.usageLimit}
            />
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
                    using this connection. If you withdraw consent, ChatGPT-powered tasks pause until consent is restored.
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
        <DialogContent
          data-testid="ai-account-device-login"
          className="gap-0 overflow-hidden rounded-2xl border-black/10 p-0 sm:max-w-[440px] dark:border-white/10"
        >
          <DialogHeader className="items-center space-y-0 px-7 pb-6 pt-9 text-center">
            <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0d0d0d] text-white shadow-sm ring-1 ring-black/5 dark:bg-white dark:text-[#0d0d0d] dark:ring-white/10">
              <OpenAILogo className="h-8 w-8" />
            </span>
            <DialogTitle className="text-center text-[22px] font-semibold leading-tight tracking-[-0.01em]">
              Finish signing in with OpenAI
            </DialogTitle>
            <DialogDescription className="mx-auto mt-2 max-w-[19rem] text-center text-[14.5px] leading-relaxed">
              Open the secure page, enter this one-time code, then return here. This dialog updates on its own.
            </DialogDescription>
          </DialogHeader>
          <div className="px-7">
            <div className="rounded-xl border border-black/10 px-3.5 py-4 dark:border-white/10">
              <p className="text-center text-[12.5px] text-muted-foreground">
                Enter this code on the OpenAI page
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <Input
                  id="ai-account-code"
                  data-testid="ai-account-code"
                  readOnly
                  aria-label="One-time code"
                  value={deviceLogin?.userCode || ""}
                  className="h-12 rounded-lg border-black/10 bg-muted/30 text-center font-mono text-xl font-semibold tracking-[0.3em] dark:border-white/10"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-12 shrink-0 rounded-lg border-black/10 p-0 dark:border-white/10"
                  onClick={copyCode}
                  aria-label={copied ? "Code copied" : "Copy the ChatGPT sign-in code"}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />Waiting for you to finish on OpenAI…
              </p>
            </div>
          </div>
          <DialogFooter className="mt-6 flex-col gap-2 px-7 pb-7 sm:flex-col sm:space-x-0">
            {deviceLogin?.verificationUrl && (
              <Button
                asChild
                className="h-11 w-full rounded-xl bg-[#0d0d0d] text-[15px] font-medium text-white hover:bg-[#2f2f2f] dark:bg-white dark:text-[#0d0d0d] dark:hover:bg-white/90"
              >
                <a href={deviceLogin.verificationUrl} target="_blank" rel="noreferrer noopener">
                  <OpenAILogo className="mr-2 h-4 w-4" />Open OpenAI
                  <ExternalLink className="ml-2 h-3.5 w-3.5 opacity-70" />
                </a>
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={cancel}
              disabled={working === "cancel"}
              className="h-9 w-full text-xs font-normal text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
