"use client"

import type React from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Settings, CreditCard, Building2, Bell, Mail, Coins, DollarSign, Bot } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { MobileNav } from "@/components/settings/MobileNav"

// Metadata is now in a separate file since this is a client component

// Navigation items with icon components - matches MobileNav's structure
const sidebarNavItems = [
  { title: "General", href: "/settings", icon: Settings },
  { title: "Subscription", href: "/settings/subscription", icon: CreditCard },
  { title: "Credits", href: "/settings/credits", icon: Coins },
  { title: "Organization", href: "/settings/organization", icon: Building2 },
  { title: "Currencies", href: "/settings/currencies", icon: DollarSign },
  { title: "AI & ChatGPT", href: "/settings/ai-account", icon: Bot },
  { title: "Notifications", href: "/settings/notifications", icon: Bell },
  { title: "Invitations", href: "/settings/invitations", icon: Mail },
]

interface SettingsLayoutProps {
  children: React.ReactNode
}


export default function SettingsLayout({ children }: SettingsLayoutProps) {
  const pathname = usePathname();
  return (
    <div className="space-y-4 sm:space-y-6 p-3 sm:p-4 md:p-6 pb-16">
      <div className="space-y-2">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">Manage your account settings and preferences.</p>
      </div>
      <Separator className="my-3 sm:my-6" />
      <MobileNav />
      <div className="flex flex-col space-y-5 lg:flex-row lg:space-x-8 xl:space-x-12 lg:space-y-0">
        <div className="hidden lg:block lg:w-1/5">
          <nav className="flex flex-col space-y-1">
            {sidebarNavItems.map((item) => (
              <Button
                key={item.href}
                variant={pathname?.startsWith(item.href) ? "secondary" : "ghost"}
                className="justify-start"
                asChild
              >
                <Link href={item.href} className="flex items-center">
                  <item.icon className="mr-2 h-4 w-4" />
                  <span>{item.title}</span>
                </Link>
              </Button>
            ))}
          </nav>
        </div>
        <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
