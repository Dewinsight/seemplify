'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { 
  Mail, 
  Building2, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  User,
  Shield,
  UserCheck,
  Eye,
  Crown
} from 'lucide-react';
import organizationService from '@/services/organizationService';
import { useOrganization } from '@/context/OrganizationContext';

interface PendingInvite {
  _id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  expiresAt: string | Date;
  createdAt: string | Date;
  organization: {
    _id: string;
    name: string;
    description?: string;
    industry?: string;
  };
  invitedBy: {
    _id: string;
    profile: {
      firstName?: string;
      lastName?: string;
    };
    email: string;
  };
}

const InvitationsPage = () => {
  const { loadOrganizations } = useOrganization();
  const idpUrl = process.env.NEXT_PUBLIC_IDP_URL || '';
  const [invitations, setInvitations] = useState<PendingInvite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingInvites, setProcessingInvites] = useState<Set<string>>(new Set());

  const loadInvitations = async () => {
    try {
      setIsLoading(true);
      const response = await organizationService.getUserPendingInvitations();
      setInvitations(response.pendingInvites || []);
    } catch (error: any) {
      console.error('Failed to load invitations:', error);
      toast.error('Failed to load invitations');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInvitations();
  }, []);

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner': return <Crown className="w-4 h-4 text-purple-600" />;
      case 'admin': return <Shield className="w-4 h-4 text-blue-600" />;
      case 'hr_manager': return <UserCheck className="w-4 h-4 text-green-600" />;
      case 'recruiter': return <User className="w-4 h-4 text-orange-600" />;
      case 'interviewer': return <Eye className="w-4 h-4 text-gray-600" />;
      default: return <User className="w-4 h-4 text-gray-600" />;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'owner': return 'bg-purple-100 text-purple-800';
      case 'admin': return 'bg-blue-100 text-blue-800';
      case 'hr_manager': return 'bg-green-100 text-green-800';
      case 'recruiter': return 'bg-orange-100 text-orange-800';
      case 'interviewer': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'owner': return 'Owner';
      case 'admin': return 'Admin';
      case 'hr_manager': return 'HR Manager';
      case 'recruiter': return 'Recruiter';
      case 'interviewer': return 'Interviewer';
      default: return role;
    }
  };

  const formatDate = (dateString: string | Date) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getExpiresIn = (expiresAt: string | Date) => {
    const expires = new Date(expiresAt);
    const now = new Date();
    const diff = expires.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    
    if (days <= 0) return 'Expired';
    if (days === 1) return '1 day left';
    return `${days} days left`;
  };

  const handleAcceptInvite = async (invite: PendingInvite) => {
    try {
      setProcessingInvites(prev => new Set(prev).add(invite._id));
      
      await organizationService.acceptInvite(invite.token);
      
      toast.success(`Successfully joined ${invite.organization.name}!`);
      
      // Remove the accepted invitation from the list
      setInvitations(prev => prev.filter(inv => inv._id !== invite._id));
      
      // Refresh organization context to load the new organization  
      console.log('🔄 Refreshing organization context after invitation acceptance');
      await loadOrganizations();
      
      // Navigate to dashboard immediately - the new organization should be loaded
      console.log('🚀 Navigating to dashboard with new organization');
      window.location.href = '/dashboard';
    } catch (error: any) {
      console.error('Failed to accept invitation:', error);
      toast.error(error.message || 'Failed to accept invitation');
    } finally {
      setProcessingInvites(prev => {
        const newSet = new Set(prev);
        newSet.delete(invite._id);
        return newSet;
      });
    }
  };

  const handleRejectInvite = async (invite: PendingInvite) => {
    try {
      setProcessingInvites(prev => new Set(prev).add(invite._id));
      
      // For now, just remove from list - we could add a reject endpoint later
      setInvitations(prev => prev.filter(inv => inv._id !== invite._id));
      
      toast.success('Invitation declined');
    } catch (error: any) {
      console.error('Failed to reject invitation:', error);
      toast.error('Failed to decline invitation');
    } finally {
      setProcessingInvites(prev => {
        const newSet = new Set(prev);
        newSet.delete(invite._id);
        return newSet;
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-xl font-semibold md:text-2xl">Organization Invitations</h3>
          <p className="text-sm text-muted-foreground">View and manage organization invitations sent to you.</p>
        </div>
        <Separator />
        <div className="space-y-4">
          {[...Array(2)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="animate-pulse space-y-4">
                  <div className="w-1/3 h-4 bg-gray-200 rounded" />
                  <div className="w-1/2 h-3 bg-gray-200 rounded" />
                  <div className="w-1/4 h-6 bg-gray-200 rounded" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold md:text-2xl">Organization Invitations</h3>
        <p className="text-sm text-muted-foreground">
          View and manage organization invitations sent to you.
        </p>
        {idpUrl && (
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`${idpUrl.replace(/\/$/, '')}/organizations`, '_blank')}
            >
              Manage in Identity Provider
            </Button>
          </div>
        )}
      </div>
      <Separator />

            {invitations.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Mail className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No pending invitations</h3>
              <p className="text-gray-500">
                You don't have any pending organization invitations at the moment.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {invitations.map((invite) => (
            <Card key={invite._id}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-4">
                    <Avatar className="w-12 h-12">
                      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white">
                        <Building2 className="w-6 h-6" />
                      </AvatarFallback>
                    </Avatar>
                    
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        <h4 className="text-lg font-semibold text-gray-900">
                          {invite.organization.name}
                        </h4>
                        <Badge 
                          variant="secondary" 
                          className={`flex items-center space-x-1 ${getRoleColor(invite.role)}`}
                        >
                          {getRoleIcon(invite.role)}
                          <span>{getRoleLabel(invite.role)}</span>
                        </Badge>
                      </div>
                      
                      {invite.organization.description && (
                        <p className="text-gray-600 mb-2">{invite.organization.description}</p>
                      )}
                      
                      <div className="flex items-center text-sm text-gray-500 space-x-4">
                        <span className="flex items-center space-x-1">
                          <User className="w-4 h-4" />
                          <span>
                            Invited by {invite.invitedBy.profile.firstName || invite.invitedBy.email}
                          </span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <Clock className="w-4 h-4" />
                          <span>{getExpiresIn(invite.expiresAt)}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2 ml-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRejectInvite(invite)}
                      disabled={processingInvites.has(invite._id)}
                      className="text-red-600 border-red-300 hover:bg-red-50"
                    >
                      <XCircle className="w-4 h-4 mr-1" />
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleAcceptInvite(invite)}
                      disabled={processingInvites.has(invite._id)}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1" />
                      Accept
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default InvitationsPage;
