"use client"

import type React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Settings, CreditCard, Building2, Bell, Mail, Coins, DollarSign } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { MobileNav } from "@/components/settings/MobileNav"
import { cn } from "@/lib/utils"

const sidebarNavItems = [
  { title: "General", href: "/settings", icon: Settings },
  { title: "Subscription", href: "/settings/subscription", icon: CreditCard },
  { title: "Credits", href: "/settings/credits", icon: Coins },
  { title: "Organization", href: "/settings/organization", icon: Building2 },
  { title: "Currencies", href: "/settings/currencies", icon: DollarSign },
  { title: "Notifications", href: "/settings/notifications", icon: Bell },
  { title: "Invitations", href: "/settings/invitations", icon: Mail },
]

interface SettingsLayoutProps {
  children: React.ReactNode
}

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/settings") {
      return pathname === "/settings"
    }
    return pathname?.startsWith(href)
  }

  return (
    <div className="space-y-4 sm:space-y-6 p-3 sm:p-4 md:p-6 pb-16 max-w-[1400px] mx-auto">
      <div className="space-y-2">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">Manage your account settings and preferences.</p>
      </div>
      <Separator className="my-3 sm:my-6" />
      <MobileNav />
      <div className="flex flex-col space-y-5 lg:flex-row lg:space-x-8 xl:space-x-12 lg:space-y-0">
        <div className="hidden lg:block lg:w-56 flex-shrink-0">
          <nav className="flex flex-col space-y-1">
            {sidebarNavItems.map((item) => {
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <item.icon className={cn("h-4 w-4", active && "text-primary")} />
                  <span>{item.title}</span>
                </Link>
              )
            })}
          </nav>
        </div>
        <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
