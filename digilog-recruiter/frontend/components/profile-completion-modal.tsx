'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, AlertCircle, User, Building, Settings, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useUser } from '@/context/UserContext';

interface ProfileCompletionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProfileCompletionModal({ open, onOpenChange }: ProfileCompletionModalProps) {
  const { state } = useUser();
  const { user, suggestions } = state;

  if (!user) return null;

  const completionPercentage = user.profileCompletion?.percentage || 0;
  const missingFields = user.profileCompletion?.missingFields || [];

  const getFieldIcon = (field: string) => {
    if (field.includes('name') || field.includes('profile')) return User;
    if (field.includes('company')) return Building;
    return Settings;
  };

  const getFieldLabel = (field: string) => {
    const labels: Record<string, string> = {
      'profile.firstName': 'First Name',
      'profile.lastName': 'Last Name',
      'profile.title': 'Job Title',
      'profile.bio': 'Bio',
      'profile.phone': 'Phone Number',
      'profile.avatar': 'Profile Picture',
    };
    return labels[field] || field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
  };

  const prioritySuggestions = suggestions.filter(s => s.priority === 'high').slice(0, 3);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[95vw] sm:w-full max-h-[90vh] flex flex-col p-0 border-0 shadow-2xl">
        <div className="p-6 pb-4 flex-shrink-0 bg-gradient-to-r from-amber-50 via-orange-50 to-red-50 dark:from-amber-950/20 dark:via-orange-950/20 dark:to-red-950/20 border-b border-amber-100 dark:border-amber-800/50">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-xl font-bold bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/50 rounded-xl">
                <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              </div>
              Complete Your Profile
            </DialogTitle>
            <DialogDescription className="mt-2 text-base text-amber-700 dark:text-amber-300">
              Unlock premium features and get personalized recommendations by completing your profile.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex-1 overflow-y-auto p-6 pt-6">
          <div className="space-y-6">
          {/* Progress Overview */}
          <Card className="border-0 bg-gradient-to-br from-[#F1ECFF] to-[#E9E2FB] dark:from-[#1E0059]/30 dark:to-[#1E0059]/30 shadow-lg">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl font-bold text-blue-900 dark:text-blue-100">Profile Completion</CardTitle>
                  <CardDescription className="text-blue-700 dark:text-blue-300 mt-1">
                    {completionPercentage}% complete
                  </CardDescription>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">{completionPercentage}%</div>
                  <div className="text-xs text-blue-500 dark:text-blue-400 font-medium">PROGRESS</div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="relative">
                  <Progress value={completionPercentage} className="h-4 bg-blue-200 dark:bg-blue-900" />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#754BE5] to-[#6935CF] rounded-full opacity-20 blur-sm"></div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                      {completionPercentage < 50 
                        ? "🚀 Let's get started with the basics"
                        : completionPercentage < 80 
                        ? "🔥 You're making great progress!"
                        : "⭐ Almost there! Just a few more details"
                      }
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Missing Fields */}
          {missingFields.length > 0 && (
            <Card className="border-0 bg-gradient-to-br from-rose-50 to-[#E9E2FB] dark:from-rose-950/30 dark:to-[#1E0059]/30 shadow-lg">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-rose-100 dark:bg-rose-900/50 rounded-xl">
                    <AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-bold text-rose-900 dark:text-rose-100">Missing Information</CardTitle>
                    <CardDescription className="text-rose-700 dark:text-rose-300">
                      Complete these fields to improve your profile
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  {missingFields.slice(0, 6).map((field, index) => {
                    const Icon = getFieldIcon(field);
                    return (
                      <div 
                        key={field} 
                        className="group flex items-center gap-4 p-4 rounded-xl bg-white/80 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/50 hover:shadow-md transition-all duration-200 hover:border-rose-300 dark:hover:border-rose-700"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/50 group-hover:bg-rose-200 dark:group-hover:bg-rose-800 transition-colors">
                          <Icon className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                        </div>
                        <div className="flex-1">
                          <span className="font-medium text-rose-900 dark:text-rose-100">{getFieldLabel(field)}</span>
                        </div>
                        <Badge variant="outline" className="bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-700">
                          Missing
                        </Badge>
                      </div>
                    );
                  })}
                  {missingFields.length > 6 && (
                    <div className="text-center p-3 bg-white/60 dark:bg-rose-900/20 rounded-lg border border-rose-200 dark:border-rose-800/50">
                      <p className="text-sm font-medium text-rose-700 dark:text-rose-300">
                        +{missingFields.length - 6} more fields to complete
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Priority Suggestions */}
          {prioritySuggestions.length > 0 && (
            <Card className="border-0 bg-gradient-to-br from-emerald-50 to-teal-100 dark:from-emerald-950/30 dark:to-teal-950/30 shadow-lg">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-100 dark:bg-emerald-900/50 rounded-xl">
                    <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-bold text-emerald-900 dark:text-emerald-100">Recommended Actions</CardTitle>
                    <CardDescription className="text-emerald-700 dark:text-emerald-300">
                      High priority items to complete first
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {prioritySuggestions.map((suggestion, index) => (
                    <div key={index} className="group flex items-start gap-4 p-4 rounded-xl bg-white/80 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 hover:shadow-md transition-all duration-200 hover:border-emerald-300 dark:hover:border-emerald-700">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold shadow-lg">
                        {index + 1}
                      </div>
                      <div className="flex-1 space-y-1">
                        <h4 className="font-bold text-emerald-900 dark:text-emerald-100">{suggestion.title}</h4>
                        <p className="text-sm text-emerald-700 dark:text-emerald-300">{suggestion.description}</p>
                      </div>
                      <Badge className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white border-0 shadow-sm">
                        {suggestion.priority}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}


          {/* Benefits */}
          <Card className="border-0 bg-gradient-to-br from-violet-50 via-purple-50 to-[#E9E2FB] dark:from-violet-950/30 dark:via-purple-950/30 dark:to-[#1E0059]/30 shadow-lg overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-violet-100 dark:bg-violet-900/50 rounded-2xl">
                  <CheckCircle className="h-6 w-6 text-violet-600 dark:text-violet-400" />
                </div>
                <div className="flex-1">
                  <h4 className="font-bold text-lg text-violet-900 dark:text-violet-100 mb-3">
                    🎯 Benefits of a Complete Profile
                  </h4>
                  <div className="grid gap-3">
                    {[
                      { icon: "🤖", text: "Better candidate matching with AI recommendations" },
                      { icon: "📊", text: "Personalized dashboard and analytics" },
                      { icon: "🤝", text: "Enhanced team collaboration features" },
                      { icon: "⚡", text: "Priority support and feature access" }
                    ].map((benefit, index) => (
                      <div key={index} className="flex items-center gap-3 p-3 bg-white/60 dark:bg-violet-900/20 rounded-lg border border-violet-200 dark:border-violet-800/50">
                        <span className="text-lg">{benefit.icon}</span>
                        <span className="text-sm font-medium text-violet-800 dark:text-violet-200">{benefit.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          </div>
        </div>
        
        {/* Modal Footer with Action Buttons */}
        <DialogFooter className="p-6 pt-4 border-t border-amber-100 dark:border-amber-800/50 bg-gradient-to-r from-amber-50/50 via-orange-50/50 to-red-50/50 dark:from-amber-950/10 dark:via-orange-950/10 dark:to-red-950/10">
          <div className="w-full flex flex-col-reverse sm:flex-row gap-4 items-center sm:justify-between">
            <Button 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              className="w-full sm:w-auto border-2 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium"
            >
              Remind Me Later
            </Button>
            <Button 
              asChild 
              size="lg"
              className="w-full sm:w-auto bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0 shadow-lg hover:shadow-xl transition-all duration-200 font-semibold"
            >
              <Link href="/settings" onClick={() => onOpenChange(false)}>
                Complete Profile Now
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 