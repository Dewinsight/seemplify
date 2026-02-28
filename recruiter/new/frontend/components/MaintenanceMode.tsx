"use client"

import React, { useEffect, useState } from 'react';
import { maintenanceConfig } from '@/config/maintenance';
import { AlertTriangle } from 'lucide-react';

export default function MaintenanceMode() {
  // Use state to handle hydration properly (avoid server/client mismatch)
  const [isMaintenance, setIsMaintenance] = useState(false);

  useEffect(() => {
    if (maintenanceConfig.enabled) {
      setIsMaintenance(true);
      // Disable scrolling
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  if (!isMaintenance) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="bg-card p-8 rounded-lg shadow-lg max-w-md w-full text-center border border-border">
        <div className="flex justify-center mb-4">
          <AlertTriangle className="h-12 w-12 text-warning" />
        </div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">
          {maintenanceConfig.title}
        </h2>
        <p className="text-muted-foreground">
          {maintenanceConfig.message}
        </p>
      </div>
    </div>
  );
}