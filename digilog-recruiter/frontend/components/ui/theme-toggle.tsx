"use client"

import * as React from "react"
import { Check, Moon, Sun, Monitor } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function ThemeToggle() {
    const { setTheme, theme } = useTheme()

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label={`Appearance: ${theme || "system"}. Choose a theme`} className="h-9 w-9 rounded-lg border-border bg-background hover:bg-muted transition-colors">
                    <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0 text-orange-500" />
                    <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100 text-blue-400" />
                    <span className="sr-only">Choose appearance</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="glass-card">
                <DropdownMenuItem onClick={() => setTheme("system")} className="cursor-pointer gap-2">
                    <Monitor className="h-4 w-4" />
                    <span className="flex-1">System</span>
                    {theme === "system" && <Check className="h-4 w-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("light")} className="cursor-pointer gap-2">
                    <Sun className="h-4 w-4" />
                    <span className="flex-1">Light</span>
                    {theme === "light" && <Check className="h-4 w-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme("dark")} className="cursor-pointer gap-2">
                    <Moon className="h-4 w-4" />
                    <span className="flex-1">Dark</span>
                    {theme === "dark" && <Check className="h-4 w-4" />}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
