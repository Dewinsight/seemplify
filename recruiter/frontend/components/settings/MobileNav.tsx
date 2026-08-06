"use client"

import React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Settings, CreditCard, Building2, Bell, Mail, Coins, DollarSign, Bot } from "lucide-react"


// Navigation items with icon components and short names
const navItems = [
  { title: "General", shortTitle: "General", href: "/settings", icon: Settings },
  { title: "Subscription", shortTitle: "Billing", href: "/settings/subscription", icon: CreditCard },
  { title: "Credits", shortTitle: "Credits", href: "/settings/credits", icon: Coins },
  { title: "Organization", shortTitle: "Org", href: "/settings/organization", icon: Building2 },
  { title: "Currencies", shortTitle: "Currency", href: "/settings/currencies", icon: DollarSign },
  { title: "ChatGPT account", shortTitle: "ChatGPT", href: "/settings/ai-account", icon: Bot },
  { title: "Notifications", shortTitle: "Alerts", href: "/settings/notifications", icon: Bell },
  { title: "Invitations", shortTitle: "Invites", href: "/settings/invitations", icon: Mail },
]

export function MobileNav() {
  const pathname = usePathname()
  const router = useRouter()
  
  // More precise path matching - exact match for /settings, prefix match for others
  const currentPath = navItems.find(item => {
    if (item.href === "/settings") {
      return pathname === "/settings"
    }
    return pathname?.startsWith(item.href)
  })?.href || "/settings"
  
  const handleTabChange = (href: string) => {
    router.push(href)
  }
  
  return (
    <div className="block lg:hidden mb-6 relative">
      <Tabs value={currentPath} className="w-full">
        <div className="relative">
          {/* Scrollable tab container with improved visibility and alignment */}
          <div className="relative overflow-hidden">
            <TabsList 
              className="flex w-full overflow-x-auto py-2 px-2 bg-white dark:bg-gray-800 rounded-lg shadow-sm snap-x scrollbar-hide mobile-nav-tabs momentum-scroll"
              style={{
                WebkitOverflowScrolling: 'touch',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                display: 'flex',
                justifyContent: 'space-between'
              }}
            >
              {navItems.map((item, index) => (
                <TabsTrigger
                  key={item.href}
                  value={item.href}
                  onClick={() => handleTabChange(item.href)}
                  title={item.title}
                  className={`flex-shrink-0 ${index === 0 ? 'snap-start' : 'snap-center'} min-w-[60px] flex flex-col items-center gap-1 py-2.5 px-2 ${index === 0 ? 'mr-1' : 'mx-0.5'} mobile-nav-tab data-[state=active]:bg-blue-50 data-[state=active]:text-blue-600 data-[state=active]:border-b-2 data-[state=active]:border-blue-500 dark:data-[state=active]:bg-gray-700 dark:data-[state=active]:text-white dark:data-[state=active]:border-blue-400 rounded-md transition-all cursor-pointer`}
                >
                  {React.createElement(item.icon, { className: "h-4 w-4" })}
                  <span className="text-[10px] font-medium">{item.shortTitle}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            
            {/* Refined scroll indicators */}
            <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white to-transparent dark:from-gray-800 pointer-events-none z-10"></div>
            <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white to-transparent dark:from-gray-800 pointer-events-none z-10"></div>
          </div>
          
          {/* Scroll indicator dots with active state */}
          <div className="flex justify-center mt-2 space-x-1.5">
            {navItems.map((item) => {
              const isActive = item.href === "/settings" 
                ? pathname === "/settings" 
                : pathname?.startsWith(item.href)
              
              return (
                <div 
                  key={item.href}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    isActive 
                      ? "w-5 bg-blue-500 dark:bg-blue-400" 
                      : "w-1.5 bg-gray-300 dark:bg-gray-600"
                  }`}
                  aria-hidden="true"
                ></div>
              )
            })}
          </div>
        </div>
      </Tabs>
    </div>
  )
}
