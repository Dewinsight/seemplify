'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Crown, Shield, Loader2 } from 'lucide-react';

interface Member {
  _id: string;
  user: {
    _id: string;
    email: string;
    profile: {
      firstName?: string;
      lastName?: string;
      displayName?: string;
    };
  };
  role: string;
  status: string;
}

interface TransferOwnershipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: Member[];
  currentOwnerId: string;
  organizationName: string;
  onTransfer: (newOwnerId: string) => Promise<void>;
}

export function TransferOwnershipDialog({
  open,
  onOpenChange,
  members,
  currentOwnerId,
  organizationName,
  onTransfer,
}: TransferOwnershipDialogProps) {
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [confirmationText, setConfirmationText] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get eligible members (exclude current owner)
  const eligibleMembers = members.filter(
    (m) => m.user?._id && m.user._id !== currentOwnerId && m.status === 'active'
  );

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setSelectedMemberId('');
      setConfirmationText('');
      setError(null);
    }
  }, [open]);

  const getMemberDisplayName = (member: Member) => {
    const user = member.user;
    if (user.profile?.displayName) return user.profile.displayName;
    if (user.profile?.firstName && user.profile?.lastName) {
      return `${user.profile.firstName} ${user.profile.lastName}`;
    }
    if (user.profile?.firstName) return user.profile.firstName;
    return user.email;
  };

  const selectedMember = eligibleMembers.find((m) => m.user._id === selectedMemberId);
  const isConfirmationValid = confirmationText === 'TRANSFER';
  const canTransfer = selectedMemberId && isConfirmationValid && !isTransferring;

  const handleTransfer = async () => {
    if (!canTransfer) return;

    setError(null);
    setIsTransferring(true);

    try {
      await onTransfer(selectedMemberId);
      onOpenChange(false);
    } catch (err: any) {
      console.error('Transfer ownership error:', err);
      setError(err.message || 'Failed to transfer ownership');
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-yellow-500" />
            Transfer Organization Ownership
          </DialogTitle>
          <DialogDescription>
            Transfer full ownership of &quot;{organizationName}&quot; to another member
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Warning Alert */}
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Warning:</strong> This action cannot be undone. You will lose owner privileges and become an Administrator.
            </AlertDescription>
          </Alert>

          {/* Member Selection */}
          <div className="space-y-2">
            <Label htmlFor="new-owner">Select New Owner</Label>
            <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
              <SelectTrigger id="new-owner">
                <SelectValue placeholder="Choose a member..." />
              </SelectTrigger>
              <SelectContent>
                {eligibleMembers.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground">
                    No eligible members found
                  </div>
                ) : (
                  eligibleMembers.map((member) => (
                    <SelectItem key={member.user._id} value={member.user._id}>
                      <div className="flex items-center gap-2">
                        <span>{getMemberDisplayName(member)}</span>
                        <span className="text-xs text-muted-foreground">
                          ({member.role})
                        </span>
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Consequences */}
          {selectedMember && (
            <div className="space-y-2 rounded-lg border bg-muted/50 p-4">
              <p className="text-sm font-medium">What will happen:</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <Shield className="mt-0.5 h-4 w-4 text-blue-500 flex-shrink-0" />
                  <span>
                    You will become an <strong>Administrator</strong> with reduced privileges
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Crown className="mt-0.5 h-4 w-4 text-yellow-500 flex-shrink-0" />
                  <span>
                    <strong>{getMemberDisplayName(selectedMember)}</strong> will become the <strong>Owner</strong> with full control
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-orange-500 flex-shrink-0" />
                  <span>
                    You will no longer be able to transfer ownership or delete the organization
                  </span>
                </li>
              </ul>
            </div>
          )}

          {/* Confirmation Input */}
          {selectedMember && (
            <div className="space-y-2">
              <Label htmlFor="confirmation">
                Type <strong>TRANSFER</strong> to confirm
              </Label>
              <Input
                id="confirmation"
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value.toUpperCase())}
                placeholder="Type TRANSFER"
                className="font-mono"
              />
            </div>
          )}

          {/* Error Message */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isTransferring}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleTransfer}
            disabled={!canTransfer}
          >
            {isTransferring ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Transferring...
              </>
            ) : (
              <>
                <Crown className="mr-2 h-4 w-4" />
                Transfer Ownership
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

