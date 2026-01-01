'use client';

import { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCcw, Home } from "lucide-react";
import Link from 'next/link';

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Settings page error:', error);
  }, [error]);

  return (
    <div className="container mx-auto py-6">
      <Card className="max-w-lg mx-auto">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <AlertCircle className="h-6 w-6 text-red-600" />
          </div>
          <CardTitle>Settings Error</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center text-muted-foreground">
            <p>We encountered an issue loading your settings page.</p>
            <p className="text-sm mt-2">
              This might be because your profile is still being set up.
            </p>
          </div>
          
          <div className="flex flex-col gap-2">
            <Button onClick={reset} className="w-full">
              <RefreshCcw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
            
            <Button variant="outline" asChild className="w-full">
              <Link href="/dashboard">
                <Home className="mr-2 h-4 w-4" />
                Go to Dashboard
              </Link>
            </Button>
          </div>
          
          {error.message && (
            <details className="mt-4">
              <summary className="text-sm cursor-pointer text-muted-foreground">
                Technical Details
              </summary>
              <p className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded">
                {error.message}
              </p>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 