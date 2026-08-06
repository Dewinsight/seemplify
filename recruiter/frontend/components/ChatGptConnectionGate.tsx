"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { Bot, Copy, ExternalLink, Loader2, LogOut, RefreshCw } from "lucide-react"
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
import { Label } from "@/components/ui/label"
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
// A "continue with local" decision holds for the browser session; the gate
// re-asks on the next sign-in rather than on every navigation.
const LOCAL_CHOICE_KEY = "seemplify_ai_runtime_gate_choice"
// Routes a signed-out person can be on. A stale token can briefly read as
// authenticated, so the path is checked too: the gate is for people using the
// workspace, never for someone looking at a sign-in screen.
const SIGNED_OUT_ROUTES = [
  "/login", "/signup", "/logout", "/oidc", "/auth",
  "/forgot-password", "/reset-password", "/verify", "/join", "/public", "/admin"
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
  const [localChoice, setLocalChoice] = useState(false)
  const pollInFlight = useRef(false)
  const consentInFlight = useRef(false)

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
    setLocalChoice(sessionStorage.getItem(LOCAL_CHOICE_KEY) === "local")
    void refresh()
    const onFocus = () => { void refresh() }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [refresh, isAuthenticated, signedOutRoute])

  const setup = chatGptSetupState(account, policy)
  const exempt = Boolean(pathname?.startsWith("/settings/ai-account")) || signedOutRoute
  const open = isAuthenticated && loaded && !exempt && setup !== null && !(setup === "choice" && localChoice)
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
    if (busy) return
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
      setError(reason?.message || "ChatGPT sign-in could not be started.")
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

  /** The gate blocks the whole workspace, so signing out has to stay
   * reachable — otherwise someone without a ChatGPT plan is stuck. */
  function signOut() {
    setAiRuntimeSetupGateOpen(false)
    logout()
  }

  function continueWithLocal() {
    sessionStorage.setItem(LOCAL_CHOICE_KEY, "local")
    setLocalChoice(true)
  }

  if (!open) return null

  const accountName = account?.connectedEmail || "your ChatGPT account"

  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent
        data-testid="chatgpt-connection-gate"
        className="max-w-[95vw] sm:max-w-md"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <div className="mb-1 flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0d0d0d] text-white shadow-sm dark:bg-white dark:text-[#0d0d0d]">
              <OpenAILogo className="h-6 w-6" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-left text-base leading-tight">
                {needsConsent ? "Use ChatGPT for this workspace" : "Connect ChatGPT to continue"}
              </DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Powered by your OpenAI account</p>
            </div>
          </div>
          <DialogDescription>
            {needsConsent
              ? `${accountName} is connected. Confirm to make it the AI runtime for your work.`
              : setup === "required"
                ? "This workspace runs AI on your own ChatGPT account, and the local model is turned off. Connect your account to use AI features."
                : "This workspace runs AI on your own ChatGPT account by default. Connect it, or continue on the local model."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p
            className="rounded-md border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground"
            data-testid="chatgpt-gate-disclosure"
          >
            Continuing allows candidate data, job descriptions, and interview content in the AI tasks
            you run to be processed by OpenAI using your connected account.
            {setup === "choice" ? " You can continue with the local AI runtime instead." : null}
          </p>

          {deviceLogin && (
            <div className="space-y-3 rounded-md border p-4" data-testid="chatgpt-gate-device-login">
              <div>
                <p className="text-sm font-medium">Finish signing in with OpenAI</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Open the secure page, enter the one-time code, then return here. This window updates automatically.
                </p>
              </div>
              <div>
                <Label htmlFor="chatgpt-gate-device-code">One-time code</Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    id="chatgpt-gate-device-code"
                    data-testid="chatgpt-gate-device-code"
                    readOnly
                    value={deviceLogin.userCode || ""}
                    className="h-11 text-center font-mono text-lg tracking-[0.35em]"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <Button type="button" variant="outline" onClick={() => void copyCode()}>
                    <Copy className="mr-1 h-4 w-4" />{copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />Waiting for OpenAI…
                </span>
                {deviceLogin.verificationUrl && (
                  <Button asChild size="sm">
                    <a href={deviceLogin.verificationUrl} target="_blank" rel="noreferrer noopener">
                      Open OpenAI<ExternalLink className="ml-1 h-4 w-4" />
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}

          {error && (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
              data-testid="chatgpt-gate-error"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {/* A blocking dialog must never trap someone: signing out is
                always available, and a stuck sign-in can be started over. */}
            <Button type="button" variant="ghost" size="sm" onClick={signOut} data-testid="chatgpt-gate-logout">
              <LogOut className="mr-1 h-4 w-4" />Sign out
            </Button>
            {(deviceLogin || account?.status === "pending") && (
              <Button type="button" variant="ghost" size="sm" disabled={busy}
                data-testid="chatgpt-gate-start-over" onClick={() => void connect(true)}>
                {working === "restart" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                Start over
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
          {setup === "choice" && (
            <Button
              type="button"
              variant="outline"
              data-testid="chatgpt-gate-use-local"
              onClick={continueWithLocal}
            >
              Continue with local AI
            </Button>
          )}
          {deviceLogin ? (
            <Button asChild disabled={busy} data-testid="chatgpt-gate-open-openai">
              <a href={deviceLogin.verificationUrl || "https://chatgpt.com"} target="_blank" rel="noreferrer noopener">
                Open OpenAI<ExternalLink className="ml-1 h-4 w-4" />
              </a>
            </Button>
          ) : needsConsent ? (
            <Button type="button" disabled={busy} data-testid="chatgpt-gate-enable" onClick={() => void acknowledgeConsent()}>
              {working === "consent" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Bot className="mr-1 h-4 w-4" />}
              Use ChatGPT
            </Button>
          ) : (
            <Button type="button" disabled={busy} data-testid="chatgpt-gate-connect" onClick={() => void connect()}>
              {working === "connect" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Bot className="mr-1 h-4 w-4" />}
              Connect ChatGPT
            </Button>
          )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ChatGptConnectionGate
