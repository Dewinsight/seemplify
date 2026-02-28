"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "@/components/ui/use-toast"
import { deleteCurrency, getCurrencyUsage, type Currency } from "@/services/currencyService"
import { AlertTriangle, Loader2, FileText } from "lucide-react"

interface DeleteCurrencyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currency: Currency | null
  onSuccess: () => void
}

export function DeleteCurrencyModal({
  open,
  onOpenChange,
  currency,
  onSuccess,
}: DeleteCurrencyModalProps) {
  const [loading, setLoading] = useState(false)
  const [loadingUsage, setLoadingUsage] = useState(false)
  const [usage, setUsage] = useState<{ active: number; archived: number; total: number } | null>(null)

  useEffect(() => {
    if (open && currency) {
      loadUsage()
    }
  }, [open, currency])

  const loadUsage = async () => {
    if (!currency) return

    try {
      setLoadingUsage(true)
      const usageData = await getCurrencyUsage(currency.code)
      setUsage(usageData.usage)
    } catch (error) {
      console.error("Error loading usage:", error)
      setUsage({ active: 0, archived: 0, total: 0 })
    } finally {
      setLoadingUsage(false)
    }
  }

  const handleDelete = async () => {
    if (!currency) return

    try {
      setLoading(true)
      await deleteCurrency(currency._id)
      toast({
        title: "Currency deleted",
        description: `${currency.code} has been removed successfully`,
      })
      onSuccess()
      onOpenChange(false)
    } catch (error: any) {
      toast({
        title: "Error deleting currency",
        description: error.message || "Failed to delete currency",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  if (!currency) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            Delete Currency?
          </DialogTitle>
          <DialogDescription>
            This action cannot be undone. Are you sure you want to delete this currency?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Currency Code:</span>
              <span className="text-sm font-bold">{currency.code}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Currency Name:</span>
              <span className="text-sm">{currency.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Symbol:</span>
              <span className="text-sm text-xl">{currency.symbol}</span>
            </div>
          </div>

          {loadingUsage ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Checking usage...</span>
            </div>
          ) : usage && (
            <Alert variant={usage.total > 0 ? "destructive" : "default"}>
              <FileText className="h-4 w-4" />
              <AlertDescription>
                <div className="font-medium mb-2">Impact Analysis:</div>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>{usage.active} active job(s) use this currency</li>
                  <li>{usage.archived} archived job(s) use this currency</li>
                  <li><strong>Total: {usage.total} job(s)</strong></li>
                </ul>
                {usage.active > 0 && (
                  <div className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">
                    ⚠️ Warning: This currency is currently in use by active jobs and cannot be deleted.
                  </div>
                )}
                {usage.active === 0 && usage.archived > 0 && (
                  <div className="mt-3 text-sm">
                    ℹ️ This currency is only used in archived jobs. You can safely delete it.
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {!loadingUsage && usage && usage.active === 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This action cannot be undone. Consider editing the currency instead if you're not sure.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={loading || loadingUsage || (usage && usage.active > 0)}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
