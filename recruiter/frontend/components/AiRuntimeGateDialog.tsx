"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { AlertCircle, Loader2 } from "lucide-react"
import { OpenAILogo } from "@/components/ui/openai-logo"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { setAiRuntimeGateHandler, type AiRuntimeGateError } from "@/utils/aiRuntimeGateHandler"
import { aiAccountService, type AiRuntimeAccount } from "@/services/aiAccountService"

const REOPEN_COOLDOWN_MS = 60_000

export function AiRuntimeGateDialog() {
  const router = useRouter()
  const pathname = usePathname()
  const [gate, setGate] = useState<AiRuntimeGateError | null>(null)
  const [account, setAccount] = useState<AiRuntimeAccount | null>(null)
  const [loading, setLoading] = useState(false)
  const lastShownAt = useRef(0)
  const open = useRef(false)

  const onGate = useCallback((incoming: AiRuntimeGateError) => {
    if (open.current || Date.now() - lastShownAt.current < REOPEN_COOLDOWN_MS) return
    lastShownAt.current = Date.now()
    open.current = true
    setGate(incoming)
    setLoading(true)
    aiAccountService.read()
      .then(({ account: current }) => setAccount(current))
      .catch(() => setAccount(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    setAiRuntimeGateHandler(onGate)
    return () => setAiRuntimeGateHandler(null)
  }, [onGate])

  if (pathname?.startsWith("/settings/ai-account") || !gate) return null

  const close = () => { open.current = false; setGate(null) }
  const connected = account?.status === "connected"
  const needsConsent = connected && !account?.routable

  return (
    <Dialog open onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent className="max-w-[95vw] sm:max-w-md" data-testid="ai-runtime-gate-dialog">
        <DialogHeader>
          <DialogTitle>ChatGPT is required</DialogTitle>
          <DialogDescription>
            This AI action runs through your connected ChatGPT account. There is no alternate model provider.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />Checking your ChatGPT connection…
          </div>
        ) : (
          <div className="flex gap-3 rounded-lg border p-4">
            {account?.routable ? <OpenAILogo className="mt-0.5 h-5 w-5" /> : <AlertCircle className="mt-0.5 h-5 w-5 text-amber-500" />}
            <div>
              <p className="text-sm font-medium">
                {account?.routable ? `Connected as ${account.connectedEmail}` : needsConsent ? "Review data sharing" : "ChatGPT is not connected"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Candidate data and AI task content are processed by OpenAI on your connected account.
              </p>
            </div>
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={close}>Not now</Button>
          <Button onClick={() => { close(); router.push("/settings/ai-account?connect=1") }} data-testid="ai-gate-connect-chatgpt">
            <OpenAILogo className="mr-2 h-4 w-4" />
            {needsConsent ? "Review data sharing" : account?.routable ? "Open ChatGPT settings" : "Connect ChatGPT"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default AiRuntimeGateDialog
