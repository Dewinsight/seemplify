"use client"

import * as React from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const options = [
    { value: "system", label: "System", icon: Monitor },
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
] as const

export function ThemeToggle({ className }: { className?: string }) {
    const { theme = "system", setTheme } = useTheme()
    const CurrentIcon = options.find((option) => option.value === theme)?.icon || Monitor

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    size="icon"
                    className={cn("h-9 w-9 rounded-lg border-border bg-background transition-colors hover:bg-muted", className)}
                    aria-label={`Appearance: ${theme}. Choose a theme`}
                >
                    <CurrentIcon className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" aria-label="Appearance">
                <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                    {options.map(({ value, label, icon: Icon }) => (
                        <DropdownMenuRadioItem key={value} value={value}>
                            <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                            {label}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
