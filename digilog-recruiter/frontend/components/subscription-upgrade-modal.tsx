"use client";

import { useState } from 'react';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createUpgradeRequest } from '@/services/subscriptionService';
import { useToast } from '@/components/ui/use-toast';
import { PLAN_FEATURES } from '@/utils/constants';
import { Loader2 } from 'lucide-react';

interface SubscriptionUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  requestType: 'user' | 'organization';
  organizationId?: string;
  currentPlan: string;
  targetPlan: string;
}

export function SubscriptionUpgradeModal({
  isOpen,
  onClose,
  requestType,
  organizationId,
  currentPlan,
  targetPlan,
}: SubscriptionUpgradeModalProps) {
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useToast();

  const currentPlanInfo = PLAN_FEATURES[currentPlan] || PLAN_FEATURES.personal;
  const targetPlanInfo = PLAN_FEATURES[targetPlan] || PLAN_FEATURES['business-owner'];

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError('');
    
    try {
      const result = await createUpgradeRequest({
        requestType,
        organizationId,
        requestedPlan: targetPlan,
        notes
      });
      
      if (result.success) {
        toast({
          title: 'Upgrade request submitted',
          description: 'Your upgrade request has been submitted to the admins for approval.',
          duration: 5000,
        });
        onClose();
      } else {
        setError(result.message || 'Failed to submit upgrade request');
      }
    } catch (err) {
      setError('An error occurred while submitting your request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request Plan Upgrade</DialogTitle>
          <DialogDescription>
            Upgrade from <strong>{currentPlanInfo?.name || currentPlan}</strong> to <strong>{targetPlanInfo?.name || targetPlan}</strong> plan
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">New Plan Features</h3>
            <ul className="text-sm space-y-1">
              {(targetPlanInfo?.features || []).map((feature, index) => (
                <li key={index} className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary"></div>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <label htmlFor="request-notes" className="text-sm font-medium">
              Additional Information (Optional)
            </label>
            <Textarea
              id="request-notes"
              placeholder="Add any specific requirements or questions about the upgrade..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          
          <div className="text-sm text-muted-foreground">
            After submitting, an admin will review your request and you'll be notified of any updates.
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              'Submit Request'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
