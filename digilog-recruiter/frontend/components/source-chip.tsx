"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ChevronDown, Linkedin, Globe, Users, Mail } from "lucide-react"

interface SourceChipProps {
  source: string
  onSourceChange?: (newSource: string) => void
}

// Sample sources for dropdown
const availableSources = ["LinkedIn", "Website", "Referral", "Job Board", "Email", "Other"]

// Get icon based on source
function getSourceIcon(source: string) {
  switch (source.toLowerCase()) {
    case "linkedin":
      return <Linkedin className="h-3 w-3" />
    case "website":
      return <Globe className="h-3 w-3" />
    case "referral":
      return <Users className="h-3 w-3" />
    case "email":
      return <Mail className="h-3 w-3" />
    default:
      return null
  }
}

export function SourceChip({ source, onSourceChange }: SourceChipProps) {
  // Add null check for source
  if (!source) {
    return (
      <Badge variant="outline" className="gap-1 text-xs">
        Unknown
      </Badge>
    )
  }

  // If onSourceChange is provided, make the chip interactive with a dropdown
  if (onSourceChange) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 gap-1 pl-2 pr-2">
            {getSourceIcon(source)}
            <span className="text-xs">{source}</span>
            <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {availableSources.map((availableSource) => (
            <DropdownMenuItem
              key={availableSource}
              onClick={() => onSourceChange(availableSource)}
              className="flex items-center gap-2"
            >
              {getSourceIcon(availableSource)}
              <span>{availableSource}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // Non-interactive version
  return (
    <Badge variant="outline" className="gap-1 text-xs">
      {getSourceIcon(source)}
      <span>{source}</span>
    </Badge>
  )
}
