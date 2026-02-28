"use client"

import type React from "react"

import { useState } from "react"
import { CreditCard, Plus, Trash } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// Sample payment methods
const paymentMethods = [
  {
    id: "card-1",
    type: "card",
    cardBrand: "visa",
    last4: "4242",
    expiryMonth: 12,
    expiryYear: 2025,
    isDefault: true,
  },
  {
    id: "card-2",
    type: "card",
    cardBrand: "mastercard",
    last4: "5555",
    expiryMonth: 8,
    expiryYear: 2026,
    isDefault: false,
  },
]

export function PaymentMethodSelector() {
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(paymentMethods[0].id)
  const [methods, setMethods] = useState(paymentMethods)
  const [addCardOpen, setAddCardOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [methodToDelete, setMethodToDelete] = useState<string | null>(null)

  const handleSetDefault = (id: string) => {
    setMethods(
      methods.map((method) => ({
        ...method,
        isDefault: method.id === id,
      })),
    )
  }

  const handleDeleteClick = (id: string) => {
    setMethodToDelete(id)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (methodToDelete) {
      setMethods(methods.filter((method) => method.id !== methodToDelete))
      setDeleteDialogOpen(false)
      setMethodToDelete(null)
    }
  }

  const handleAddCard = (e: React.FormEvent) => {
    e.preventDefault()
    // In a real app, this would handle payment processing
    // For demo purposes, we'll just close the dialog
    setAddCardOpen(false)
  }

  return (
    <div className="space-y-4">
      <RadioGroup value={selectedPaymentMethod} onValueChange={setSelectedPaymentMethod} className="space-y-3">
        {methods.map((method) => (
          <div key={method.id} className="flex items-center space-x-2">
            <RadioGroupItem value={method.id} id={method.id} />
            <Label htmlFor={method.id} className="flex-1 cursor-pointer">
              <Card className="p-3 flex justify-between items-center hover:bg-accent/50 transition-colors">
                <div className="flex items-center space-x-3">
                  <div className="bg-muted rounded-md p-2">
                    <CreditCard className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium">
                      {method.cardBrand.charAt(0).toUpperCase() + method.cardBrand.slice(1)} •••• {method.last4}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Expires {method.expiryMonth}/{method.expiryYear}
                    </p>
                  </div>
                  {method.isDefault && (
                    <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Default</span>
                  )}
                </div>
                <div className="flex items-center space-x-1">
                  {!method.isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault()
                        handleSetDefault(method.id)
                      }}
                    >
                      Set default
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.preventDefault()
                      handleDeleteClick(method.id)
                    }}
                  >
                    <Trash className="h-4 w-4" />
                    <span className="sr-only">Delete</span>
                  </Button>
                </div>
              </Card>
            </Label>
          </div>
        ))}
      </RadioGroup>

      <Dialog open={addCardOpen} onOpenChange={setAddCardOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full mt-2">
            <Plus className="mr-2 h-4 w-4" /> Add payment method
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add payment method</DialogTitle>
            <DialogDescription>Add a new credit or debit card to your account</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddCard} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="card-number">Card number</Label>
              <Input id="card-number" placeholder="1234 5678 9012 3456" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="expiry">Expiration date</Label>
                <div className="flex space-x-2">
                  <Select>
                    <SelectTrigger id="expiry-month">
                      <SelectValue placeholder="MM" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                        <SelectItem key={month} value={month.toString().padStart(2, "0")}>
                          {month.toString().padStart(2, "0")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select>
                    <SelectTrigger id="expiry-year">
                      <SelectValue placeholder="YY" />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() + i).map((year) => (
                        <SelectItem key={year} value={year.toString()}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cvc">CVC</Label>
                <Input id="cvc" placeholder="123" maxLength={4} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name on card</Label>
              <Input id="name" placeholder="John Doe" />
            </div>
            <DialogFooter>
              <Button type="submit">Add card</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete payment method</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this payment method? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
