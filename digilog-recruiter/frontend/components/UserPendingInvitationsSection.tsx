'use client';

import React, { useState, useEffect } from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import { UserPendingInvitation } from '@/services/organizationService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { Building2, Calendar, User, Mail, Clock, Check, X, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const UserPendingInvitationsSection: React.FC = () => {
  const { getUserPendingInvitations, acceptInvite } = useOrganization();
  const [pendingInvites, setPendingInvites] = useState<UserPendingInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [acceptingInvite, setAcceptingInvite] = useState<string | null>(null);

  const loadPendingInvitations = async () => {
    try {
      setIsLoading(true);
      const result = await getUserPendingInvitations();
      setPendingInvites(result.pendingInvites);
    } catch (error: any) {
      toast.error(error.message || 'Failed to load pending invitations');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAcceptInvite = async (invite: UserPendingInvitation) => {
    try {
      setAcceptingInvite(invite._id);
      await acceptInvite(invite.token);
      toast.success(`Successfully joined ${invite.organization.name}!`);
      // Reload the list after accepting
      await loadPendingInvitations();
    } catch (error: any) {
      toast.error(error.message || 'Failed to accept invitation');
    } finally {
      setAcceptingInvite(null);
    }
  };

  const formatDate = (dateString: string) => {
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
      <div className="space-y-4">
        <div className="text-center py-8">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading pending invitations...</p>
        </div>
      </div>
    );
  }

  if (pendingInvites.length === 0) {
    return (
      <div className="text-center py-8">
        <Mail className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No Pending Invitations</h3>
        <p className="text-gray-500 mb-4">You don't have any pending organization invitations.</p>
        <Button 
          variant="outline" 
          onClick={loadPendingInvitations}
          disabled={isLoading}
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">
            You have {pendingInvites.length} pending invitation{pendingInvites.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={loadPendingInvitations}
          disabled={isLoading}
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4">
        {pendingInvites.map((invite) => (
          <Card key={invite._id} className="hover:shadow-md transition-shadow border-l-4 border-l-blue-500">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 text-lg">{invite.organization.name}</h4>
                      <Badge className={`text-xs ${getRoleBadgeColor(invite.role)}`}>
                        {getRoleDisplayName(invite.role)}
                      </Badge>
                    </div>
                  </div>
                  
                  {invite.organization.description && (
                    <p className="text-sm text-gray-600 mb-3">{invite.organization.description}</p>
                  )}
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-500">
                    <div className="flex items-center space-x-2">
                      <User className="w-4 h-4" />
                      <span>
                        Invited by {invite.invitedBy?.profile?.firstName} {invite.invitedBy?.profile?.lastName}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Calendar className="w-4 h-4" />
                      <span>Sent {formatDate(invite.createdAt)}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Clock className="w-4 h-4" />
                      <span>Expires {formatDate(invite.expiresAt)}</span>
                    </div>
                    {invite.organization.industry && (
                      <div className="flex items-center space-x-2">
                        <Building2 className="w-4 h-4" />
                        <span>{invite.organization.industry}</span>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center space-x-2 ml-4">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        disabled={acceptingInvite === invite._id}
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {acceptingInvite === invite._id ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <>
                            <Check className="w-4 h-4 mr-1" />
                            Accept
                          </>
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Join Organization</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to join{' '}
                          <span className="font-medium">{invite.organization.name}</span>{' '}
                          as a {getRoleDisplayName(invite.role)}?
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleAcceptInvite(invite)}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          Join Organization
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

export default UserPendingInvitationsSection; 