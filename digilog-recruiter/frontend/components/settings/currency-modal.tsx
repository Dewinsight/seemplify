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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/use-toast"
import { createCurrency, updateCurrency, type Currency } from "@/services/currencyService"
import { Loader2 } from "lucide-react"

interface CurrencyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currency: Currency | null
  isEdit: boolean
  onSuccess: () => void
}

export function CurrencyModal({
  open,
  onOpenChange,
  currency,
  isEdit,
  onSuccess,
}: CurrencyModalProps) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    code: "",
    symbol: "",
    name: "",
    locale: "en-US",
  })

  useEffect(() => {
    if (currency && isEdit) {
      setFormData({
        code: currency.code,
        symbol: currency.symbol,
        name: currency.name,
        locale: currency.locale || "en-US",
      })
    } else {
      setFormData({
        code: "",
        symbol: "",
        name: "",
        locale: "en-US",
      })
    }
  }, [currency, isEdit, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validation
    if (!formData.code || !formData.symbol || !formData.name) {
      toast({
        title: "Validation Error",
        description: "Currency code, symbol, and name are required",
        variant: "destructive",
      })
      return
    }

    if (formData.code.length !== 3) {
      toast({
        title: "Validation Error",
        description: "Currency code must be exactly 3 characters",
        variant: "destructive",
      })
      return
    }

    try {
      setLoading(true)

      if (isEdit && currency) {
        await updateCurrency(currency._id, {
          symbol: formData.symbol,
          name: formData.name,
          locale: formData.locale,
        })
        toast({
          title: "Currency updated",
          description: `${formData.code} has been updated successfully`,
        })
      } else {
        await createCurrency(formData)
        toast({
          title: "Currency created",
          description: `${formData.code} has been added successfully`,
        })
      }

      onSuccess()
      onOpenChange(false)
    } catch (error: any) {
      toast({
        title: isEdit ? "Error updating currency" : "Error creating currency",
        description: error.message || "An error occurred",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Currency" : "Add New Currency"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the currency details below"
              : "Create a new custom currency for your organization"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="code">
                Currency Code <span className="text-red-500">*</span>
              </Label>
              <Input
                id="code"
                placeholder="USD"
                maxLength={3}
                value={formData.code}
                onChange={(e) =>
                  setFormData({ ...formData, code: e.target.value.toUpperCase() })
                }
                disabled={isEdit} // Cannot change code when editing
                className="uppercase"
              />
              <p className="text-xs text-muted-foreground">
                3-letter ISO 4217 code (e.g., USD, EUR, GBP)
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="symbol">
                Currency Symbol <span className="text-red-500">*</span>
              </Label>
              <Input
                id="symbol"
                placeholder="$"
                value={formData.symbol}
                onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Symbol displayed for this currency (e.g., $, €, £)
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="name">
                Currency Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="name"
                placeholder="US Dollar"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Full name of the currency
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="locale">Locale (Optional)</Label>
              <Input
                id="locale"
                placeholder="en-US"
                value={formData.locale}
                onChange={(e) => setFormData({ ...formData, locale: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Locale for number formatting (e.g., en-US, de-DE)
              </p>
            </div>
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
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "Update Currency" : "Create Currency"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
