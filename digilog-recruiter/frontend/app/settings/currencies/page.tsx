"use client"

import { useState, useEffect } from "react"
import { Plus, Search, Star, Edit, Trash2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "@/components/ui/use-toast"
import { CurrencyModal } from "@/components/settings/currency-modal"
import { DeleteCurrencyModal } from "@/components/settings/delete-currency-modal"
import { getCurrencies, deleteCurrency, setDefaultCurrency, type Currency } from "@/services/currencyService"

export default function CurrenciesPage() {
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [defaultCurrency, setDefaultCurrencyState] = useState<string>("USD")
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [currencyModalOpen, setCurrencyModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | null>(null)
  const [isEditMode, setIsEditMode] = useState(false)

  useEffect(() => {
    loadCurrencies()
  }, [])

  const loadCurrencies = async () => {
    try {
      setLoading(true)
      const data = await getCurrencies()
      setCurrencies(data.currencies || [])
      setDefaultCurrencyState(data.defaultCurrency || "USD")
    } catch (error: any) {
      toast({
        title: "Error loading currencies",
        description: error.message || "Failed to load currencies",
        variant: "destructive",
      })
      setCurrencies([]) // Set empty array on error
    } finally {
      setLoading(false)
    }
  }

  const handleAddCurrency = () => {
    setSelectedCurrency(null)
    setIsEditMode(false)
    setCurrencyModalOpen(true)
  }

  const handleEditCurrency = (currency: Currency) => {
    setSelectedCurrency(currency)
    setIsEditMode(true)
    setCurrencyModalOpen(true)
  }

  const handleDeleteClick = (currency: Currency) => {
    setSelectedCurrency(currency)
    setDeleteModalOpen(true)
  }

  const handleSetDefault = async (currencyCode: string) => {
    try {
      await setDefaultCurrency(currencyCode)
      setDefaultCurrencyState(currencyCode)
      toast({
        title: "Default currency updated",
        description: `${currencyCode} is now your default currency`,
      })
    } catch (error: any) {
      toast({
        title: "Error updating default currency",
        description: error.message || "Failed to update default currency",
        variant: "destructive",
      })
    }
  }

  const filteredCurrencies = (currencies || []).filter(currency =>
    currency.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    currency.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    currency.symbol.includes(searchQuery)
  )

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Currency Management</h1>
          <p className="text-muted-foreground mt-2">
            Manage currencies for your organization and set your default currency
          </p>
        </div>
        <Button onClick={handleAddCurrency}>
          <Plus className="mr-2 h-4 w-4" />
          Add Currency
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Currencies</CardTitle>
          <CardDescription>
            System currencies and your custom currencies are listed below
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search currencies..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading currencies...
            </div>
          ) : filteredCurrencies.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No currencies found matching your search
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Default</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCurrencies.map((currency) => (
                    <TableRow key={currency._id}>
                      <TableCell className="font-medium">{currency.code}</TableCell>
                      <TableCell className="text-xl">{currency.symbol}</TableCell>
                      <TableCell>
                        {currency.name}
                        {currency.isSystem && (
                          <Badge variant="secondary" className="ml-2">
                            SYSTEM
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {currency.isSystem ? (
                          <span className="text-sm text-purple-600 dark:text-purple-400">
                            Global
                          </span>
                        ) : (
                          <span className="text-sm text-blue-600 dark:text-blue-400">
                            Custom
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {defaultCurrency === currency.code ? (
                          <Badge variant="default" className="bg-amber-500">
                            <Star className="mr-1 h-3 w-3 fill-current" />
                            Default
                          </Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSetDefault(currency.code)}
                          >
                            <Star className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        {!currency.isSystem && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEditCurrency(currency)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeleteClick(currency)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {currency.isSystem && (
                          <span className="text-xs text-muted-foreground">
                            Protected
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <CurrencyModal
        open={currencyModalOpen}
        onOpenChange={setCurrencyModalOpen}
        currency={selectedCurrency}
        isEdit={isEditMode}
        onSuccess={loadCurrencies}
      />

      <DeleteCurrencyModal
        open={deleteModalOpen}
        onOpenChange={setDeleteModalOpen}
        currency={selectedCurrency}
        onSuccess={loadCurrencies}
      />
    </div>
  )
}
