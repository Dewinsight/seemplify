"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Bot, Loader2, ServerOff } from "lucide-react"
import {
  AI_GATE_ACTION_CODES,
  setAiRuntimeGateHandler,
  type AiRuntimeGateError
} from "@/utils/aiRuntimeGateHandler"
import {
  aiAccountService,
  type AiRuntimeAccount,
  type AiRuntimePolicy
} from "@/services/aiAccountService"

// One prompt per stretch of work: parallel failed calls must not stack dialogs.
const REOPEN_COOLDOWN_MS = 60_000

/**
 * Global dialog shown when an AI action fails because of runtime
 * availability: the local model is turned off or unreachable while it is the
 * effective runtime, or the action needs the user's own ChatGPT account.
 * Mounted once in ConditionalProviders, wired to apiRequest via
 * setAiRuntimeGateHandler — the same architecture as InactivityWarning.
 */
export function AiRuntimeGateDialog() {
  const router = useRouter()
  const pathname = usePathname()
  const [gate, setGate] = useState<AiRuntimeGateError | null>(null)
  const [account, setAccount] = useState<AiRuntimeAccount | null>(null)
  const [policy, setPolicy] = useState<AiRuntimePolicy | null>(null)
  const [loading, setLoading] = useState(false)
  const lastShownAtRef = useRef(0)
  const openRef = useRef(false)

  const onGate = useCallback((incoming: AiRuntimeGateError) => {
    if (openRef.current) return
    if (Date.now() - lastShownAtRef.current < REOPEN_COOLDOWN_MS) return
    lastShownAtRef.current = Date.now()
    openRef.current = true
    setGate(incoming)
    setLoading(true)
    aiAccountService.read()
      .then(({ account: current, runtimePolicy }) => {
        setAccount(current)
        setPolicy(runtimePolicy || null)
      })
      .catch(() => {
        setAccount(null)
        setPolicy(null)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    setAiRuntimeGateHandler(onGate)
    return () => setAiRuntimeGateHandler(null)
  }, [onGate])

  // The settings page is where connecting happens; gating it would loop.
  if (pathname?.startsWith("/settings/ai-account")) return null

  const close = () => {
    openRef.current = false
    setGate(null)
  }

  if (!gate) return null

  const needsAccountAction = AI_GATE_ACTION_CODES.has(gate.code)
  const needsConsent = gate.code === "CODEX_DATA_SHARING_ACKNOWLEDGEMENT_REQUIRED"
    || (account?.status === "connected" && !account?.routable)
  const chatgptAvailable = policy ? policy.chatgptEnabled : true
  const canSelfServe = chatgptAvailable && (needsAccountAction || !account?.routable)

  const localStatus = policy && !policy.localEnabled
    ? "Turned off by your administrator"
    : "Currently unavailable"
  const chatgptStatus = !chatgptAvailable
    ? "Disabled by your administrator"
    : account?.routable
      ? `Connected as ${account.connectedEmail}`
      : needsConsent
        ? "Connected — data sharing needs your acknowledgement"
        : "Not connected yet"

  const goToChatGptSettings = () => {
    close()
    router.push("/settings/ai-account?connect=1")
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="max-w-[95vw] sm:max-w-md" data-testid="ai-runtime-gate-dialog">
        <DialogHeader>
          <DialogTitle>Choose an AI runtime to continue</DialogTitle>
          <DialogDescription>
            {needsAccountAction
              ? "This AI action is set to run on your own ChatGPT account, and the local model cannot take it right now."
              : "The AI runtime that serves this action is not available right now."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking your AI runtime options…
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <div className="flex items-start gap-3 rounded-md border p-3 opacity-70" data-testid="ai-gate-local-option">
              <ServerOff className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Local model</p>
                  <Badge variant="outline">{localStatus}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  The managed local AI runtime for this workspace.
                </p>
              </div>
            </div>

            <div
              className={`flex items-start gap-3 rounded-md border p-3 ${chatgptAvailable ? "border-primary/40 bg-primary/5" : "opacity-70"}`}
              data-testid="ai-gate-chatgpt-option"
            >
              <Bot className="mt-0.5 h-5 w-5 text-primary" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">ChatGPT — your account</p>
                  <Badge variant={account?.routable ? "default" : "secondary"}>{chatgptStatus}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Runs AI actions on your own ChatGPT plan, billed to you, isolated to your account.
                </p>
              </div>
            </div>

            {!chatgptAvailable && (
              <p className="text-sm text-muted-foreground" role="alert">
                Both runtimes are unavailable. Ask a platform administrator to re-enable a runtime,
                then try again.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={close}>Not now</Button>
          {canSelfServe && (
            <Button onClick={goToChatGptSettings} data-testid="ai-gate-connect-chatgpt">
              <Bot className="mr-2 h-4 w-4" />
              {needsConsent ? "Review data sharing" : account?.routable ? "Open ChatGPT settings" : "Use ChatGPT"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default AiRuntimeGateDialog
