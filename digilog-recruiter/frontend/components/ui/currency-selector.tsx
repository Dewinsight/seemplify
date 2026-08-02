"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { getCurrencies, type Currency } from "@/services/currencyService"

interface CurrencySelectorProps {
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function CurrencySelector({
  value,
  onValueChange,
  placeholder = "Select currency...",
  className
}: CurrencySelectorProps) {
  const [open, setOpen] = React.useState(false)
  const [currencies, setCurrencies] = React.useState<Currency[]>([])
  const [loading, setLoading] = React.useState(true)

  // Fetch currencies from API
  React.useEffect(() => {
    const loadCurrencies = async () => {
      try {
        setLoading(true)
        const data = await getCurrencies()
        setCurrencies(data.currencies || [])
      } catch (error) {
        console.error('Failed to load currencies:', error)
        setCurrencies([])
      } finally {
        setLoading(false)
      }
    }
    loadCurrencies()
  }, [])

  const selectedCurrency = currencies.find(c => c.code === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between", className)}
          disabled={loading}
        >
          {selectedCurrency ? (
            <span className="flex items-center">
              <span className="font-medium mr-2">{selectedCurrency.symbol}</span>
              <span>{selectedCurrency.code} - {selectedCurrency.name}</span>
            </span>
          ) : (
            placeholder
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search currency..." />
          <CommandEmpty>
            {loading ? "Loading currencies..." : "No currency found."}
          </CommandEmpty>
          <CommandList className="max-h-[400px]">
            <CommandGroup>
              {currencies.map((currency, index) => (
                <CommandItem
                  key={currency._id}
                  value={`${currency.code} ${currency.name}`}
                  className="cursor-pointer hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                  onSelect={() => {
                    onValueChange(currency.code)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 flex-shrink-0",
                      value === currency.code ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="font-medium mr-2 w-8 flex-shrink-0">{currency.symbol}</span>
                  <span className="font-semibold">{currency.code}</span>
                  <span className="text-muted-foreground ml-2 truncate">- {currency.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
