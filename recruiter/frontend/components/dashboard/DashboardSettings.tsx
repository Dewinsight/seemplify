'use client';

import React from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Settings, Eye, EyeOff, RotateCcw, Palette, Layout } from 'lucide-react';
import { useDashboardState } from '@/app/dashboard/hooks/useDashboardState';
import { cn } from '@/lib/utils';

interface DashboardSettingsProps {
  trigger?: React.ReactNode;
}

export function DashboardSettings({ trigger }: DashboardSettingsProps) {
  const {
    viewMode,
    setViewMode,
    sections,
    toggleSectionVisibility,
    showTrends,
    toggleShowTrends,
    animationsEnabled,
    toggleAnimations,
    resetToDefaults,
  } = useDashboardState();

  const sectionConfig = [
    { id: 'keyMetrics', label: 'Key Metrics', description: 'Primary KPIs and statistics' },
    { id: 'analytics', label: 'Analytics & Charts', description: 'Detailed analytics tabs' },
    { id: 'quickActions', label: 'Recruitment Workspace', description: 'Primary workflows and shortcuts' },
    { id: 'activityFeed', label: 'Activity Feed', description: 'Recent activity timeline' },
    { id: 'topJobs', label: 'Top Jobs', description: 'Best performing positions' },
  ];

  return (
    <Sheet>
      <SheetTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 mr-2" />
            Customize
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-[calc(100vw-2rem)] max-w-[400px] overflow-y-auto sm:w-[540px] sm:max-w-[540px]">
        <SheetHeader>
          <SheetTitle>Dashboard Settings</SheetTitle>
          <SheetDescription>
            Customize your dashboard view and preferences
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* View Mode */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">View Mode</Label>
            <RadioGroup value={viewMode} onValueChange={(value) => setViewMode(value as any)}>
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="simple" id="simple" />
                <div className="space-y-1">
                  <Label htmlFor="simple" className="font-normal cursor-pointer">
                    Simple View
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Clean, focused view with essential metrics only
                  </p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="detailed" id="detailed" />
                <div className="space-y-1">
                  <Label htmlFor="detailed" className="font-normal cursor-pointer">
                    Detailed View
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Comprehensive view with all data and charts
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>

          <Separator />

          {/* Section Visibility */}
          <div className="space-y-3">
            <Label className="text-base font-semibold flex items-center gap-2">
              <Layout className="h-4 w-4" />
              Section Visibility
            </Label>
            <div className="space-y-3">
              {sectionConfig.map((section) => (
                <div key={section.id} className="flex items-start justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor={section.id} className="font-normal cursor-pointer">
                      {section.label}
                    </Label>
                    <p className="text-sm text-muted-foreground">{section.description}</p>
                  </div>
                  <Switch
                    id={section.id}
                    checked={sections[section.id]?.visible ?? true}
                    onCheckedChange={() => toggleSectionVisibility(section.id)}
                  />
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Display Preferences */}
          <div className="space-y-3">
            <Label className="text-base font-semibold flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Display Preferences
            </Label>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="trends" className="font-normal cursor-pointer">
                    Show Trends
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Display trend indicators on metric cards
                  </p>
                </div>
                <Switch
                  id="trends"
                  checked={showTrends}
                  onCheckedChange={toggleShowTrends}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="animations" className="font-normal cursor-pointer">
                    Enable Animations
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Smooth transitions and hover effects
                  </p>
                </div>
                <Switch
                  id="animations"
                  checked={animationsEnabled}
                  onCheckedChange={toggleAnimations}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Actions */}
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full"
              onClick={resetToDefaults}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset to Defaults
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
