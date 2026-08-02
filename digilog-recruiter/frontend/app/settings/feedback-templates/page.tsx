"use client";

import { FeedbackFormTemplateManager } from '@/components/ui/feedback-form-template-manager';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare } from 'lucide-react';

export default function FeedbackTemplatesPage() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <MessageSquare className="h-8 w-8" />
          Feedback Form Management
        </h1>
        <p className="text-muted-foreground mt-2">
          Create and manage feedback form templates and custom fields for your organization
        </p>
      </div>

      <FeedbackFormTemplateManager />
    </div>
  );
}

