"use client";

import { useState, useEffect } from 'react';
import { useAdmin } from '@/context/AdminContext';
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow 
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { apiRequest } from '@/services/apiConfig';
import { 
  Search, 
  Building2, 
  Users, 
  Key, 
  TrendingUp,
  Edit,
  Ban,
  CheckCircle,
  AlertCircle,
  Calendar,
  Coins
} from 'lucide-react';
import { format } from 'date-fns';
import OrganizationCreditsModal from '@/components/admin/OrganizationCreditsModal';

interface Organization {
  _id: string;
  name: string;
  description?: string;
  owner?: {
    email: string;
    profile?: {
      firstName?: string;
      lastName?: string;
    };
  } | null;
  subscription: {
    plan: string;
    memberLimit: number;
    licenseKey?: string;
    licenseType?: string;
    licenseStatus?: string;
    licenseEndDate?: string;
    currentMembers?: number;
    currentJobs?: number;
    currentCandidates?: number;
    creditUsage?: {
      totalCredits?: number;
      usedCredits?: number;
      remainingCredits?: number;
      transactions?: any[];
    };
  };
  memberCount: number;
  usagePercentage: {
    members: number;
  };
  createdAt: string;
}

export default function AdminOrganizationsPage() {
  const { checkPermission } = useAdmin();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [showLicenseDialog, setShowLicenseDialog] = useState(false);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [availableOrgPlans, setAvailableOrgPlans] = useState<Array<{code: string, name: string}>>([]);
  const [loadingOrgPlans, setLoadingOrgPlans] = useState(false);
  const [licenseForm, setLicenseForm] = useState({
    plan: '',
    memberLimit: '',
    licenseType: 'monthly',
    licenseEndDate: '',
    generateNewKey: false
  });

  useEffect(() => {
    fetchOrganizations();
    fetchOrganizationPlans();
  }, [currentPage, selectedPlan, selectedStatus]);
  
  // Fetch organization plans from API
  const fetchOrganizationPlans = async () => {
    try {
      setLoadingOrgPlans(true);
      const token = localStorage.getItem('adminToken');
      
      // Fetch only published organization plans
      const response = await apiRequest(`/api/plans?published=true&planType=organization`, {
        headers: {
          'x-admin-auth-token': token!
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.plans) {
          // Format plans for dropdown
          const orgPlans = data.plans.map((plan: any) => ({
            code: plan.code,
            name: plan.name
          }));
          setAvailableOrgPlans(orgPlans);
        }
      }
    } catch (error) {
      console.error('Error fetching organization plans:', error);
    } finally {
      setLoadingOrgPlans(false);
    }
  };

  const fetchOrganizations = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('adminToken');
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '10',
        ...(searchTerm && { search: searchTerm }),
        ...(selectedPlan !== 'all' && { plan: selectedPlan }),
        ...(selectedStatus !== 'all' && { status: selectedStatus })
      });

      const response = await apiRequest(`/api/admin/organizations?${params}`, {
        headers: {
          'x-admin-auth-token': token!
        }
      });

      if (response.ok) {
        const data = await response.json();
        setOrganizations(data.organizations);
        setTotalPages(data.totalPages);
      }
    } catch (error) {
      console.error('Error fetching organizations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setCurrentPage(1);
    fetchOrganizations();
  };

  const handleEditLicense = (org: Organization) => {
    setSelectedOrg(org);
    setLicenseForm({
      plan: org.subscription.plan,
      memberLimit: org.subscription.memberLimit.toString(),
      licenseType: org.subscription.licenseType || 'monthly',
      licenseEndDate: org.subscription.licenseEndDate ? 
        new Date(org.subscription.licenseEndDate).toISOString().split('T')[0] : '',
      generateNewKey: false
    });
    
    // Ensure we have organization plans loaded
    if (availableOrgPlans.length === 0 && !loadingOrgPlans) {
      fetchOrganizationPlans();
    }
    
    setShowLicenseDialog(true);
  };

  const handleUpgradePlan = (org: Organization) => {
    setSelectedOrg(org);
    setShowUpgradeDialog(true);
  };
  
  const handleManageCredits = (org: Organization) => {
    setSelectedOrg(org);
    setShowCreditsModal(true);
  };

  const handleSaveLicense = async () => {
    if (!selectedOrg) return;

    try {
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest(`/api/admin/organizations/${selectedOrg._id}/license`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth-token': token!
        },
        body: JSON.stringify({
          ...licenseForm,
          memberLimit: parseInt(licenseForm.memberLimit)
        })
      });

      if (response.ok) {
        setShowLicenseDialog(false);
        fetchOrganizations();
      }
    } catch (error) {
      console.error('Error updating license:', error);
    }
  };

  const handleUpgrade = async (newPlan: string) => {
    if (!selectedOrg) return;

    try {
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest(`/api/admin/organizations/${selectedOrg._id}/plan`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth-token': token!
        },
        body: JSON.stringify({ plan: newPlan })
      });

      if (response.ok) {
        setShowUpgradeDialog(false);
        fetchOrganizations();
      }
    } catch (error) {
      console.error('Error upgrading plan:', error);
    }
  };

  const handleSuspend = async (orgId: string) => {
    const reason = prompt('Please provide a reason for suspension:');
    if (!reason) return;

    try {
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest(`/api/admin/organizations/${orgId}/suspend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth-token': token!
        },
        body: JSON.stringify({ reason })
      });

      if (response.ok) {
        fetchOrganizations();
      }
    } catch (error) {
      console.error('Error suspending organization:', error);
    }
  };

  const handleActivate = async (orgId: string) => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest(`/api/admin/organizations/${orgId}/activate`, {
        method: 'POST',
        headers: {
          'x-admin-auth-token': token!
        }
      });

      if (response.ok) {
        fetchOrganizations();
      }
    } catch (error) {
      console.error('Error activating organization:', error);
    }
  };

  const getPlanBadgeColor = (plan: string) => {
    switch (plan) {
      case 'org-starter': return 'bg-blue-500';
      case 'org-enterprise': return 'bg-gradient-to-r from-yellow-500 to-orange-500';
      // Legacy plan support
      case 'free': return 'bg-gray-500';
      case 'basic': return 'bg-blue-500';
      case 'pro': return 'bg-purple-500';
      case 'enterprise': return 'bg-gradient-to-r from-yellow-500 to-orange-500';
      default: return 'bg-gray-400';
    }
  };

  const getStatusBadgeColor = (status?: string) => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'expired': return 'bg-red-500';
      case 'suspended': return 'bg-orange-500';
      default: return 'bg-gray-400';
    }
  };

  return (
    <div className="flex h-screen bg-gray-900">
      <AdminSidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <AdminHeader />
        
        <main className="flex-1 overflow-y-auto bg-gray-900 p-6">
          <div className="max-w-7xl mx-auto">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-white mb-2">Organizations</h1>
              <p className="text-gray-400">Manage organization licenses and subscription plans</p>
            </div>

            {/* Filters */}
            <Card className="bg-gray-800 border-gray-700 mb-6">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                      <Input
                        placeholder="Search organizations..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                        className="pl-10 bg-gray-700 border-gray-600 text-white"
                      />
                    </div>
                  </div>
                  
                  <Select value={selectedPlan} onValueChange={setSelectedPlan}>
                    <SelectTrigger className="w-40 bg-gray-700 border-gray-600 text-white">
                      <SelectValue placeholder="All Plans" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Plans</SelectItem>
                                        {loadingOrgPlans ? (
                    <SelectItem value="_loading" disabled>Loading plans...</SelectItem>
                  ) : (
                        availableOrgPlans.map(plan => (
                          <SelectItem key={plan.code} value={plan.code}>
                            {plan.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  
                  <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                    <SelectTrigger className="w-40 bg-gray-700 border-gray-600 text-white">
                      <SelectValue placeholder="All Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  <Button onClick={handleSearch} className="bg-blue-600 hover:bg-blue-700">
                    Search
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Organizations Table */}
            <Card className="bg-gray-800 border-gray-700">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-700">
                      <TableHead className="text-gray-400">Organization</TableHead>
                      <TableHead className="text-gray-400">Owner</TableHead>
                      <TableHead className="text-gray-400">Plan</TableHead>
                      <TableHead className="text-gray-400">Usage</TableHead>
                      <TableHead className="text-gray-400">Status</TableHead>
                      <TableHead className="text-gray-400">Created</TableHead>
                      <TableHead className="text-gray-400 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-gray-400 py-8">
                          Loading organizations...
                        </TableCell>
                      </TableRow>
                    ) : organizations.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-gray-400 py-8">
                          No organizations found
                        </TableCell>
                      </TableRow>
                    ) : (
                      organizations.map((org) => (
                        <TableRow key={org._id} className="border-gray-700">
                          <TableCell className="text-white font-medium">
                            <div>
                              <div className="flex items-center gap-2">
                                <span>{org.name}</span>
                                <span className="text-xs text-gray-500 font-mono">
                                  ID: {org._id.slice(-6)}
                                </span>
                              </div>
                              {org.description && (
                                <div className="text-sm text-gray-400">{org.description}</div>
                              )}
                              <div className="text-xs text-gray-500 mt-1">
                                Members: {org.memberCount} | Created: {format(new Date(org.createdAt), 'MMM yyyy')}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-gray-300">
                            <div className="text-sm">
                              {org.owner?.profile?.firstName || org.owner?.profile?.lastName
                                ? `${org.owner?.profile?.firstName || ''} ${org.owner?.profile?.lastName || ''}`.trim()
                                : org.owner?.email?.split('@')[0] || 'Unknown Owner'
                              }
                            </div>
                            <div className="text-xs text-gray-500">{org.owner?.email || 'No email'}</div>
                          </TableCell>
                          <TableCell>
                            <Badge className={`${getPlanBadgeColor(org.subscription.plan)} text-white`}>
                              {org.subscription.plan}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="flex items-center space-x-2">
                                <Users className="h-3 w-3 text-gray-400" />
                                <span className="text-xs text-gray-300">
                                  {org.memberCount}/{org.subscription.memberLimit}
                                </span>
                              </div>
                              <div className="w-20 h-1 bg-gray-700 rounded">
                                <div 
                                  className="h-1 bg-blue-500 rounded"
                                  style={{ width: `${Math.min(org.usagePercentage.members, 100)}%` }}
                                />
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={`${getStatusBadgeColor(org.subscription.licenseStatus)} text-white`}>
                              {org.subscription.licenseStatus || 'active'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-gray-300 text-sm">
                            {format(new Date(org.createdAt), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end space-x-2">
                              {checkPermission('manageLicenses') && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleEditLicense(org)}
                                    className="text-blue-400 hover:text-blue-300"
                                  >
                                    <Key className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleUpgradePlan(org)}
                                    className="text-purple-400 hover:text-purple-300"
                                  >
                                    <TrendingUp className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleManageCredits(org)}
                                    className="text-blue-400 hover:text-blue-300"
                                  >
                                    <Coins className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                              {org.subscription.licenseStatus === 'suspended' ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleActivate(org._id)}
                                  className="text-green-400 hover:text-green-300"
                                >
                                  <CheckCircle className="h-4 w-4" />
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleSuspend(org._id)}
                                  className="text-red-400 hover:text-red-300"
                                >
                                  <Ban className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center mt-6 space-x-2">
                <Button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  variant="outline"
                  className="bg-gray-800 border-gray-700 text-white"
                >
                  Previous
                </Button>
                <span className="flex items-center px-4 text-gray-400">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  variant="outline"
                  className="bg-gray-800 border-gray-700 text-white"
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* License Edit Dialog */}
      <Dialog open={showLicenseDialog} onOpenChange={setShowLicenseDialog}>
        <DialogContent className="bg-gray-800 border-gray-700 text-white">
          <DialogHeader>
            <DialogTitle>Edit License - {selectedOrg?.name}</DialogTitle>
            <DialogDescription className="text-gray-400">
              Update license details and limits for this organization
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="plan" className="text-gray-300">Plan</Label>
              <Select value={licenseForm.plan} onValueChange={(v) => setLicenseForm({...licenseForm, plan: v})}>
                <SelectTrigger className="bg-gray-700 border-gray-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {loadingOrgPlans ? (
                    <SelectItem value="_loading" disabled>Loading plans...</SelectItem>
                  ) : availableOrgPlans.length > 0 ? (
                    availableOrgPlans.map(plan => (
                      <SelectItem key={plan.code} value={plan.code}>
                        {plan.name}
                      </SelectItem>
                    ))
                  ) : (
                    <>
                      <SelectItem value="org-starter">Starter</SelectItem>
                      <SelectItem value="org-enterprise">Enterprise</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="memberLimit" className="text-gray-300">Member Limit</Label>
                <Input
                  id="memberLimit"
                  type="number"
                  value={licenseForm.memberLimit}
                  onChange={(e) => setLicenseForm({...licenseForm, memberLimit: e.target.value})}
                  className="bg-gray-700 border-gray-600"
                />
                <p className="text-xs text-gray-400 mt-1">Jobs and candidates are managed by credits</p>
              </div>
            </div>
            
            <div>
              <Label htmlFor="licenseType" className="text-gray-300">License Type</Label>
              <Select value={licenseForm.licenseType} onValueChange={(v) => setLicenseForm({...licenseForm, licenseType: v})}>
                <SelectTrigger className="bg-gray-700 border-gray-600">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trial">Trial</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="lifetime">Lifetime</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="licenseEndDate" className="text-gray-300">License End Date</Label>
              <Input
                id="licenseEndDate"
                type="date"
                value={licenseForm.licenseEndDate}
                onChange={(e) => setLicenseForm({...licenseForm, licenseEndDate: e.target.value})}
                className="bg-gray-700 border-gray-600"
              />
            </div>
            
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="generateNewKey"
                checked={licenseForm.generateNewKey}
                onChange={(e) => setLicenseForm({...licenseForm, generateNewKey: e.target.checked})}
                className="rounded border-gray-600"
              />
              <Label htmlFor="generateNewKey" className="text-gray-300">Generate new license key</Label>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLicenseDialog(false)} className="bg-gray-700 border-gray-600">
              Cancel
            </Button>
            <Button onClick={handleSaveLicense} className="bg-blue-600 hover:bg-blue-700">
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upgrade Plan Dialog */}
      <Dialog open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog}>
        <DialogContent className="bg-gray-800 border-gray-700 text-white">
          <DialogHeader>
            <DialogTitle>Upgrade Plan - {selectedOrg?.name}</DialogTitle>
            <DialogDescription className="text-gray-400">
              Select a new plan for this organization
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              {['org-starter', 'org-enterprise'].map((plan) => (
                <button
                  key={plan}
                  onClick={() => handleUpgrade(plan)}
                  className={`p-4 rounded-lg border transition-colors ${
                    selectedOrg?.subscription.plan === plan
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-gray-700 hover:border-gray-600 bg-gray-700/50'
                  }`}
                  disabled={selectedOrg?.subscription.plan === plan}
                >
                  <div className="flex justify-between items-center">
                    <div className="text-left">
                      <h3 className="text-lg font-semibold">
                        {plan === 'org-starter' ? 'Starter' : 'Enterprise'}
                      </h3>
                      <p className="text-sm text-gray-400">
                        {plan === 'org-starter' && '10 members • 25 jobs • 500 candidates'}
                        {plan === 'org-enterprise' && 'Unlimited members • jobs • candidates'}
                      </p>
                    </div>
                    {selectedOrg?.subscription.plan === plan && (
                      <Badge className="bg-green-500 text-white">Current</Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpgradeDialog(false)} className="bg-gray-700 border-gray-600">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Organization Credits Modal */}
      {selectedOrg && (
        <OrganizationCreditsModal
          isOpen={showCreditsModal}
          onClose={() => setShowCreditsModal(false)}
          organization={selectedOrg}
          onSuccess={() => {
            // Refresh the organization list after credit operations
            fetchOrganizations();
          }}
        />
      )}
    </div>
  );
}
