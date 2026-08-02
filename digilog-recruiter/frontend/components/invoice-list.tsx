"use client"

import { useState } from "react"
import { Calendar, CreditCard, Download, FileText, Search } from "lucide-react"
import { format } from "date-fns"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

// Sample invoice data
const invoices = [
  {
    id: "INV-001",
    date: new Date("2025-04-01"),
    amount: 49.0,
    status: "paid",
    items: [{ name: "Professional Plan - Monthly", quantity: 1, price: 49.0 }],
  },
  {
    id: "INV-002",
    date: new Date("2025-03-01"),
    amount: 49.0,
    status: "paid",
    items: [{ name: "Professional Plan - Monthly", quantity: 1, price: 49.0 }],
  },
  {
    id: "INV-003",
    date: new Date("2025-02-01"),
    amount: 49.0,
    status: "paid",
    items: [{ name: "Professional Plan - Monthly", quantity: 1, price: 49.0 }],
  },
  {
    id: "INV-004",
    date: new Date("2025-01-01"),
    amount: 29.0,
    status: "paid",
    items: [{ name: "Basic Plan - Monthly", quantity: 1, price: 29.0 }],
  },
  {
    id: "INV-005",
    date: new Date("2024-12-01"),
    amount: 29.0,
    status: "paid",
    items: [{ name: "Basic Plan - Monthly", quantity: 1, price: 29.0 }],
  },
]

export function InvoiceList() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null)

  const filteredInvoices = invoices.filter((invoice) => invoice.id.toLowerCase().includes(searchQuery.toLowerCase()))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search invoices..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredInvoices.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell className="font-medium">{invoice.id}</TableCell>
                <TableCell>{format(invoice.date, "MMM d, yyyy")}</TableCell>
                <TableCell>${invoice.amount.toFixed(2)}</TableCell>
                <TableCell>
                  <Badge variant={invoice.status === "paid" ? "success" : "destructive"} className="capitalize">
                    {invoice.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => setSelectedInvoice(invoice)}>
                          <FileText className="h-4 w-4" />
                          <span className="sr-only">View</span>
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Invoice {invoice.id}</DialogTitle>
                          <DialogDescription>Issued on {format(invoice.date, "MMMM d, yyyy")}</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-6">
                          <div className="flex justify-between">
                            <div>
                              <h3 className="font-semibold">SMART HR</h3>
                              <p className="text-sm text-muted-foreground">123 Recruitment Ave</p>
                              <p className="text-sm text-muted-foreground">San Francisco, CA 94103</p>
                            </div>
                            <div className="text-right">
                              <h3 className="font-semibold">Invoice #{invoice.id}</h3>
                              <p className="text-sm text-muted-foreground">
                                <Calendar className="inline h-3 w-3 mr-1" />
                                {format(invoice.date, "MMMM d, yyyy")}
                              </p>
                              <Badge
                                variant={invoice.status === "paid" ? "success" : "destructive"}
                                className="mt-1 capitalize"
                              >
                                {invoice.status}
                              </Badge>
                            </div>
                          </div>

                          <div className="rounded-md border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Item</TableHead>
                                  <TableHead className="text-right">Qty</TableHead>
                                  <TableHead className="text-right">Price</TableHead>
                                  <TableHead className="text-right">Total</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {invoice.items.map((item, i) => (
                                  <TableRow key={i}>
                                    <TableCell>{item.name}</TableCell>
                                    <TableCell className="text-right">{item.quantity}</TableCell>
                                    <TableCell className="text-right">${item.price.toFixed(2)}</TableCell>
                                    <TableCell className="text-right">
                                      ${(item.quantity * item.price).toFixed(2)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>

                          <div className="flex justify-between items-center">
                            <div>
                              <p className="text-sm text-muted-foreground">
                                Payment processed via <span className="font-medium">Credit Card</span>
                              </p>
                              <div className="flex items-center mt-1">
                                <CreditCard className="h-4 w-4 mr-1 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">•••• 4242</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm text-muted-foreground">Total</p>
                              <p className="text-2xl font-bold">${invoice.amount.toFixed(2)}</p>
                            </div>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>

                    <Button variant="ghost" size="icon">
                      <Download className="h-4 w-4" />
                      <span className="sr-only">Download</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredInvoices.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                  No invoices found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
