'use client';

import React, { useEffect, useState } from 'react';
import { AlertCircle, Info, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface GrantRotationInfo {
  autoRemovalPerformed: boolean;
  removedGrant?: {
    email: string;
    userName: string;
    ageInDays: number;
  };
  message: string;
}

export function GrantRotationNotification() {
  const [rotationInfo, setRotationInfo] = useState<GrantRotationInfo | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Listen for grant rotation events from OAuth callback
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'grant_rotation' && event.data.rotationInfo) {
        setRotationInfo(event.data.rotationInfo);
        setShow(true);
        
        // Auto-hide after 10 seconds
        setTimeout(() => setShow(false), 10000);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  if (!show || !rotationInfo || !rotationInfo.autoRemovalPerformed) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 max-w-md z-50 animate-in slide-in-from-top-2 duration-300">
      <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
        <AlertCircle className="h-4 w-4 text-amber-600" />
        <AlertTitle className="text-amber-900 dark:text-amber-200">
          Calendar Slot Auto-Rotation
        </AlertTitle>
        <AlertDescription className="text-amber-800 dark:text-amber-300">
          <p className="mb-2">
            Your organization reached its 5-calendar limit. To connect your calendar, we automatically removed the oldest connection.
          </p>
          {rotationInfo.removedGrant && (
            <div className="mt-2 p-2 bg-amber-100 dark:bg-amber-900/30 rounded text-sm">
              <p className="font-medium">Removed:</p>
              <p>{rotationInfo.removedGrant.userName} ({rotationInfo.removedGrant.email})</p>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Connected {rotationInfo.removedGrant.ageInDays} days ago
              </p>
            </div>
          )}
        </AlertDescription>
        <button
          onClick={() => setShow(false)}
          className="absolute top-2 right-2 text-amber-600 hover:text-amber-800"
        >
          <X className="h-4 w-4" />
        </button>
      </Alert>
    </div>
  );
}

// Usage in OAuth callback success handler:
// if (slotResult.autoRemovalPerformed) {
//   window.postMessage({
//     type: 'grant_rotation',
//     rotationInfo: slotResult
//   }, '*');
// }
