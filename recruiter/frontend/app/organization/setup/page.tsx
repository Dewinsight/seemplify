'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Building2, Users, Mail, Check, X, LogOut, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import organizationService from '@/services/organizationService';
import { UserPendingInvitation } from '@/services/organizationService';
import OrganizationForm from '@/components/OrganizationForm';

export default function OrganizationSetupPage() {
  const { currentOrganization, isLoading, organizations, organizationLimits, createOrganization } = useOrganization();
  const { logout, isAuthenticated } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const idpUrl = process.env.NEXT_PUBLIC_IDP_URL || '';
  
  // Get tab from URL parameters
  const tabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<string>(tabParam === 'join' ? 'join' : 'create');
  
  // Organization form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    industry: '',
    size: '',
    website: ''
  });
  
  // Invitations state
  const [pendingInvites, setPendingInvites] = useState<UserPendingInvitation[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [acceptingInvite, setAcceptingInvite] = useState<string | null>(null);
  const [rejectingInvite, setRejectingInvite] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [loadingState, setLoadingState] = useState<'initial' | 'loading' | 'retrying' | 'loaded' | 'error'>('initial');

  // Redirect if user already has an organization
  useEffect(() => {
    if (!isLoading && currentOrganization) {
      console.log('✅ User already has organization, redirecting to dashboard');
      router.push('/dashboard');
    }
  }, [currentOrganization, isLoading, router]);
  
  // Load invitations on page load
  useEffect(() => {
    loadPendingInvitations();
  }, []);
  
  // Load invitations when switching to join tab
  useEffect(() => {
    if (activeTab === 'join') {
      loadPendingInvitations();
    }
  }, [activeTab]);

  const loadPendingInvitations = async () => {
    const MAX_RETRIES = 1; // Reduced since we fixed the throttling issue
    let currentRetry = 0;
    
    while (currentRetry <= MAX_RETRIES) {
      try {
        setLoadingInvites(true);
        setLoadingState(currentRetry > 0 ? 'retrying' : 'loading');
        setRetryCount(currentRetry);
        
        console.log(`📧 Loading pending invitations... ${currentRetry > 0 ? `(Retry ${currentRetry}/${MAX_RETRIES})` : ''}`);
        
        const result = await organizationService.getUserPendingInvitations();
        
        console.log('📧 Invitations loaded successfully:', result);
        setPendingInvites(result.pendingInvites || []);
        setLoadingState('loaded');
        
        // Auto switch to join tab if invitations exist and we haven't explicitly set another tab
        if (result.pendingInvites?.length > 0 && !tabParam) {
          setActiveTab('join');
        }
        
        setLoadingInvites(false);
        return;
        
      } catch (error: any) {
        console.error(`📧 Failed to load pending invitations (attempt ${currentRetry + 1}/${MAX_RETRIES + 1}):`, error);
        
        if (currentRetry < MAX_RETRIES) {
          const delay = 1000; // Simple 1s delay for the single retry
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          currentRetry++;
        } else {
          console.error('❌ Failed to load invitations after all retries');
          setPendingInvites([]);
          setLoadingState('error');
          setLoadingInvites(false);
          toast.error('Failed to load invitations. Please try refreshing the page.');
          return;
        }
      }
    }
  };
  
  const handleAcceptInvite = async (invite: UserPendingInvitation) => {
    try {
      setAcceptingInvite(invite._id);
      
      await organizationService.acceptInvite(invite.token);
      
      toast.success(`Successfully joined ${invite.organization.name}!`);
      
      // Remove the accepted invitation from the list
      setPendingInvites(prev => prev.filter(inv => inv._id !== invite._id));
      
      // Navigate to dashboard
      console.log('🚀 Organization joined, navigating to dashboard');
      router.push('/dashboard');
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
      setPendingInvites(prev => prev.filter(inv => inv._id !== invite._id));
      
      toast.success('Invitation declined');
    } catch (error: any) {
      console.error('Failed to reject invitation:', error);
      toast.error('Failed to decline invitation');
    } finally {
      setRejectingInvite(null);
    }
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('Organization name is required');
      return;
    }

    // Check limits
    if (organizationLimits && !organizationLimits.canCreateMore) {
      toast.error(`You've reached your organization limit (${organizationLimits.currentCount}/${organizationLimits.maxOrganizations}) for the ${organizationLimits.userPlan} plan.`);
      return;
    }

    try {
      setIsSubmitting(true);
      console.log('📝 Creating organization:', formData);
      await createOrganization(formData);
      toast.success('Organization created successfully!');

      // Navigate to dashboard
      router.push('/dashboard');
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
      setIsSubmitting(false);
    }
  };
  
  const handleLogout = () => {
    console.log('🔐 User requested logout from organization setup');
    logout();
  };
  
  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome to SmartHR!
          </h1>
          <p className="text-gray-600">
            Please set up your organization to get started
          </p>
        </div>

        <Card className="w-full shadow-lg">
          <CardHeader className="text-center pb-6">
            <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <Building2 className="w-8 h-8 text-blue-600" />
            </div>
            <CardTitle className="text-2xl">Organization Setup</CardTitle>
            <CardDescription className="text-base">
              Create your organization or join an existing one
            </CardDescription>
            {idpUrl && (
              <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Prefer to manage orgs and invites in the Identity Provider?{' '}
                <button
                  className="font-semibold underline"
                  onClick={() => window.open(`${idpUrl.replace(/\/$/, '')}/organizations`, '_blank')}
                >
                  Open IdP
                </button>
              </div>
            )}
          </CardHeader>
          <CardContent className="pb-8 px-6 sm:px-8">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-8">
                <TabsTrigger value="create" className="flex items-center space-x-2 py-3">
                  <Building2 className="w-4 h-4" />
                  <span>Create Organization</span>
                </TabsTrigger>
                <TabsTrigger value="join" className="flex items-center space-x-2 py-3">
                  <Users className="w-4 h-4" />
                  <span>Join Organization</span>
                  {pendingInvites.length > 0 && (
                    <Badge variant="secondary" className="ml-1 bg-blue-100 text-blue-700">
                      {pendingInvites.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="create" className="space-y-6">
                <div className="text-sm text-gray-600 mb-4">
                  Create your own organization workspace to manage jobs, candidates, and collaborate with your team.
                </div>

                <OrganizationForm
                  formData={formData}
                  onSubmit={handleSubmit}
                  onChange={handleChange}
                  isLoading={isSubmitting}
                  showLogout={true}
                  onLogout={handleLogout}
                  canSubmit={organizationLimits?.canCreateMore !== false}
                  limitMessage={
                    organizationLimits && !organizationLimits.canCreateMore
                      ? `You've reached your organization limit (${organizationLimits.currentCount}/${organizationLimits.maxOrganizations}) for the ${organizationLimits.userPlan} plan.`
                      : undefined
                  }
                />
              </TabsContent>

              <TabsContent value="join" className="space-y-6">
                <div className="text-sm text-gray-600 mb-4">
                  Join an existing organization by accepting a pending invitation.
                </div>

                {loadingInvites ? (
                  <div className="text-center py-12">
                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-500">
                      {loadingState === 'retrying' 
                        ? `Loading invitations... (Retry ${retryCount}/1)`
                        : 'Loading invitations...'}
                    </p>
                    {loadingState === 'retrying' && (
                      <p className="text-sm text-gray-400 mt-2">
                        Having trouble connecting. Retrying...
                      </p>
                    )}
                  </div>
                ) : loadingState === 'error' ? (
                  <div className="text-center py-12 px-4">
                    <div className="text-red-500 text-5xl mb-4">⚠️</div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to Load Invitations</h3>
                    <p className="text-gray-500 mb-4">We couldn't load your invitations after multiple attempts.</p>
                    <Button 
                      variant="outline"
                      onClick={loadPendingInvitations}
                      disabled={loadingInvites}
                    >
                      <Mail className="mr-2 h-4 w-4" />
                      Try Again
                    </Button>
                  </div>
                ) : pendingInvites.length === 0 ? (
                  <div className="text-center py-12 px-4">
                    <Mail className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Pending Invitations</h3>
                    <p className="text-gray-500 mb-2">You don't have any pending organization invitations at the moment.</p>
                    <p className="text-sm text-gray-400">
                      Ask your team leader to send you an invitation, or switch to the "Create Organization" tab to create your own.
                    </p>
                    <Button 
                      variant="outline"
                      size="sm"
                      onClick={loadPendingInvitations}
                      disabled={loadingInvites}
                      className="mt-4"
                    >
                      {loadingInvites ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        <>
                          <Mail className="mr-2 h-4 w-4" />
                          Refresh Invitations
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {pendingInvites.map((invite) => (
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

                <div className="pt-6 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleLogout}
                    className="w-full"
                    size="lg"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Logout
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            Need help? Contact our support team at{' '}
            <a href="mailto:support@smarthr.com" className="text-blue-600 hover:underline">
              support@smarthr.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
