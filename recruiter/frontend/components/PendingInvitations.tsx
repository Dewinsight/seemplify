'use client';

import React, { useState, useEffect } from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import { PendingInvitation } from '@/services/organizationService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trash2, Calendar, User, Mail, Clock, X } from 'lucide-react';
import { toast } from 'sonner';
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle, 
  AlertDialogTrigger 
} from '@/components/ui/alert-dialog';

interface PendingInvitationsProps {
  className?: string;
}

const PendingInvitations: React.FC<PendingInvitationsProps> = ({ className = "" }) => {
  const { getPendingInvitations, cancelInvitation } = useOrganization();
  const [pendingInvites, setPendingInvites] = useState<PendingInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cancellingInvite, setCancellingInvite] = useState<string | null>(null);
  const idpUrl = process.env.NEXT_PUBLIC_IDP_URL || '';

  const loadPendingInvitations = async () => {
    try {
      setIsLoading(true);
      const result = await getPendingInvitations();
      setPendingInvites(result.pendingInvites);
    } catch (error: any) {
      toast.error(error.message || 'Failed to load pending invitations');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelInvitation = async (inviteId: string, email: string) => {
    try {
      setCancellingInvite(inviteId);
      await cancelInvitation(inviteId);
      toast.success(`Invitation to ${email} cancelled successfully`);
      // Reload the list
      await loadPendingInvitations();
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel invitation');
    } finally {
      setCancellingInvite(null);
    }
  };

  const formatDate = (dateString: string | Date) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getRoleDisplayName = (role: string) => {
    const roleNames: Record<string, string> = {
      admin: 'Administrator',
      hr_manager: 'HR Manager',
      recruiter: 'Recruiter',
      interviewer: 'Interviewer'
    };
    return roleNames[role] || role;
  };

  const getRoleBadgeColor = (role: string) => {
    const roleColors: Record<string, string> = {
      admin: 'bg-red-100 text-red-800',
      hr_manager: 'bg-blue-100 text-blue-800',
      recruiter: 'bg-green-100 text-green-800',
      interviewer: 'bg-yellow-100 text-yellow-800'
    };
    return roleColors[role] || 'bg-gray-100 text-gray-800';
  };

  useEffect(() => {
    loadPendingInvitations();
  }, []);

  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="text-center py-8">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading pending invitations...</p>
        </div>
      </div>
    );
  }

  if (pendingInvites.length === 0) {
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="text-center py-8">
          <Mail className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Pending Invitations</h3>
          <p className="text-gray-500">All invitations have been accepted or expired.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Pending Invitations</h3>
          <p className="text-sm text-gray-500">
            {pendingInvites.length} invitation{pendingInvites.length !== 1 ? 's' : ''} waiting for response
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={loadPendingInvitations}
          disabled={isLoading}
        >
          Refresh
        </Button>
      </div>

      <div className="grid gap-4">
        {pendingInvites.map((invite) => (
          <Card key={invite._id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                      <User className="w-4 h-4 text-gray-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{invite.email}</p>
                      <Badge className={`text-xs ${getRoleBadgeColor(invite.role)}`}>
                        {getRoleDisplayName(invite.role)}
                      </Badge>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-4 text-sm text-gray-500 mb-2">
                    <div className="flex items-center space-x-1">
                      <User className="w-3 h-3" />
                      <span>
                        Invited by {invite.invitedBy?.profile?.firstName} {invite.invitedBy?.profile?.lastName}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Calendar className="w-3 h-3" />
                      <span>{formatDate(invite.createdAt)}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-1 text-sm text-amber-600">
                    <Clock className="w-3 h-3" />
                    <span>Expires: {formatDate(invite.expiresAt)}</span>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={cancellingInvite === invite._id}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        {cancellingInvite === invite._id ? (
                          <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <X className="w-4 h-4" />
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="z-[100] fixed-modal">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel Invitation</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to cancel the invitation to{' '}
                          <span className="font-medium">{invite.email}</span>?
                          This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep Invitation</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleCancelInvitation(invite._id, invite.email)}
                          className="bg-red-600 hover:bg-red-700"
                        >
                          Cancel Invitation
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default PendingInvitations; 
