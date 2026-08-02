'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { 
  Building2, 
  Users, 
  Plus, 
  Edit3, 
  Trash2, 
  Globe, 
  Crown,
  Shield,
  User,
  UserCheck,
  LogOut,
  RefreshCw,
  Settings,
  Coins,
  TrendingUp,
  Calendar,
  AlertTriangle
} from 'lucide-react';
import { useOrganization } from '@/context/OrganizationContext';
import OrganizationSetupModal from '@/components/OrganizationSetupModal';
import OrganizationSettings from '@/components/OrganizationSettings';
import OrganizationMembers from '@/components/OrganizationMembers';
import DeleteOrganizationDialog from '@/components/DeleteOrganizationDialog';
import OrganizationUpdateNotice from '@/components/OrganizationUpdateNotice';
import { toast } from 'sonner';
import { getCreditStatus, getCreditTransactions, CreditStatus, CreditTransaction } from '@/services/creditsService';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function OrganizationPage() {
  const { 
    currentOrganization, 
    organizations,
    switchOrganization,
    deleteOrganization,
    leaveOrganization,
    organizationLimits,
    loadOrganizations,
    isLoading 
  } = useOrganization();
  
  const [activeTab, setActiveTab] = useState("settings");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // IDP URL for organization management
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [organizationToDelete, setOrganizationToDelete] = useState<any>(null);
  const [organizationToLeave, setOrganizationToLeave] = useState<any>(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  
  // Credits state
  const [credits, setCredits] = useState<CreditStatus | null>(null);
  const [creditTransactions, setCreditTransactions] = useState<CreditTransaction[]>([]);
  const [loadingCredits, setLoadingCredits] = useState(false);

  // Load credits when organization loads or changes
  useEffect(() => {
    if (currentOrganization) {
      loadCredits();
    }
  }, [currentOrganization?._id]);

  const loadCredits = async () => {
    try {
      setLoadingCredits(true);
      const [creditsRes, transactionsRes] = await Promise.all([
        getCreditStatus(),
        getCreditTransactions({ limit: 10 })
      ]);

      if (creditsRes.success) {
        setCredits(creditsRes.credits);
      }
      if (transactionsRes.success) {
        setCreditTransactions(transactionsRes.transactions);
      }
    } catch (error) {
      console.error('Error loading credits:', error);
    } finally {
      setLoadingCredits(false);
    }
  };

  const getCreditsColor = (percentage: number, isLowCredit = false) => {
    if (isLowCredit) return 'text-red-500';
    if (percentage >= 80) return 'text-amber-500';
    if (percentage >= 50) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getCreditsProgressColor = (percentage: number, isLowCredit = false) => {
    if (isLowCredit) return 'bg-red-500';
    if (percentage >= 80) return 'bg-amber-500';
    if (percentage >= 50) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const formatActionName = (action: string) => {
    const names: { [key: string]: string } = {
      createJob: 'Create Job',
      uploadCandidate: 'Upload Candidate',
      scheduleInterview: 'Schedule Interview',
      aiMatching: 'AI Matching',
      generateQuestions: 'Generate Questions',
      aiAnalysis: 'AI Analysis',
      aiInterviewCandidate: 'AI Interview Candidate',
      bulkUpload: 'Bulk Upload',
      reEmbed: 'Re-embed',
      creditPurchase: 'Credit Purchase',
      cycleReset: 'Cycle Reset'
    };
    return names[action] || action;
  };

  // Handler functions from organizations page
  const handleSwitchOrganization = async (organizationId: string) => {
    if (organizationId === currentOrganization?._id) return;
    
    try {
      setSwitchingTo(organizationId);
      await switchOrganization(organizationId);
      
      const orgName = organizations.find(org => org._id === organizationId)?.name;
      toast.success(`Switched to ${orgName}`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to switch organization');
    } finally {
      setSwitchingTo(null);
    }
  };

  const handleEditClick = async (organization: any) => {
    // Edit organizations in-app: switch to the org, then open the Settings tab
    try {
      await switchOrganization(organization._id);
      setActiveTab('settings');
    } catch (error: any) {
      toast.error(error.message || 'Failed to open organization settings');
    }
  };

  const handleDeleteClick = (organization: any) => {
    setOrganizationToDelete(organization);
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    if (!organizationToDelete) return;
    
    try {
      setIsDeleting(true);
      await deleteOrganization(organizationToDelete._id);
      toast.success(`Organization "${organizationToDelete.name}" deleted successfully`);
      setShowDeleteDialog(false);
      setOrganizationToDelete(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete organization');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLeaveClick = (organization: any) => {
    setOrganizationToLeave(organization);
    setShowLeaveDialog(true);
  };

  const handleLeaveConfirm = async () => {
    if (!organizationToLeave) return;
    
    try {
      setIsLeaving(true);
      await leaveOrganization();
      toast.success(`You have left "${organizationToLeave.name}"`);
      setShowLeaveDialog(false);
      setOrganizationToLeave(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to leave organization');
    } finally {
      setIsLeaving(false);
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner': return <Crown className="w-4 h-4 text-purple-600" />;
      case 'admin': return <Shield className="w-4 h-4 text-blue-600" />;
      case 'hr_manager': return <UserCheck className="w-4 h-4 text-green-600" />;
      default: return <User className="w-4 h-4 text-gray-600" />;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'owner': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'admin': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'hr_manager': return 'bg-green-100 text-green-800 border-green-200';
      case 'recruiter': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'interviewer': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
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

  if (isLoading) {
    return (
      <div className="container mx-auto py-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-500">Loading organization...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!currentOrganization) {
    return (
      <div className="container mx-auto py-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Building2 className="w-5 h-5" />
              <span>No Organization</span>
            </CardTitle>
            <CardDescription>
              You need to create or join an organization to access this page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">
              Please create an organization or contact an administrator to get invited to an existing organization.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-4 sm:py-6 px-3 sm:px-4 md:px-6 space-y-4 sm:space-y-6">
      {/* Header - Mobile Responsive */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Organization</h1>
          <p className="text-gray-600 text-sm sm:text-base mt-1">
            Manage your organization settings, team members, and switch between organizations
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              console.log('🔄 Organization settings refresh - using loadOrganizations');
              await loadOrganizations();
            }}
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Badge variant="outline" className="px-3 py-1 truncate max-w-[150px] sm:max-w-none">
            {currentOrganization.name}
          </Badge>
          <Badge 
            variant="secondary" 
            className={getRoleColor(currentOrganization.userRole)}
          >
            <span className="flex items-center gap-1">
              {getRoleIcon(currentOrganization.userRole)}
              {getRoleLabel(currentOrganization.userRole)}
            </span>
          </Badge>
        </div>
      </div>

      {/* Update Notice */}
      <OrganizationUpdateNotice />

      {/* Credits Section */}
      {credits && (
        <Card className={`border-2 ${credits.warnings.lowCredit ? 'border-red-300 bg-red-50' : 'border-green-300 bg-green-50'}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Coins className={`w-5 h-5 ${getCreditsColor(credits.percentageUsed, credits.warnings.lowCredit)}`} />
                Organization Credits
              </CardTitle>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => window.location.href = '/analytics/credits'}
                className="flex items-center gap-2"
              >
                <TrendingUp className="w-4 h-4" />
                View Analytics
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingCredits ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Credits Overview */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-white rounded-lg border">
                    <div className={`text-3xl font-bold mb-1 ${getCreditsColor(credits.percentageUsed, credits.warnings.lowCredit)}`}>
                      {credits.remainingCredits}
                    </div>
                    <div className="text-sm text-gray-600">Credits Remaining</div>
                  </div>
                  
                  <div className="text-center p-4 bg-white rounded-lg border">
                    <div className="text-3xl font-bold text-gray-700 mb-1">
                      {credits.totalCredits}
                    </div>
                    <div className="text-sm text-gray-600">Total Credits</div>
                  </div>
                  
                  <div className="text-center p-4 bg-white rounded-lg border">
                    <div className="text-3xl font-bold text-blue-600 mb-1">
                      {Math.max(0, credits.daysUntilReset)}
                    </div>
                    <div className="text-sm text-gray-600">Days Until Reset</div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700">Usage: {credits.percentageUsed.toFixed(1)}%</span>
                    <span className="text-gray-500">{credits.usedCredits} / {credits.totalCredits} used</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${getCreditsProgressColor(credits.percentageUsed, credits.warnings.lowCredit)}`}
                      style={{ width: `${Math.min(credits.percentageUsed, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Warnings */}
                {credits.warnings.lowCredit && (
                  <div className="bg-red-100 border border-red-300 rounded-lg p-3 flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-semibold text-red-900">Low Credits Warning</div>
                      <div className="text-sm text-red-700">
                        You have only {credits.remainingCredits} credits remaining. Consider upgrading your plan or purchasing additional credits.
                      </div>
                    </div>
                  </div>
                )}

                {/* Recent Transactions */}
                {creditTransactions.length > 0 && (
                  <div className="border-t pt-4">
                    <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      Recent Transactions
                    </h4>
                    <div className="space-y-2">
                      {creditTransactions.slice(0, 5).map((transaction, index) => (
                        <div key={index} className="flex items-center justify-between py-2 px-3 bg-white rounded border text-sm">
                          <div className="flex items-center gap-2">
                            <div className={`font-medium ${transaction.credits > 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {transaction.credits > 0 ? '+' : ''}{transaction.credits}
                            </div>
                            <div className="text-gray-600">{formatActionName(transaction.action)}</div>
                          </div>
                          <div className="text-gray-500 text-xs">
                            {new Date(transaction.timestamp).toLocaleDateString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Credit Costs */}
                <div className="border-t pt-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Credit Costs</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {Object.entries(credits.creditCosts).map(([action, cost]) => (
                      <div key={action} className="p-2 bg-white rounded border text-center">
                        <div className="font-bold text-blue-600">{cost}</div>
                        <div className="text-xs text-gray-600">{formatActionName(action)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Current Organization Quick Info - Mobile Responsive */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4 sm:pt-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0">
            <div className="text-center sm:text-left">
              <h3 className="font-semibold text-blue-900">Current Organization</h3>
              <p className="text-sm text-blue-700 mt-1 line-clamp-1">
                {currentOrganization.name} • Plan: <span className="font-semibold capitalize">{currentOrganization.subscription?.plan || 'Free'}</span>
              </p>
            </div>
            
            {/* Stats grid with divider */}
            <div className="flex items-center justify-center sm:justify-end gap-6 text-sm pt-2 sm:pt-0 border-t sm:border-0 border-blue-200 mt-2 sm:mt-0">
              <div className="flex flex-col items-center">
                <div className="font-semibold text-lg text-blue-900">{currentOrganization.members?.length || 0}</div>
                <div className="text-blue-700 text-xs">Members</div>
              </div>
              
              <div className="h-10 border-r border-blue-200 hidden sm:block"></div>
              
              <div className="flex flex-col items-center">
                <div className="font-semibold text-lg text-blue-900">
                  {currentOrganization.subscription?.memberLimit === undefined ? 0 : 
                    currentOrganization.subscription?.memberLimit === 0 || currentOrganization.subscription?.memberLimit > 999999 ? '∞' : 
                    currentOrganization.subscription?.memberLimit}
                </div>
                <div className="text-blue-700 text-xs">Limit</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs - Mobile Responsive */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="overflow-x-auto pb-1 -mx-3 px-3">
          <TabsList className="grid min-w-0 w-full grid-cols-3 h-auto bg-white dark:bg-gray-800">
            <TabsTrigger value="settings" className="flex flex-col sm:flex-row items-center gap-1 py-2.5 px-2 h-auto">
              <Settings className="w-4 h-4 flex-shrink-0" />
              <span className="text-[10px] sm:text-sm font-medium">Settings</span>
            </TabsTrigger>
            <TabsTrigger value="members" className="flex flex-col sm:flex-row items-center gap-1 py-2.5 px-2 h-auto">
              <Users className="w-4 h-4 flex-shrink-0" />
              <span className="text-[10px] sm:text-sm font-medium">Team <span className="hidden sm:inline">({currentOrganization.members?.length || 0})</span></span>
              <span className="text-[10px] sm:hidden">({currentOrganization.members?.length || 0})</span>
            </TabsTrigger>
            <TabsTrigger value="organizations" className="flex flex-col sm:flex-row items-center gap-1 py-2.5 px-2 h-auto">
              <Building2 className="w-4 h-4 flex-shrink-0" />
              <span className="text-[10px] sm:text-sm font-medium hidden min-[360px]:inline">Organizations <span className="hidden sm:inline">({organizations.length})</span></span>
              <span className="text-[10px] min-[360px]:hidden">Orgs</span>
              <span className="text-[10px] sm:hidden min-[360px]:inline">({organizations.length})</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="settings" className="space-y-6">
          <OrganizationSettings />
        </TabsContent>

        <TabsContent value="members" className="space-y-6">
          <OrganizationMembers onInviteSuccess={() => setActiveTab("members")} />
        </TabsContent>

        <TabsContent value="organizations" className="space-y-6">
          {/* Organization Creation Info */}
          <Card className="border-green-200 bg-green-50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-green-600" />
                  Organization Management
                </CardTitle>
                <Button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-2"
                  size="sm"
                >
                  <Plus className="w-4 h-4" />
                  Create Organization
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <User className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="font-semibold text-green-900">✅ Unlimited Organization Creation</p>
                      <p className="text-sm text-green-700">You can create as many organizations as needed at no cost</p>
                    </div>
                  </div>
                </div>
                <div className="text-center">
                  <div className="font-semibold text-green-900">{organizations.length}</div>
                  <div className="text-sm text-green-700">Organizations</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Organizations List */}
          <div className="grid gap-4">
            {organizations.map((org) => (
              <Card 
                key={org._id} 
                className={`transition-all hover:shadow-md ${
                  org._id === currentOrganization?._id 
                    ? 'border-blue-500 shadow-blue-100 shadow-lg' 
                    : 'border-gray-200'
                }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-12 h-12">
                        <AvatarImage src={org.logo} />
                        <AvatarFallback className="text-lg font-semibold">
                          {org.name?.charAt(0)?.toUpperCase() || 'O'}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-xl">{org.name}</CardTitle>
                          {org._id === currentOrganization?._id && (
                            <Badge variant="default" className="bg-blue-600">
                              Current
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="mt-1">
                          {org.description || 'No description provided'}
                        </CardDescription>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant="outline" 
                        className={`${getRoleColor(org.userRole)} border`}
                      >
                        <span className="flex items-center gap-1">
                          {getRoleIcon(org.userRole)}
                          {getRoleLabel(org.userRole)}
                        </span>
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent className="pt-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6 text-sm text-gray-600">
                      {org.industry && (
                        <div className="flex items-center gap-1">
                          <Building2 className="w-4 h-4" />
                          <span>{org.industry}</span>
                        </div>
                      )}
                      
                      {org.memberCount && (
                        <div className="flex items-center gap-1">
                          <Users className="w-4 h-4" />
                          <span>{org.memberCount} member{org.memberCount !== 1 ? 's' : ''}</span>
                        </div>
                      )}
                      
                      {org.website && (
                        <div className="flex items-center gap-1">
                          <Globe className="w-4 h-4" />
                          <a 
                            href={org.website} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            Website
                          </a>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {org._id !== currentOrganization?._id && (
                        <Button
                          onClick={() => handleSwitchOrganization(org._id)}
                          disabled={switchingTo === org._id}
                          variant="outline"
                          size="sm"
                        >
                          {switchingTo === org._id ? 'Switching...' : 'Switch To'}
                        </Button>
                      )}
                      
                      {org.userRole === 'owner' ? (
                        <>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="gap-1"
                            onClick={() => handleEditClick(org)}
                          >
                            <Edit3 className="w-3 h-3" />
                            Edit
                          </Button>
                          
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="gap-1 text-red-600 hover:text-red-700 hover:border-red-300"
                            onClick={() => handleDeleteClick(org)}
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete
                          </Button>
                        </>
                      ) : (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="gap-1 text-orange-600 hover:text-orange-700 hover:border-orange-300"
                          onClick={() => handleLeaveClick(org)}
                        >
                          <LogOut className="w-3 h-3" />
                          Leave
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {organizations.length === 0 && (
            <Card className="text-center py-12">
              <CardContent>
                <Building2 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <CardTitle className="text-xl text-gray-600 mb-2">No Organizations</CardTitle>
                <CardDescription className="mb-4">
                  You don't belong to any organizations yet. Create your first organization to get started.
                </CardDescription>
                <Button onClick={() => setShowCreateModal(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Organization
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <OrganizationSetupModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        mode="create"
      />

      {/* Modals and Dialogs */}

      <DeleteOrganizationDialog
        isOpen={showDeleteDialog}
        onClose={() => {
          if (!isDeleting) {
            setShowDeleteDialog(false);
            setOrganizationToDelete(null);
          }
        }}
        onConfirm={handleDeleteConfirm}
        organizationName={organizationToDelete?.name || ''}
        organizationId={organizationToDelete?._id || ''}
        memberCount={organizationToDelete?.memberCount || 0}
        isDeleting={isDeleting}
      />

      {/* Leave Organization Dialog */}
      <AlertDialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
        <AlertDialogContent className="sm:max-w-[500px] z-[100] fixed-modal">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave Organization</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to leave "{organizationToLeave?.name}"? 
              You will lose access to all resources and data in this organization.
              {organizations.length === 1 && (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-md">
                  <p className="text-amber-800 text-sm font-medium">
                    ⚠️ This is your only organization. After leaving, you'll need to create a new organization or accept an invitation to continue using SmartHR.
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              onClick={() => {
                setShowLeaveDialog(false);
                setOrganizationToLeave(null);
              }}
              disabled={isLeaving}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLeaveConfirm}
              disabled={isLeaving}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {isLeaving ? 'Leaving...' : 'Leave Organization'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
