"use client"

import React from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { 
  Plus, 
  Users, 
  Briefcase, 
  Calendar, 
  HelpCircle, 
  Upload, 
  Workflow,
  Home,
  GraduationCap,
  ArrowRight
} from 'lucide-react'

interface NavigationButton {
  label: string
  url: string
  icon: string
}

interface GuideCardProps {
  title: string
  description: string
  primaryButton: NavigationButton
  secondaryButton?: NavigationButton
}

const getIcon = (iconName: string) => {
  const icons: { [key: string]: any } = {
    Plus,
    Users,
    Briefcase,
    Calendar,
    HelpCircle,
    Upload,
    Workflow,
    Home,
    GraduationCap,
    ArrowRight,
    UserPlus: Plus
  }
  return icons[iconName] || ArrowRight
}

export function GuideCard({ title, description, primaryButton, secondaryButton }: GuideCardProps) {
  const PrimaryIcon = getIcon(primaryButton.icon)
  const SecondaryIcon = secondaryButton ? getIcon(secondaryButton.icon) : null

  return (
    <Card className="border-2 border-blue-200 bg-gradient-to-br from-[#F1ECFF] via-[#E9E2FB] to-[#F1ECFF] dark:from-[#1E0059]/20 dark:to-[#1E0059]/20 shadow-lg hover:shadow-xl transition-all duration-300">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          {title}
        </CardTitle>
        <CardDescription className="text-sm text-gray-600 dark:text-gray-400">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button 
          asChild 
          className="w-full bg-gradient-to-r from-[#754BE5] to-[#6935CF] hover:from-[#6935CF] hover:to-[#5a2cb5] text-white shadow-md hover:shadow-lg transition-all"
        >
          <Link href={primaryButton.url}>
            <PrimaryIcon className="mr-2 h-4 w-4" />
            {primaryButton.label}
          </Link>
        </Button>
        
        {secondaryButton && SecondaryIcon && (
          <Button 
            asChild 
            variant="outline"
            className="w-full border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/30"
          >
            <Link href={secondaryButton.url}>
              <SecondaryIcon className="mr-2 h-4 w-4" />
              {secondaryButton.label}
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

