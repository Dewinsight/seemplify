"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown } from "lucide-react"

interface OwnerChipProps {
  owner: {
    name: string
    avatar: string
  }
  onOwnerChange?: (newOwner: string) => void
}

// Sample owners for dropdown
const availableOwners = [
  {
    name: "Michael Brown",
    avatar: "/monogram-mb.png",
  },
  {
    name: "Sarah Johnson",
    avatar: "/stylized-letters-sj.png",
  },
  {
    name: "David Wilson",
    avatar: "/abstract-dw.png",
  },
  {
    name: "Emily Davis",
    avatar: "/ed-initials-abstract.png",
  },
  {
    name: "Alex Thompson",
    avatar: "/at-symbol-typography.png",
  },
]

export function OwnerChip({ owner, onOwnerChange }: OwnerChipProps) {
  // Add null check for owner
  if (!owner || !owner.name) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border bg-background px-1.5 py-0.5 text-xs">
        <Avatar className="h-4 w-4">
          <AvatarFallback>?</AvatarFallback>
        </Avatar>
        <span>Unassigned</span>
      </div>
    )
  }

  // If onOwnerChange is provided, make the chip interactive with a dropdown
  if (onOwnerChange) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 gap-2 pl-1 pr-2">
            <Avatar className="h-5 w-5">
              <AvatarImage src={owner.avatar || "/placeholder.svg"} alt={owner.name} />
              <AvatarFallback>
                {owner.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs">{owner.name}</span>
            <ChevronDown className="ml-1 h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Reassign to</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {availableOwners.map((availableOwner) => (
            <DropdownMenuItem
              key={availableOwner.name}
              onClick={() => onOwnerChange(availableOwner.name)}
              className="flex items-center gap-2"
            >
              <Avatar className="h-6 w-6">
                <AvatarImage src={availableOwner.avatar || "/placeholder.svg"} alt={availableOwner.name} />
                <AvatarFallback>
                  {availableOwner.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </AvatarFallback>
              </Avatar>
              <span>{availableOwner.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // Non-interactive version
  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-background px-1.5 py-0.5 text-xs">
      <Avatar className="h-4 w-4">
        <AvatarImage src={owner.avatar || "/placeholder.svg"} alt={owner.name} />
        <AvatarFallback>
          {owner.name
            .split(" ")
            .map((n) => n[0])
            .join("")}
        </AvatarFallback>
      </Avatar>
      <span>{owner.name}</span>
    </div>
  )
}
