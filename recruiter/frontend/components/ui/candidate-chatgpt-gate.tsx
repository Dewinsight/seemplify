"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Bot, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
    if (working) return
    setWorking(restart ? "restart" : "connect")
    setError("")
    setCopied(false)
    try {
      if (restart) await aiInterviewService.cancelPublicChatgptLogin(token).catch(() => undefined)
      const { login: next, account: current } = await aiInterviewService.startPublicChatgptLogin(token)
      setAccount(current)
      if (next.connected) await refresh()
      else setLogin(next)
    } catch (reason: any) {
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

  return (
    <div className="mx-auto w-full max-w-lg rounded-lg border bg-white p-6 shadow-sm dark:bg-gray-900" data-testid="candidate-chatgpt-gate">
      <div className="flex items-start gap-3">
        <Bot className="mt-1 h-6 w-6 text-blue-600" />
        <div>
          <h2 className="text-lg font-semibold">Connect ChatGPT to begin</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This interview is conducted by AI running on <strong>your own ChatGPT account</strong>, so your
            answers are processed on your plan rather than ours.
          </p>
        </div>
      </div>

      <p className="mt-4 rounded-md border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
        Connecting allows the questions you are asked and the answers you give to be processed by OpenAI
        using your account. Voice audio is handled separately by the platform and is not sent to your account.
      </p>

      {connected && (
        <div className="mt-4 rounded-md border p-3 text-sm" data-testid="candidate-chatgpt-connected">
          <p className="font-medium">Connected as {account?.connectedEmail || "your ChatGPT account"}</p>
          <label className="mt-3 flex items-start gap-2 text-xs leading-5">
            <Checkbox
              checked={Boolean(account?.dataSharingAcknowledgedAt)}
              disabled={busy}
              onCheckedChange={(value) => void acknowledge(value === true)}
              data-testid="candidate-chatgpt-consent"
            />
            <span>I agree that my interview content is processed by OpenAI on my connected account.</span>
          </label>
        </div>
      )}

      {login && !login.connected && (
        <div className="mt-4 space-y-3 rounded-md border p-4" data-testid="candidate-chatgpt-device-login">
          <p className="text-sm font-medium">Finish signing in with OpenAI</p>
          <div>
            <Label htmlFor="candidate-chatgpt-code">One-time code</Label>
            <div className="mt-1 flex gap-2">
              <Input
                id="candidate-chatgpt-code"
                readOnly
                value={login.userCode || ""}
                className="font-mono tracking-widest"
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
            {login.verificationUrl && (
              <Button asChild size="sm">
                <a href={login.verificationUrl} target="_blank" rel="noreferrer noopener">
                  Open OpenAI<ExternalLink className="ml-1 h-4 w-4" />
                </a>
              </Button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="mt-5 flex justify-end">
        {login && !login.connected ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void connect(true)}>
            {working === "restart" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
            Restart sign-in
          </Button>
        ) : !connected ? (
          <Button type="button" disabled={busy} onClick={() => void connect()} data-testid="candidate-chatgpt-connect">
            {working === "connect" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Bot className="mr-1 h-4 w-4" />}
            Connect ChatGPT
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export default CandidateChatgptGate
