'use client';

import Link from 'next/link';
import { ArrowLeft, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PLATFORM_FEATURE_LABELS, type PlatformFeatureKey } from '@/lib/platformFeatures';

export function FeatureUnavailable({ feature }: { feature: PlatformFeatureKey }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
      <div className="border-y border-border py-10 text-center">
        <Ban className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="mt-4 text-2xl font-semibold text-foreground">Feature unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {PLATFORM_FEATURE_LABELS[feature]} has been turned off by a platform administrator.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
