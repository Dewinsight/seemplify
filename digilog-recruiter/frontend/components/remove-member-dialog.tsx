"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/components/ui/use-toast"
import { useOrganization } from "@/context/OrganizationContext"

interface RemoveMemberDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: {
    user: {
      _id: string
      profile?: {
        firstName?: string
        lastName?: string
        displayName?: string
      }
      email: string
    }
  } | null
  onRemove: () => void
}

export function RemoveMemberDialog({ open, onOpenChange, member, onRemove }: RemoveMemberDialogProps) {
  const { toast } = useToast()

  const handleRemove = async () => {
    if (!member) return;
    await onRemove();
  };

  if (!member || !member.user) return null

  // Safely get the member's display name
  const getMemberDisplayName = () => {
    const user = member.user;
    const profile = user.profile;
    
    if (profile?.firstName && profile?.lastName) {
      return `${profile.firstName} ${profile.lastName}`;
    }
    
    if (profile?.displayName) {
      return profile.displayName;
    }
    
    if (profile?.firstName) {
      return profile.firstName;
    }
    
    if (profile?.lastName) {
      return profile.lastName;
    }
    
    if (user.email) {
      return user.email.split('@')[0];
    }
    
    return 'this user';
  };

  const displayName = getMemberDisplayName();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-xl overflow-hidden p-0 z-[100] fixed-modal">
        <AlertDialogHeader className="bg-red-50 dark:bg-red-900/20 p-6">
          <AlertDialogTitle className="text-lg md:text-xl">Remove Team Member</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to remove {displayName} from the team? They will lose access to all resources and data.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex flex-col sm:flex-row gap-2 p-6">
          <AlertDialogCancel className="rounded-full mt-0">Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleRemove} className="bg-red-600 hover:bg-red-700 rounded-full">
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
