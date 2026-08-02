'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { setInactivityWarningHandler, getTimeUntilLogout } from '@/services/apiConfig';
import { useAuth } from '@/context/AuthContext';

export function InactivityWarning() {
  const [isOpen, setIsOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const { isAuthenticated, logout } = useAuth();
  const pathname = usePathname();
  
  // Check if we're on an admin route (SSR-safe)
  const isAdminRoute = pathname?.startsWith('/admin') || false;

  useEffect(() => {
    if (!isAuthenticated || isAdminRoute) return;

    // Set up the warning handler
    setInactivityWarningHandler((warningTimeLeft: number) => {
      setTimeLeft(warningTimeLeft);
      setIsOpen(true);
    });

    // Update countdown every second when dialog is open
    let interval: NodeJS.Timeout;
    if (isOpen && timeLeft > 0) {
      interval = setInterval(() => {
        const currentTimeLeft = getTimeUntilLogout();
        if (currentTimeLeft <= 0) {
          setIsOpen(false);
          // User will be logged out automatically by the inactivity timer
        } else {
          setTimeLeft(currentTimeLeft);
        }
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAuthenticated, isOpen, timeLeft, isAdminRoute]);

  const handleStayLoggedIn = () => {
    setIsOpen(false);
    // Activity tracking will automatically reset the timer when user interacts
    // We can also manually trigger activity by dispatching an event
    if (typeof window !== 'undefined') {
      document.dispatchEvent(new Event('mousedown'));
    }
  };

  const handleLogoutNow = () => {
    setIsOpen(false);
    logout();
  };

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  if (!isAuthenticated) return null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-2xl">⚠️</span>
            Session Timeout Warning
          </DialogTitle>
          <DialogDescription>
            You will be automatically logged out due to inactivity.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex flex-col items-center space-y-4 py-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">
              Time remaining:
            </p>
            <p className="text-3xl font-mono font-bold text-destructive">
              {formatTime(timeLeft)}
            </p>
          </div>
          
          <div className="w-full bg-secondary rounded-full h-2">
            <div 
              className="bg-destructive h-2 rounded-full transition-all duration-1000"
              style={{ 
                width: `${Math.max(0, (timeLeft / 300) * 100)}%` // 300 seconds = 5 minutes
              }}
            />
          </div>
          
          <p className="text-sm text-center text-muted-foreground">
            Click "Stay Logged In" to continue your session, or you will be automatically logged out when the timer reaches zero.
          </p>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button 
            variant="outline" 
            onClick={handleLogoutNow}
            className="flex-1"
          >
            Logout Now
          </Button>
          <Button 
            onClick={handleStayLoggedIn}
            className="flex-1"
          >
            Stay Logged In
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
} 