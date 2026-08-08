"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { AlertCircle, Check, Copy, ExternalLink, Loader2, LogOut, RefreshCw, ShieldCheck } from "lucide-react"
import { OpenAILogo } from "@/components/ui/openai-logo"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  aiAccountService,
  chatGptSetupState,
  type AiDeviceLogin,
  type AiRuntimeAccount,
  type AiRuntimePolicy
} from "@/services/aiAccountService"
import { setAiRuntimeSetupGateOpen } from "@/utils/aiRuntimeGateHandler"
import { useAuth } from "@/context/AuthContext"

const POLL_INTERVAL_MS = 2000
// Routes a signed-out person can be on. A stale token can briefly read as
// authenticated, so the path is checked too: the gate is for people using the
// workspace, never for someone looking at a sign-in screen.
// "/" is the marketing landing page, not the workspace — matched exactly, so
// it never swallows the authenticated routes beneath it.
const SIGNED_OUT_ROUTES = [
  "/", "/login", "/signup", "/logout", "/oidc", "/auth",
  "/forgot-password", "/reset-password", "/verify", "/join", "/public", "/admin",
  "/privacy", "/terms", "/cookies", "/docs"
]

/**
 * Ported from Experience Management's ChatGptConnectionGate: when ChatGPT is
 * the workspace's AI runtime and this user's account cannot serve it yet, a
 * blocking dialog confronts them on entry — connect ChatGPT (the full
 * device-code sign-in happens inside the dialog), or, only while the local
 * runtime is still enabled, explicitly continue on local. When local is
 * disabled, connecting is the only way forward.
 */
export function ChatGptConnectionGate() {
  const pathname = usePathname()
  const { isAuthenticated, logout } = useAuth()
  const signedOutRoute = SIGNED_OUT_ROUTES.some(
    (route) => pathname === route || pathname?.startsWith(`${route}/`)
  )
  const [account, setAccount] = useState<AiRuntimeAccount | null>(null)
  const [policy, setPolicy] = useState<AiRuntimePolicy | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [deviceLogin, setDeviceLogin] = useState<AiDeviceLogin | null>(null)
  const [working, setWorking] = useState("")
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  // When the gateway throttles sign-in attempts it says how long the wait is;
  // the gate counts it down instead of leaving a button that only fails again.
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [cooldownLeft, setCooldownLeft] = useState(0)
  const pollInFlight = useRef(false)
  const consentInFlight = useRef(false)

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

  const refresh = useCallback(async () => {
    if (pollInFlight.current) return null
    pollInFlight.current = true
    try {
      const { account: next, runtimePolicy } = await aiAccountService.read()
      setAccount(next)
      setPolicy(runtimePolicy || null)
      return next
    } catch {
      return null
    } finally {
      pollInFlight.current = false
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    // Nothing is fetched for a signed-out visitor: the sign-in screen must not
    // fire an authenticated request, let alone show a blocking dialog.
    if (!isAuthenticated || signedOutRoute) return
    void refresh()
    const onFocus = () => { void refresh() }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [refresh, isAuthenticated, signedOutRoute])

  const setup = chatGptSetupState(account, policy)
  const exempt = Boolean(pathname?.startsWith("/settings/ai-account")) || signedOutRoute
  const open = isAuthenticated && loaded && !exempt && setup !== null
  const connected = account?.status === "connected"
  const needsConsent = connected && !account?.dataSharingAcknowledgedAt
  const busy = Boolean(working)

  useEffect(() => {
    setAiRuntimeSetupGateOpen(open)
    return () => setAiRuntimeSetupGateOpen(false)
  }, [open])

  /** Continuing through the gate is the acknowledgement: the data-sharing
   * disclosure is on screen the whole time, exactly as in EM. */
  const acknowledgeConsent = useCallback(async () => {
    if (consentInFlight.current) return
    consentInFlight.current = true
    setWorking("consent")
    setError("")
    try {
      const { account: next } = await aiAccountService.setConsent(true)
      setAccount(next)
      setDeviceLogin(null)
    } catch (reason: any) {
      setError(reason?.message || "ChatGPT connected, but data sharing could not be acknowledged.")
    } finally {
      consentInFlight.current = false
      setWorking("")
    }
  }, [])

  // While a device login is pending, poll until the account turns connected,
  // then complete the gate by acknowledging data sharing.
  useEffect(() => {
    if (!open || !deviceLogin) return
    const poll = async () => {
      const next = await refresh()
      if (next?.status === "connected") void acknowledgeConsent()
    }
    const timer = window.setInterval(() => { void poll() }, POLL_INTERVAL_MS)
    const onVisibility = () => { if (document.visibilityState === "visible") void poll() }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [open, deviceLogin, refresh, acknowledgeConsent])

  async function connect(restart = false) {
    if (busy || cooldownLeft > 0) return
    setWorking(restart ? "restart" : "connect")
    setError("")
    setCopied(false)
    try {
      if (restart) await aiAccountService.cancelLogin().catch(() => undefined)
      let result
      try {
        result = await aiAccountService.startLogin()
      } catch (reason: any) {
        // An older pending sign-in that cannot be resumed must not strand the
        // user: clear it and issue a fresh code rather than showing an error
        // with nothing to click.
        if (restart || reason?.code !== "CODEX_LOGIN_PENDING") throw reason
        await aiAccountService.cancelLogin().catch(() => undefined)
        result = await aiAccountService.startLogin()
      }
      const { login, account: next } = result
      setAccount(next)
      if (login.connected) {
        await acknowledgeConsent()
      } else {
        setDeviceLogin(login)
      }
    } catch (reason: any) {
      const wait = Number(reason?.retryAfterSeconds) || 0
      if (wait > 0) setCooldownUntil(Date.now() + wait * 1000)
      setError(
        reason?.message
        || (wait > 0 ? "Too many sign-in attempts. Please wait before trying again."
          : "ChatGPT sign-in could not be started.")
      )
    } finally {
      setWorking("")
    }
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

  async function resetLogin() {
    if (busy) return
    setWorking("reset")
    try {
      const { account: next } = await aiAccountService.resetLogin()
      setAccount(next)
      setDeviceLogin(null)
      setCooldownUntil(0)
      setCooldownLeft(0)
      setError("")
    } catch (reason: any) {
      setError(reason?.message || "The ChatGPT sign-in could not be reset.")
    } finally {
      setWorking("")
    }
  }

  /** The gate blocks the whole workspace, so signing out has to stay
   * reachable — otherwise someone without a ChatGPT plan is stuck. */
  function signOut() {
    setAiRuntimeSetupGateOpen(false)
    logout()
  }

  if (!open) return null

  const accountName = account?.connectedEmail || "your ChatGPT account"
  const cooling = cooldownLeft > 0
  const countdown = `${Math.floor(cooldownLeft / 60)}:${String(cooldownLeft % 60).padStart(2, "0")}`

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        data-testid="chatgpt-connection-gate"
        className="max-w-[95vw] gap-0 overflow-hidden rounded-2xl border-black/10 p-0 shadow-2xl sm:max-w-[440px] dark:border-white/10"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        {/* OpenAI's own sign-in surfaces are centred, monochrome and quiet —
            this reads as a continuation of that, not a product dialog. */}
        <DialogHeader className="items-center space-y-0 px-7 pb-6 pt-9 text-center">
          <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0d0d0d] text-white shadow-sm ring-1 ring-black/5 dark:bg-white dark:text-[#0d0d0d] dark:ring-white/10">
            <OpenAILogo className="h-8 w-8" />
          </span>
          <DialogTitle className="text-center text-[22px] font-semibold leading-tight tracking-[-0.01em]">
            {needsConsent ? "Use ChatGPT for this workspace" : "Connect ChatGPT to continue"}
          </DialogTitle>
          <DialogDescription className="mx-auto mt-2 max-w-[19rem] text-center text-[14.5px] leading-relaxed">
            {needsConsent
              ? "Confirm this account as the AI runtime for your work."
              : "This workspace runs AI on your own ChatGPT account. Sign in with OpenAI to use AI features."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-7">
          {connected && (
            <div
              className="flex items-center gap-3 rounded-xl border border-black/10 bg-muted/30 px-3.5 py-3 dark:border-white/10"
              data-testid="chatgpt-gate-account"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0d0d0d] text-sm font-medium text-white dark:bg-white dark:text-[#0d0d0d]">
                {accountName.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{accountName}</span>
                <span className="block text-xs text-muted-foreground">
                  {account?.planType ? `ChatGPT ${account.planType}` : "Signed in with OpenAI"}
                </span>
              </span>
              <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            </div>
          )}

          <p
            className="flex gap-2.5 rounded-xl border border-black/10 px-3.5 py-3 text-[12.5px] leading-relaxed text-muted-foreground dark:border-white/10"
            data-testid="chatgpt-gate-disclosure"
          >
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Candidate data, job descriptions, and interview content in the AI tasks you run are
              processed by OpenAI on your connected account.
            </span>
          </p>

          {deviceLogin && (
            <div
              className="rounded-xl border border-black/10 px-3.5 py-4 dark:border-white/10"
              data-testid="chatgpt-gate-device-login"
            >
              <p className="text-center text-[12.5px] text-muted-foreground">
                Enter this code on the OpenAI page
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <Input
                  id="chatgpt-gate-device-code"
                  data-testid="chatgpt-gate-device-code"
                  readOnly
                  aria-label="One-time code"
                  value={deviceLogin.userCode || ""}
                  className="h-12 rounded-lg border-black/10 bg-muted/30 text-center font-mono text-xl font-semibold tracking-[0.3em] dark:border-white/10"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-12 shrink-0 rounded-lg border-black/10 p-0 dark:border-white/10"
                  aria-label={copied ? "Code copied" : "Copy code"}
                  onClick={() => void copyCode()}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />Waiting for you to finish on OpenAI…
              </p>
            </div>
          )}

          {error && (
            <div
              className="flex gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-[13px] leading-relaxed text-destructive"
              role="alert"
              data-testid="chatgpt-gate-error"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {error}
                {cooling && (
                  <span className="mt-1 block font-medium tabular-nums" data-testid="chatgpt-gate-cooldown">
                    You can try again in {countdown}.
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="mt-6 flex-col gap-2 px-7 pb-4 sm:flex-col sm:space-x-0">
          {deviceLogin ? (
            <Button
              asChild
              className="h-11 w-full rounded-xl bg-[#0d0d0d] text-[15px] font-medium text-white hover:bg-[#2f2f2f] dark:bg-white dark:text-[#0d0d0d] dark:hover:bg-white/90"
              data-testid="chatgpt-gate-open-openai"
            >
              <a href={deviceLogin.verificationUrl || "https://chatgpt.com"} target="_blank" rel="noreferrer noopener">
                <OpenAILogo className="mr-2 h-4 w-4" />Open OpenAI
                <ExternalLink className="ml-2 h-3.5 w-3.5 opacity-70" />
              </a>
            </Button>
          ) : needsConsent ? (
            <Button
              type="button"
              disabled={busy}
              className="h-11 w-full rounded-xl bg-[#0d0d0d] text-[15px] font-medium text-white hover:bg-[#2f2f2f] dark:bg-white dark:text-[#0d0d0d] dark:hover:bg-white/90"
              data-testid="chatgpt-gate-enable"
              onClick={() => void acknowledgeConsent()}
            >
              {working === "consent"
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <OpenAILogo className="mr-2 h-4 w-4" />}
              Continue with ChatGPT
            </Button>
          ) : (
            <Button
              type="button"
              disabled={busy || cooling}
              className="h-11 w-full rounded-xl bg-[#0d0d0d] text-[15px] font-medium text-white hover:bg-[#2f2f2f] disabled:opacity-60 dark:bg-white dark:text-[#0d0d0d] dark:hover:bg-white/90"
              data-testid="chatgpt-gate-connect"
              onClick={() => void connect()}
            >
              {working === "connect"
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <OpenAILogo className="mr-2 h-4 w-4" />}
              {cooling ? `Try again in ${countdown}` : "Sign in with OpenAI"}
            </Button>
          )}

          {/* A blocking dialog must never trap someone: signing out is always
              reachable, and a stuck sign-in can be started over. */}
          <div className="flex w-full items-center justify-center gap-1 border-t border-black/5 pt-3 text-xs dark:border-white/5">
            <Button
              type="button" variant="ghost" size="sm"
              className="h-8 px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
              onClick={signOut} data-testid="chatgpt-gate-logout"
            >
              <LogOut className="mr-1.5 h-3.5 w-3.5" />Sign out
            </Button>
            {(error || deviceLogin || account?.status === "pending") && (
              <>
                <span aria-hidden className="text-muted-foreground/40">·</span>
                <Button
                  type="button" variant="ghost" size="sm" disabled={busy}
                  className="h-8 px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
                  data-testid="chatgpt-gate-reset" onClick={() => void resetLogin()}
                >
                  {working === "reset"
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                  Reset sign-in
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ChatGptConnectionGate
