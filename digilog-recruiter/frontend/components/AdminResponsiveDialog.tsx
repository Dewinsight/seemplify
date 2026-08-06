"use client";

import { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface AdminResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  fullScreenOnMobile?: boolean;
  className?: string;
  contentClassName?: string;
  closeButton?: boolean;
}

export default function AdminResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  fullScreenOnMobile = true,
  className,
  contentClassName,
  closeButton = true,
}: AdminResponsiveDialogProps) {
  
  // Define max width for each size
  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    full: 'max-w-[95vw]'
  };

  // Apply mobile full screen styling when needed
  const mobileFullScreenClasses = fullScreenOnMobile ? 
    'sm:rounded-lg sm:max-h-[90vh] sm:h-auto sm:w-auto rounded-none max-h-screen h-screen w-screen' : 
    'rounded-lg max-h-[90vh]';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className={cn(
          "bg-gray-800 border-gray-700 text-white p-0",
          mobileFullScreenClasses,
          sizeClasses[size],
          className
        )}
      >
        <DialogHeader className="p-4 sm:p-6 border-b border-gray-700">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-lg sm:text-xl text-white">{title}</DialogTitle>
              {description && (
                <DialogDescription className="text-gray-400 mt-1">
                  {description}
                </DialogDescription>
              )}
            </div>
            {closeButton && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-gray-400 hover:text-white hover:bg-gray-700 rounded-full"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </DialogHeader>
        
        <div className={cn(
          "overflow-y-auto p-4 sm:p-6",
          contentClassName
        )}>
          {children}
        </div>
        
        {footer && (
          <DialogFooter className="p-4 sm:p-6 border-t border-gray-700 bg-gray-800/50 flex flex-col sm:flex-row gap-2 sm:justify-end">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
