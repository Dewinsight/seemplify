"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, Check, Copy, ExternalLink, Loader2, RefreshCw, ShieldCheck } from "lucide-react"
import { OpenAILogo } from "@/components/ui/openai-logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import aiInterviewService, {
  type CandidateChatgptAccount,
  type CandidateChatgptLogin
} from "@/services/aiInterviewService"

const POLL_INTERVAL_MS = 2000

/**
 * A live AI interview runs on the candidate's own ChatGPT account, so this
 * stands between the invitation and the interview: connect, acknowledge that
 * answers are processed by OpenAI on that account, then begin. Nothing else
 * can run the conversation, so there is no way past this but to connect.
 *
 * Voice (speech-to-text and text-to-speech) is unaffected — it stays on the
 * platform's Azure speech services.
 */
export function CandidateChatgptGate({
  token,
  onReady
}: {
  token: string
  onReady: (account: CandidateChatgptAccount) => void
}) {
  const [account, setAccount] = useState<CandidateChatgptAccount | null>(null)
  const [login, setLogin] = useState<CandidateChatgptLogin | null>(null)
  const [working, setWorking] = useState("")
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  // A throttled sign-in is counted down rather than left as a button that
  // only fails again — a candidate has nobody to ask.
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [cooldownLeft, setCooldownLeft] = useState(0)
  const readyNotified = useRef(false)
  const pollInFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (pollInFlight.current) return null
    pollInFlight.current = true
    try {
      const { account: next } = await aiInterviewService.getPublicChatgptAccount(token)
      setAccount(next)
      return next
    } catch (reason: any) {
      setError(reason?.message || "Your ChatGPT connection could not be checked.")
      return null
    } finally {
      pollInFlight.current = false
    }
  }, [token])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (account?.routable && !readyNotified.current) {
      readyNotified.current = true
      onReady(account)
    }
  }, [account, onReady])

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

  // While a device login is pending the only signal is the account turning
  // connected, so poll until it does.
  useEffect(() => {
    if (!login || login.connected) return
    const timer = window.setInterval(() => {
      void refresh().then((next) => { if (next?.status === "connected") setLogin(null) })
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [login, refresh])

  async function connect(restart = false) {
    if (working || cooldownLeft > 0) return
    setWorking(restart ? "restart" : "connect")
    setError("")
    setCopied(false)
    try {
      if (restart) await aiInterviewService.cancelPublicChatgptLogin(token).catch(() => undefined)
      let result
      try {
        result = await aiInterviewService.startPublicChatgptLogin(token)
      } catch (reason: any) {
        // A pending sign-in that cannot be resumed must not strand the
        // candidate: clear it and issue a fresh code.
        if (restart || reason?.code !== "CODEX_LOGIN_PENDING") throw reason
        await aiInterviewService.cancelPublicChatgptLogin(token).catch(() => undefined)
        result = await aiInterviewService.startPublicChatgptLogin(token)
      }
      const { login: next, account: current } = result
      setAccount(current)
      if (next.connected) await refresh()
      else setLogin(next)
    } catch (reason: any) {
      const wait = Number(reason?.retryAfterSeconds) || 0
      if (wait > 0) setCooldownUntil(Date.now() + wait * 1000)
      setError(reason?.message || "ChatGPT sign-in could not be started.")
    } finally {
      setWorking("")
    }
  }

  async function acknowledge(acknowledged: boolean) {
    setWorking("consent")
    setError("")
    try {
      const { account: next } = await aiInterviewService.setPublicChatgptConsent(token, acknowledged)
      setAccount(next)
    } catch (reason: any) {
      setError(reason?.message || "Your choice could not be saved.")
    } finally {
      setWorking("")
    }
  }

  async function disconnect() {
    if (busy) return
    setWorking("disconnect")
    setError("")
    try {
      const { account: next } = await aiInterviewService.disconnectPublicChatgpt(token)
      setAccount(next)
      setLogin(null)
      readyNotified.current = false
    } catch (reason: any) {
      setError(reason?.message || "Your ChatGPT connection could not be removed.")
    } finally {
      setWorking("")
    }
  }

  async function copyCode() {
    if (!login?.userCode) return
    try {
      await navigator.clipboard.writeText(login.userCode)
      setCopied(true)
    } catch {
      setError("Clipboard access is unavailable. Select and copy the code manually.")
    }
  }

  const connected = account?.status === "connected"
  const busy = Boolean(working)
  const cooling = cooldownLeft > 0
  const countdown = `${Math.floor(cooldownLeft / 60)}:${String(cooldownLeft % 60).padStart(2, "0")}`
  const accountName = account?.connectedEmail || "your ChatGPT account"

  return (
    <div
      className="mx-auto w-full max-w-[500px] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-950 shadow-2xl shadow-slate-950/20"
      data-testid="candidate-chatgpt-gate"
    >
      <div className="flex flex-col items-center px-5 pb-5 pt-7 text-center sm:px-7 sm:pt-8">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-950 text-white shadow-sm ring-1 ring-black/5">
          <OpenAILogo className="h-7 w-7" />
        </span>
        <h2 className="text-xl font-semibold leading-tight tracking-[-0.01em] sm:text-[22px]">
          Connect ChatGPT to begin
        </h2>
        <p className="mx-auto mt-2 max-w-[24rem] text-sm leading-6 text-slate-600">
          This interview is conducted by AI running on <strong className="font-semibold text-slate-950">your
          own ChatGPT account</strong>, so your answers are processed on your plan rather than ours.
        </p>
      </div>

      <div className="space-y-3 px-5 sm:px-7">
        <p className="flex gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-slate-600">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <span>
            The questions you are asked and the answers you give are processed by OpenAI on your
            account. Voice audio is handled separately by the platform and is not sent to your account.
            The connection gateway removes your saved ChatGPT credential after scoring finishes or the interview ends.
          </span>
        </p>

        {connected && (
          <div
            className="rounded-lg border border-slate-200 px-3.5 py-3"
            data-testid="candidate-chatgpt-connected"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-medium text-white">
                {accountName.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{accountName}</span>
                <span className="block text-xs text-slate-500">
                  {account?.planType ? `ChatGPT ${account.planType}` : "Signed in with OpenAI"}
                </span>
              </span>
              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
            </div>
            <label className="mt-3 flex items-start gap-2.5 border-t border-slate-100 pt-3 text-[12.5px] leading-relaxed text-slate-700">
              <Checkbox
                className="mt-0.5"
                checked={Boolean(account?.dataSharingAcknowledgedAt)}
                disabled={busy}
                onCheckedChange={(value) => void acknowledge(value === true)}
                data-testid="candidate-chatgpt-consent"
              />
              <span>I agree that my interview content is processed by OpenAI on my connected account.</span>
            </label>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              className="mt-2 h-8 w-full text-xs font-normal text-slate-500 hover:bg-slate-50 hover:text-slate-950"
              onClick={() => void disconnect()}
            >
              {working === "disconnect" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Disconnect ChatGPT
            </Button>
          </div>
        )}

        {login && !login.connected && (
          <div
            className="rounded-lg border border-slate-200 px-3.5 py-4"
            data-testid="candidate-chatgpt-device-login"
          >
            <p className="text-center text-[12.5px] font-medium text-slate-600">
              Enter this code on the OpenAI page
            </p>
            <div className="mt-2.5 flex min-w-0 items-center gap-2">
              <Input
                id="candidate-chatgpt-code"
                readOnly
                aria-label="One-time code"
                value={login.userCode || ""}
                className="h-12 min-w-0 flex-1 rounded-md border-slate-300 bg-slate-50 px-2 text-center font-mono text-base font-bold tracking-[0.16em] text-slate-950 opacity-100 caret-slate-950 focus-visible:ring-slate-400 sm:px-3 sm:text-xl sm:tracking-[0.24em]"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                className="h-12 w-12 shrink-0 rounded-md border-slate-300 bg-white p-0 text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                aria-label={copied ? "Code copied" : "Copy code"}
                onClick={() => void copyCode()}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-600" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />Waiting for you to finish on OpenAI…
            </p>
          </div>
        )}

        {error && (
          <div
            className="flex gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] leading-relaxed text-red-700"
            role="alert"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {error}
              {cooling && (
                <span className="mt-1 block font-medium tabular-nums" data-testid="candidate-chatgpt-cooldown">
                  You can try again in {countdown}.
                </span>
              )}
            </span>
          </div>
        )}
      </div>

      <div className="mt-5 space-y-2 px-5 pb-6 sm:px-7 sm:pb-7">
        {login && !login.connected ? (
          <>
            {login.verificationUrl && (
              <Button
                asChild
                className="h-11 w-full rounded-md bg-slate-950 text-[15px] font-medium text-white hover:bg-slate-800"
              >
                <a href={login.verificationUrl} target="_blank" rel="noreferrer noopener">
                  <OpenAILogo className="mr-2 h-4 w-4" />Open OpenAI
                  <ExternalLink className="ml-2 h-3.5 w-3.5 opacity-70" />
                </a>
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={busy || cooling}
              className="h-9 w-full text-xs font-normal text-slate-500 hover:bg-slate-50 hover:text-slate-950"
              onClick={() => void connect(true)}
            >
              {working === "restart"
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Start over
            </Button>
          </>
        ) : !connected ? (
          <Button
            type="button"
            disabled={busy || cooling}
            className="h-11 w-full rounded-md bg-slate-950 text-[15px] font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            onClick={() => void connect()}
            data-testid="candidate-chatgpt-connect"
          >
            {working === "connect"
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <OpenAILogo className="mr-2 h-4 w-4" />}
            {cooling ? `Try again in ${countdown}` : "Sign in with OpenAI"}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export default CandidateChatgptGate
