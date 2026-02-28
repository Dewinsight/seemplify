"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, AlertCircle } from 'lucide-react';

interface PurchaseResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'success' | 'error';
  title: string;
  description: string;
  packName?: string;
}

export function PurchaseResultModal({
  isOpen,
  onClose,
  type,
  title,
  description,
  packName,
}: PurchaseResultModalProps) {
  const isSuccess = type === 'success';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex flex-col items-center text-center space-y-4">
            {/* Icon */}
            <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
              isSuccess 
                ? 'bg-green-100 dark:bg-green-900/30' 
                : 'bg-red-100 dark:bg-red-900/30'
            }`}>
              {isSuccess ? (
                <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
              ) : (
                <AlertCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
              )}
            </div>

            {/* Title */}
            <DialogTitle className={`text-xl ${
              isSuccess 
                ? 'text-green-900 dark:text-green-100' 
                : 'text-red-900 dark:text-red-100'
            }`}>
              {title}
            </DialogTitle>

            {/* Description */}
            <DialogDescription className="text-base text-gray-700 dark:text-gray-300">
              {description}
            </DialogDescription>

            {/* Pack Name Badge (if provided) */}
            {packName && (
              <div className="px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {packName}
                </p>
              </div>
            )}
          </div>
        </DialogHeader>

        <DialogFooter className="flex-col sm:flex-col space-y-2">
          <Button 
            onClick={onClose} 
            className={`w-full ${
              isSuccess
                ? 'bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700'
                : 'bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700'
            }`}
          >
            {isSuccess ? 'Got it!' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

