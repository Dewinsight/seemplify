"use client";

import { useState } from 'react';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/services/apiConfig";
import { useToast } from "@/components/ui/use-toast";

interface Plan {
  _id: string;
  name: string;
  code: string;
  price: number;
  currency: string;
  billingCycle: string;
  isDefault?: boolean;
}

interface PlanDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: Plan;
  onSuccess: () => void;
}

export default function PlanDeleteModal({ isOpen, onClose, plan, onSuccess }: PlanDeleteModalProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleDelete = async () => {
    if (plan.isDefault) {
      toast({
        title: "Cannot Delete Default Plan",
        description: "The default plan cannot be deleted.",
        variant: "destructive"
      });
      onClose();
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      if (!token) {
        throw new Error("Authentication required");
      }

      const response = await apiRequest(`/api/plans/${plan._id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth-token': token
        }
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || "Failed to delete plan");
      }

      toast({
        title: "Plan Deleted",
        description: `${plan.name} has been deleted successfully`
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            Delete Subscription Plan
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete the <span className="font-semibold">{plan.name}</span> plan?
            <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-md">
              <div className="flex justify-between mb-1">
                <span className="font-medium">Plan:</span>
                <span>{plan.name}</span>
              </div>
              <div className="flex justify-between mb-1">
                <span className="font-medium">Code:</span>
                <span>{plan.code}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium">Price:</span>
                <span>
                  {plan.currency} {plan.price} / {plan.billingCycle}
                </span>
              </div>
            </div>

            <div className="mt-4 flex items-center bg-amber-100 dark:bg-amber-900 p-3 rounded-md">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mr-2" />
              <p className="text-amber-800 dark:text-amber-200 text-sm">
                This action cannot be undone. Organizations using this plan will need to be reassigned.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction 
            onClick={handleDelete} 
            disabled={loading || plan.isDefault}
            className="bg-red-600 hover:bg-red-700"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loading ? "Deleting..." : "Delete Plan"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
