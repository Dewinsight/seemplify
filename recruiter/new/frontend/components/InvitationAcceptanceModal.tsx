'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useOrganization } from '@/context/OrganizationContext';
import { toast } from 'sonner';
import { 
  Building2, 
  Loader2, 
  Mail, 
  Users, 
  Check, 
  X,
  Clock,
  UserCheck,
  Shield,
  Crown,
  Eye
} from 'lucide-react';

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

interface InvitationAcceptanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invitation: PendingInvite;
  onAccept?: () => void;
  onReject?: () => void;
}

const InvitationAcceptanceModal: React.FC<InvitationAcceptanceModalProps> = ({ 
  isOpen, 
  onClose, 
  invitation,
  onAccept,
  onReject
}) => {
  const { acceptInvite } = useOrganization();
  const [isAccepting, setIsAccepting] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner': return <Crown className="w-4 h-4 text-purple-600" />;
      case 'admin': return <Shield className="w-4 h-4 text-blue-600" />;
      case 'hr_manager': return <UserCheck className="w-4 h-4 text-green-600" />;
      case 'recruiter': return <Users className="w-4 h-4 text-orange-600" />;
      case 'interviewer': return <Eye className="w-4 h-4 text-gray-600" />;
      default: return <Users className="w-4 h-4 text-gray-600" />;
    }
  };

  const getRoleDisplayName = (role: string) => {
    const roleNames: Record<string, string> = {
      owner: 'Owner',
      admin: 'Administrator',
      hr_manager: 'HR Manager',
      recruiter: 'Recruiter',
      interviewer: 'Interviewer'
    };
    return roleNames[role] || role;
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

  const getInviterName = () => {
    const profile = invitation.invitedBy.profile;
    if (profile?.firstName || profile?.lastName) {
      return `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
    }
    return invitation.invitedBy.email;
  };

  const handleAccept = async () => {
    try {
      setIsAccepting(true);
      await acceptInvite(invitation.token);
      toast.success(`Successfully joined ${invitation.organization.name}!`);
      onAccept?.();
      onClose();
      
      // Navigate to dashboard
      setTimeout(() => {
        window.location.href = '/dashboard';
      }, 1000);
    } catch (error: any) {
      console.error('Failed to accept invitation:', error);
      toast.error(error.message || 'Failed to accept invitation');
    } finally {
      setIsAccepting(false);
    }
  };

  const handleReject = async () => {
    try {
      setIsRejecting(true);
      // For now, just close the modal - could add reject endpoint later
      toast.success('Invitation declined');
      onReject?.();
      onClose();
    } catch (error: any) {
      console.error('Failed to reject invitation:', error);
      toast.error('Failed to decline invitation');
    } finally {
      setIsRejecting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center space-x-2">
            <Mail className="w-6 h-6 text-blue-600" />
            <DialogTitle className="text-xl">
              Organization Invitation
            </DialogTitle>
          </div>
          <DialogDescription>
            You've been invited to join an organization
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start gap-4">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="bg-blue-100 text-blue-600 text-lg font-semibold">
                    {invitation.organization.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <CardTitle className="text-lg">{invitation.organization.name}</CardTitle>
                  {invitation.organization.description && (
                    <CardDescription className="mt-1">
                      {invitation.organization.description}
                    </CardDescription>
                  )}
                  {invitation.organization.industry && (
                    <Badge variant="secondary" className="mt-2">
                      {invitation.organization.industry}
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2 border-t">
                  <span className="text-sm text-muted-foreground">Role</span>
                  <div className="flex items-center gap-2">
                    {getRoleIcon(invitation.role)}
                    <span className="font-medium">{getRoleDisplayName(invitation.role)}</span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between py-2 border-t">
                  <span className="text-sm text-muted-foreground">Invited by</span>
                  <span className="font-medium">{getInviterName()}</span>
                </div>
                
                <div className="flex items-center justify-between py-2 border-t">
                  <span className="text-sm text-muted-foreground">Invited on</span>
                  <span className="text-sm">{formatDate(invitation.createdAt)}</span>
                </div>
                
                <div className="flex items-center justify-between py-2 border-t">
                  <span className="text-sm text-muted-foreground">Expires</span>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-orange-500" />
                    <span className="text-sm text-orange-600 font-medium">
                      {getExpiresIn(invitation.expiresAt)}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={handleReject}
            disabled={isAccepting || isRejecting}
            className="flex-1"
          >
            {isRejecting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Declining...
              </>
            ) : (
              <>
                <X className="w-4 h-4 mr-2" />
                Decline
              </>
            )}
          </Button>
          <Button
            onClick={handleAccept}
            disabled={isAccepting || isRejecting}
            className="flex-1"
          >
            {isAccepting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Accepting...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Accept & Join
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default InvitationAcceptanceModal;
