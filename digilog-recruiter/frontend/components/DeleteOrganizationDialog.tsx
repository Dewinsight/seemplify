'use client';

import React, { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertTriangle, Trash2 } from 'lucide-react';

interface DeleteOrganizationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  organizationName: string;
  organizationId: string;
  memberCount?: number;
  isDeleting?: boolean;
}

const DeleteOrganizationDialog: React.FC<DeleteOrganizationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  organizationName,
  organizationId,
  memberCount = 0,
  isDeleting = false
}) => {
  const [confirmationText, setConfirmationText] = useState('');
  const [isConfirmed, setIsConfirmed] = useState(false);

  const expectedText = `DELETE ${organizationName}`;
  
  React.useEffect(() => {
    const matches = confirmationText === expectedText;
    setIsConfirmed(matches);
  }, [confirmationText, expectedText]);

  const handleClose = () => {
    if (!isDeleting) {
      setConfirmationText('');
      setIsConfirmed(false);
      onClose();
    }
  };

  const handleConfirm = async () => {
    if (isConfirmed && !isDeleting) {
      await onConfirm();
      handleClose();
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={handleClose}>
      <AlertDialogContent className="sm:max-w-[500px] z-[100] fixed-modal">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="w-5 h-5" />
            Delete Organization
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <div>
              You are about to permanently delete <strong>{organizationName}</strong>.
            </div>
            
            <Alert className="border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800">
                <strong>This action cannot be undone.</strong> This will permanently delete:
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>All jobs and job postings</li>
                  <li>All candidates and their data</li>
                  <li>All interviews and recordings</li>
                  <li>All chat sessions and AI conversations</li>
                  <li>All user sessions and activity logs</li>
                  {memberCount > 1 && (
                    <li>Remove access for all {memberCount} team members</li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="confirmation" className="text-sm font-medium">
                To confirm deletion, type <code className="bg-gray-100 px-1 rounded text-red-600 font-mono">{expectedText}</code>
              </Label>
              <Input
                id="confirmation"
                placeholder={`Type "${expectedText}" to confirm`}
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value)}
                disabled={isDeleting}
                className={isConfirmed ? 'border-red-500' : ''}
              />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        <AlertDialogFooter>
          <AlertDialogCancel 
            onClick={handleClose}
            disabled={isDeleting}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!isConfirmed || isDeleting}
            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Organization
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteOrganizationDialog;