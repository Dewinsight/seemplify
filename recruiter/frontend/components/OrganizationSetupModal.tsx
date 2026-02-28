'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import { UserPendingInvitation } from '@/services/organizationService';
import organizationService from '@/services/organizationService';
import { toast } from 'sonner';
import { Building2, Loader2, LogOut, Mail, Users, Check, X } from 'lucide-react';
import OrganizationForm from './OrganizationForm';
import { getIdpBaseUrl } from '@/utils/env';

interface OrganizationSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'setup' | 'create'; // 'setup' for first org, 'create' for additional orgs
  title?: string;
}

const OrganizationSetupModal: React.FC<OrganizationSetupModalProps> = ({ 
  isOpen, 
  onClose, 
  mode = 'setup',
  title 
}) => {
  const { createOrganization, isLoading: contextLoading, getUserPendingInvitations, acceptInvite, organizationLimits } = useOrganization();
  const { logout, isAuthenticated } = useAuth();
  const idpUrl = getIdpBaseUrl();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    industry: '',
    size: '',
    website: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  // Initialize with empty array for simpler logic
  const [pendingInvites, setPendingInvites] = useState<UserPendingInvitation[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true); // Start with loading true
  const [acceptingInvite, setAcceptingInvite] = useState<string | null>(null);
  const [rejectingInvite, setRejectingInvite] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("create");
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  console.log('🏢 OrganizationSetupModal render - isOpen:', isOpen, 'mode:', mode, 'invites:', pendingInvites.length, 'loading:', loadingInvites);

  const loadPendingInvitations = async () => {
    try {
      setLoadingInvites(true);
      console.log('📧 Loading pending invitations...');
      
      const result = await organizationService.getUserPendingInvitations();
      console.log('📧 Invitations loaded:', result);
      setPendingInvites(result.pendingInvites || []);
      setHasLoadedOnce(true);
      
      // Auto-switch to join tab if invitations found
      if (result.pendingInvites && result.pendingInvites.length > 0) {
        setActiveTab('join');
      }
    } catch (error: any) {
      console.error('📧 Failed to load pending invitations:', error);
      setPendingInvites([]);
      setHasLoadedOnce(true);
    } finally {
      setLoadingInvites(false);
    }
  };

  const handleAcceptInvite = async (invite: UserPendingInvitation) => {
    try {
      setAcceptingInvite(invite._id);
      
      // Use organizationService directly like the settings page
      await organizationService.acceptInvite(invite.token);
      
      toast.success(`Successfully joined ${invite.organization.name}!`);
      
      // Remove the accepted invitation from the list
      setPendingInvites(prev => Array.isArray(prev) ? prev.filter(inv => inv._id !== invite._id) : []);
      
      // Refresh organization context to load the new organization  
      console.log('🔄 Refreshing organization context after invitation acceptance');
      
      // Close modal and reload page to navigate to dashboard
      onClose();
      
      // Reload the page to ensure the user is properly authenticated with the new organization
      console.log('🚀 Reloading page after successful invitation acceptance');
      window.location.reload();
    } catch (error: any) {
      console.error('Failed to accept invitation:', error);
      toast.error(error.message || 'Failed to accept invitation');
    } finally {
      setAcceptingInvite(null);
    }
  };

  const handleRejectInvite = async (invite: UserPendingInvitation) => {
    try {
      setRejectingInvite(invite._id);
      
      // For now, just remove from list - we could add a reject endpoint later
      setPendingInvites(prev => Array.isArray(prev) ? prev.filter(inv => inv._id !== invite._id) : []);
      
      toast.success('Invitation declined');
    } catch (error: any) {
      console.error('Failed to reject invitation:', error);
      toast.error('Failed to decline invitation');
    } finally {
      setRejectingInvite(null);
    }
  };

  // Single effect to load invitations when modal opens
  useEffect(() => {
    if (isOpen && mode === 'setup' && !hasLoadedOnce) {
      console.log('🚀 Modal opened for first time, loading invitations...');
      loadPendingInvitations();
    }
  }, [isOpen, mode, hasLoadedOnce]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('Organization name is required');
      return;
    }

    // Check limits for create mode
    if (mode === 'create' && organizationLimits && !organizationLimits.canCreateMore) {
      toast.error(`You've reached your organization limit (${organizationLimits.currentCount}/${organizationLimits.maxOrganizations}) for the ${organizationLimits.userPlan} plan.`);
      return;
    }

    try {
      setIsLoading(true);
      console.log('📝 Creating organization:', formData);
      await createOrganization(formData);
      toast.success('Organization created successfully!');

      // Reset form for create mode
      if (mode === 'create') {
        setFormData({
          name: '',
          description: '',
          industry: '',
          size: '',
          website: ''
        });
      }

      onClose();
    } catch (error: any) {
      console.error('❌ Failed to create organization:', error);

      // Handle IdP redirect scenarios
      if (error.code === 'idp_managed' || error.code === 'idp_required') {
        toast.info('Redirecting to Identity Provider for organization creation...');
        // Don't show error toast - the redirect is expected behavior
        return;
      }

      toast.error(error.message || 'Failed to create organization');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    console.log('🔐 User requested logout from organization setup');
    logout();
  };

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Prevent closing with ESC key for setup mode only
  const handleOpenChange = (open: boolean) => {
    if (!open && mode === 'setup') {
      console.log('🚫 Preventing modal close - organization setup is required');
    } else if (!open && mode === 'create') {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent 
        className="sm:max-w-[500px] organization-setup-modal"
        onPointerDownOutside={(e) => mode === 'setup' ? e.preventDefault() : undefined}
        onEscapeKeyDown={(e) => mode === 'setup' ? e.preventDefault() : undefined}
      >
        {mode !== 'setup' && (
          <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        )}
        <DialogHeader>
          <div className="flex items-center space-x-2">
            <Building2 className="w-6 h-6 text-blue-600" />
            <DialogTitle className="text-xl">
              {title || (mode === 'create' ? 'Create New Organization' : 'Welcome! Let\'s Set Up Your Organization')}
            </DialogTitle>
          </div>
        </DialogHeader>
        
        <div className="py-2">
          <p className="text-sm text-gray-600">
            {mode === 'create' && organizationLimits
              ? `Create another organization to manage different teams or projects. You can create ${typeof organizationLimits.remainingSlots === 'number' ? organizationLimits.remainingSlots : 0} more organizations on your ${organizationLimits.userPlan || 'current'} plan.`
              : 'To get started with SmartHR, you need to create an organization or join an existing one.'
            }
          </p>
          
          {mode === 'create' && organizationLimits && !organizationLimits.canCreateMore && (
            <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
              <p className="text-sm text-amber-800">
                You've reached your organization limit ({organizationLimits.currentCount}/{organizationLimits.maxOrganizations}) for the {organizationLimits.userPlan} plan. 
                <button className="ml-1 font-medium underline hover:no-underline">
                  Upgrade your plan
                </button> to create more organizations.
              </p>
            </div>
          )}
        </div>

        {mode === 'create' ? (
          // Create mode - only show create form
          <div className="space-y-4">
            <OrganizationForm
              formData={formData}
              onSubmit={handleSubmit}
              onChange={handleChange}
              isLoading={isLoading}
              canSubmit={organizationLimits?.canCreateMore !== false}
              limitMessage={
                organizationLimits && !organizationLimits.canCreateMore
                  ? `You've reached your organization limit (${organizationLimits.currentCount}/${organizationLimits.maxOrganizations}) for the ${organizationLimits.userPlan} plan. Upgrade to create more organizations.`
                  : undefined
              }
            />
          </div>
        ) : (
          // Setup mode - show both tabs  
          <Tabs value={activeTab} onValueChange={(value) => {
            setActiveTab(value);
            // Load invitations when switching to join tab
            if (value === 'join' && !hasLoadedOnce) {
              loadPendingInvitations();
            }
          }} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="create" className="flex items-center space-x-2">
                <Building2 className="w-4 h-4" />
                <span>Create Organization</span>
              </TabsTrigger>
              <TabsTrigger value="join" className="flex items-center space-x-2">
                <Users className="w-4 h-4" />
                <span>Join Organization</span>
                {Array.isArray(pendingInvites) && pendingInvites.length > 0 && (
                  <Badge variant="secondary" className="ml-1 bg-blue-100 text-blue-700">
                    {pendingInvites.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="create" className="space-y-4">
              <div className="py-2">
                <p className="text-sm text-gray-600">
                  Create your own organization workspace to manage jobs, candidates, and collaborate with your team.
                </p>

                {/* IdP Primary Option - Recommended */}
                {idpUrl && (
                  <div className="mt-3 rounded-md border-2 border-blue-300 bg-blue-50 p-4">
                    <div className="flex items-start gap-3">
                      <Building2 className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <h4 className="font-medium text-blue-900">Recommended: Create via Identity Provider</h4>
                        <p className="text-sm text-blue-700 mt-1">
                          Organizations are managed through the Identity Provider for enhanced security and centralized management.
                        </p>
                        <Button
                          type="button"
                          className="mt-3 bg-blue-600 hover:bg-blue-700"
                          onClick={() => window.open(`${idpUrl.replace(/\/$/, '')}/organizations`, '_blank')}
                        >
                          <Building2 className="w-4 h-4 mr-2" />
                          Open Identity Provider
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {idpUrl && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-xs text-gray-500 mb-2">Or create directly (will sync with Identity Provider):</p>
                  </div>
                )}
              </div>

              <OrganizationForm
                formData={formData}
                onSubmit={handleSubmit}
                onChange={handleChange}
                isLoading={isLoading}
                showLogout={true}
                onLogout={handleLogout}
              />
            </TabsContent>

            <TabsContent value="join" className="space-y-4">
              <div className="py-2">
                <p className="text-sm text-gray-600">
                  Join an existing organization by accepting a pending invitation.
                </p>
              </div>

              {loadingInvites && !hasLoadedOnce ? (
                <div className="text-center py-8">
                  <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-gray-500">Loading invitations...</p>
                </div>
              ) : pendingInvites.length === 0 ? (
                <div className="text-center py-8">
                  <Mail className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Pending Invitations</h3>
                  <p className="text-gray-500">You don't have any pending organization invitations.</p>
                  <p className="text-sm text-gray-400 mt-2">
                    Ask your team leader to send you an invitation, or switch to the "Create Organization" tab to create your own.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {Array.isArray(pendingInvites) && pendingInvites.map((invite) => (
                    <Card key={invite._id} className="border">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-lg">{invite.organization.name}</CardTitle>
                            <CardDescription>
                              Invited by {invite.invitedBy.profile?.firstName} {invite.invitedBy.profile?.lastName}
                              <br />
                              Role: <span className="font-medium">{invite.role}</span>
                            </CardDescription>
                          </div>
                          <Badge variant="secondary">Pending</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="flex space-x-2">
                          <Button
                            onClick={() => handleAcceptInvite(invite)}
                            disabled={acceptingInvite === invite._id}
                            className="flex-1"
                            size="sm"
                          >
                            {acceptingInvite === invite._id ? (
                              <>
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                Accepting...
                              </>
                            ) : (
                              <>
                                <Check className="mr-2 h-3 w-3" />
                                Accept
                              </>
                            )}
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="flex-1"
                            onClick={() => handleRejectInvite(invite)}
                            disabled={rejectingInvite === invite._id}
                          >
                            {rejectingInvite === invite._id ? (
                              <>
                                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                Declining...
                              </>
                            ) : (
                              <>
                                <X className="mr-2 h-3 w-3" />
                                Decline
                              </>
                            )}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              <div className="pt-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleLogout}
                  disabled={isLoading || contextLoading}
                  className="w-full"
                  size="lg"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout Instead
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default OrganizationSetupModal;
