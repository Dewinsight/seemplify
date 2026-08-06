"use client"

import React from "react"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle, AlertDialogFooter, AlertDialogCancel } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { CreditCard, AlertCircle, TrendingUp, ShoppingCart, X } from "lucide-react"
import { CreditError, ACTION_NAMES, ACTION_ICONS } from "@/utils/creditErrorHandler"
import { useRouter } from "next/navigation"

interface CreditErrorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  error: CreditError | null;
}

export function CreditErrorDialog({ open, onOpenChange, error }: CreditErrorDialogProps) {
  const router = useRouter()
  
  // Return null if no error
  if (!error || !error.details) {
    return null;
  }
  
  const actionName = ACTION_NAMES[error.details.action] || error.details.action;
  const actionIcon = ACTION_ICONS[error.details.action] || "💳";
  const total = error.details.available + error.details.deficit;
  const usagePercentage = total > 0 ? Math.round((error.details.available / total) * 100) : 0;
  
  const handlePurchaseCredits = () => {
    onOpenChange(false);
    router.push('/analytics/credits');
  };
  
  const handleUpgradePlan = () => {
    onOpenChange(false);
    router.push('/settings/subscription');
  };
  
  const handleViewUsage = () => {
    onOpenChange(false);
    router.push('/analytics/credits#usage');
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg overflow-hidden p-0">
        {/* Header Section */}
        <div className="relative bg-gradient-to-r from-red-500 to-orange-500 px-6 py-5 text-white">
          <AlertDialogCancel className="absolute right-4 top-4 border-0 bg-white/20 hover:bg-white/30 text-white">
            <X className="h-4 w-4" />
          </AlertDialogCancel>
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-white/20 p-2 backdrop-blur-sm">
              <AlertCircle className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <AlertDialogTitle className="text-xl font-semibold text-white mb-1">
                Insufficient Credits
              </AlertDialogTitle>
              <AlertDialogDescription className="text-white/90 text-sm">
                You don't have enough credits to perform this action
              </AlertDialogDescription>
            </div>
          </div>
        </div>

        {/* Content Section */}
        <div className="px-6 py-5 space-y-5">
          {/* Action Info */}
          <div className="flex items-center gap-3 p-4 bg-orange-50 dark:bg-orange-950/20 rounded-lg border border-orange-200 dark:border-orange-800">
            <span className="text-3xl">{actionIcon}</span>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Action Required</p>
              <p className="font-semibold text-foreground">{actionName}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Cost</p>
              <p className="text-lg font-bold text-orange-600 dark:text-orange-400">
                {error.details.required} credits
              </p>
            </div>
          </div>

          {/* Credit Balance */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Your Credit Balance</h4>
              <span className="text-2xl font-bold text-foreground">{error.details.available}</span>
            </div>
            
            <div className="space-y-2">
              <Progress value={usagePercentage} className="h-3" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{error.details.available} available</span>
                <span className="text-red-600 dark:text-red-400 font-medium">
                  Need {error.details.deficit} more
                </span>
              </div>
            </div>
          </div>

          {/* Suggestions */}
          {error.suggestions && error.suggestions.length > 0 && (
            <div className="rounded-lg bg-muted/50 p-4 space-y-2.5">
              <p className="text-sm font-medium flex items-center gap-2">
                <span className="text-blue-600 dark:text-blue-400">💡</span>
                What you can do:
              </p>
              <ul className="space-y-2">
                {error.suggestions.map((suggestion, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="text-blue-600 dark:text-blue-400 mt-0.5">→</span>
                    <span className="flex-1">{suggestion}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <AlertDialogFooter className="px-6 py-4 bg-muted/30 border-t">
          <div className="flex flex-col sm:flex-row gap-2 w-full">
            <Button 
              variant="outline" 
              onClick={handleViewUsage}
              className="flex items-center justify-center gap-2 flex-1"
            >
              <TrendingUp className="h-4 w-4" />
              View Usage
            </Button>
            <Button 
              variant="outline" 
              onClick={handleUpgradePlan}
              className="flex items-center justify-center gap-2 flex-1"
            >
              <CreditCard className="h-4 w-4" />
              Upgrade Plan
            </Button>
            <Button 
              onClick={handlePurchaseCredits}
              className="flex items-center justify-center gap-2 flex-1 bg-orange-600 hover:bg-orange-700"
            >
              <ShoppingCart className="h-4 w-4" />
              Buy Credits
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
