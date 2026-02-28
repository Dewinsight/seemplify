"use client";

import { useState, useEffect } from 'react';
import { useAdmin } from '@/context/AdminContext';
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { apiRequest } from '@/services/apiConfig';
import { 
  Calendar,
  RefreshCw,
  Unlink,
  AlertCircle,
  CheckCircle2,
  Clock,
  Users
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface Grant {
  userId: string;
  userName: string;
  email: string;
  provider: 'google' | 'outlook' | 'yahoo' | 'microsoft';
  grantId: string;
  nylasAccountId?: string;
  nylasAccountName?: string;
  status: 'active' | 'invalid' | 'revoked';
  connectedAt: string;
  lastRefresh?: string;
  ageInDays: number;
}

interface GrantStats {
  currentCount: number;
  maxAllowed: number;
  availableSlots: number;
  utilizationPercentage: number;
  atLimit: boolean;
  accountCount?: number;
  grants: Grant[];
  oldestGrant: Grant | null;
  newestGrant: Grant | null;
}

export default function AdminGrantsPage() {
  const { checkPermission } = useAdmin();
  const [grants, setGrants] = useState<Grant[]>([]);
  const [stats, setStats] = useState<GrantStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [selectedGrant, setSelectedGrant] = useState<Grant | null>(null);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [revoking, setRevoking] = useState(false);

  // Check admin permission
  useEffect(() => {
    if (!checkPermission('systemSettings')) {
      window.location.href = '/admin/dashboard';
    }
  }, [checkPermission]);

  // Fetch grants on mount
  useEffect(() => {
    fetchGrants();
  }, []);

  const fetchGrants = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest('/api/admin/grants', {
        headers: {
          'x-admin-auth-token': token!
        }
      });
      const data = await response.json();
      
      if (data.success) {
        setGrants(data.grants || []);
        setStats(data.stats || null);
      }
    } catch (error: any) {
      console.error('Error fetching grants:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchGrants();
    setRefreshing(false);
  };

  const handleVerifyAll = async () => {
    try {
      setVerifying(true);
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest('/api/admin/grants/verify-all', {
        method: 'POST',
        headers: {
          'x-admin-auth-token': token!
        }
      });
      const data = await response.json();
      
      if (data.success) {
        // Refresh the grants list after verification
        await fetchGrants();
        alert(`Verification complete: ${data.verification.valid} valid, ${data.verification.invalid} invalid`);
      }
    } catch (error: any) {
      console.error('Error verifying grants:', error);
      alert('Failed to verify grants: ' + error.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleRevokeClick = (grant: Grant) => {
    setSelectedGrant(grant);
    setShowRevokeDialog(true);
  };

  const handleRevokeConfirm = async () => {
    if (!selectedGrant) return;

    try {
      setRevoking(true);
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest(`/api/admin/grants/${selectedGrant.userId}`, {
        method: 'DELETE',
        headers: {
          'x-admin-auth-token': token!
        }
      });
      const data = await response.json();
      
      if (data.success) {
        // Refresh the grants list
        await fetchGrants();
        setShowRevokeDialog(false);
        setSelectedGrant(null);
        alert(`Calendar disconnected for ${selectedGrant.email}`);
      }
    } catch (error: any) {
      console.error('Error revoking grant:', error);
      alert('Failed to revoke grant: ' + error.message);
    } finally {
      setRevoking(false);
    }
  };

  const getProviderBadge = (provider: string) => {
    const colors: Record<string, string> = {
      google: 'bg-blue-500',
      outlook: 'bg-indigo-500',
      microsoft: 'bg-indigo-500',
      yahoo: 'bg-purple-500'
    };
    return colors[provider.toLowerCase()] || 'bg-gray-500';
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { color: string; icon: any }> = {
      active: { color: 'bg-green-500', icon: CheckCircle2 },
      invalid: { color: 'bg-red-500', icon: AlertCircle },
      revoked: { color: 'bg-gray-500', icon: Unlink }
    };
    const { color, icon: Icon } = config[status] || config.active;
    return (
      <Badge className={`${color} text-white`}>
        <Icon className="w-3 h-3 mr-1" />
        {status}
      </Badge>
    );
  };

  const getUtilizationColor = (percentage: number) => {
    if (percentage < 60) return 'text-green-500';
    if (percentage < 80) return 'text-yellow-500';
    return 'text-red-500';
  };

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-50">
        <AdminSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <AdminHeader />
          <main className="flex-1 overflow-y-auto p-8">
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
                <p className="text-gray-600">Loading grants...</p>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <AdminSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Calendar Connections</h1>
            <p className="text-gray-600">Manage Nylas calendar grants for your organization</p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            {/* Grant Usage Card */}
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Grant Usage</span>
                  <Calendar className="w-5 h-5 text-blue-600" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-4xl font-bold ${getUtilizationColor(stats?.utilizationPercentage || 0)}`}>
                      {stats?.currentCount || 0}
                    </span>
                    <span className="text-2xl text-gray-500">/ {stats?.maxAllowed || 5}</span>
                    <span className="text-sm text-gray-500">
                      {stats?.accountCount ? `across ${stats.accountCount} account${stats.accountCount !== 1 ? 's' : ''}` : 'slots used'}
                    </span>
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className={`h-3 rounded-full transition-all ${
                        (stats?.utilizationPercentage || 0) >= 80 ? 'bg-red-500' :
                        (stats?.utilizationPercentage || 0) >= 60 ? 'bg-yellow-500' :
                        'bg-green-500'
                      }`}
                      style={{ width: `${stats?.utilizationPercentage || 0}%` }}
                    />
                  </div>

                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">
                      {stats?.availableSlots || 0} slot{stats?.availableSlots !== 1 ? 's' : ''} available
                    </span>
                    <span className={`font-medium ${getUtilizationColor(stats?.utilizationPercentage || 0)}`}>
                      {stats?.utilizationPercentage || 0}% utilized
                    </span>
                  </div>

                  {stats?.atLimit && (
                    <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>At grant limit. Next connection will auto-remove oldest grant.</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Active Connections Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Active</span>
                  <Users className="w-5 h-5 text-green-600" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600">
                  {grants.filter(g => g.status === 'active').length}
                </div>
                <p className="text-sm text-gray-600 mt-1">Connected calendars</p>
              </CardContent>
            </Card>

            {/* Oldest Grant Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Oldest</span>
                  <Clock className="w-5 h-5 text-blue-600" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-600">
                  {stats?.oldestGrant?.ageInDays || 0}
                </div>
                <p className="text-sm text-gray-600 mt-1">days old</p>
                {stats?.oldestGrant && (
                  <p className="text-xs text-gray-500 mt-2 truncate">
                    {stats.oldestGrant.userName}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mb-6">
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              variant="outline"
              className="flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              onClick={handleVerifyAll}
              disabled={verifying || grants.length === 0}
              variant="outline"
              className="flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              {verifying ? 'Verifying...' : 'Verify All Grants'}
            </Button>
          </div>

          {/* Grants Table */}
          <Card>
            <CardHeader>
              <CardTitle>Calendar Connections ({grants.length})</CardTitle>
              <CardDescription>
                Manage calendar grants for users in your organization
              </CardDescription>
            </CardHeader>
            <CardContent>
              {grants.length === 0 ? (
                <div className="text-center py-12">
                  <Calendar className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No Calendar Connections</h3>
                  <p className="text-gray-600">No users have connected their calendars yet.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Nylas Account</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Connected</TableHead>
                        <TableHead>Age</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {grants.map((grant) => (
                        <TableRow key={grant.userId}>
                          <TableCell className="font-medium">{grant.userName}</TableCell>
                          <TableCell className="text-gray-600">{grant.email}</TableCell>
                          <TableCell>
                            <Badge className={`${getProviderBadge(grant.provider)} text-white`}>
                              {grant.provider}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-gray-700 font-medium">
                              {grant.nylasAccountName || 'Default Account'}
                            </span>
                          </TableCell>
                          <TableCell>{getStatusBadge(grant.status)}</TableCell>
                          <TableCell className="text-sm text-gray-600">
                            {grant.connectedAt ? (
                              <>
                                {format(new Date(grant.connectedAt), 'MMM d, yyyy')}
                                <div className="text-xs text-gray-400">
                                  {formatDistanceToNow(new Date(grant.connectedAt), { addSuffix: true })}
                                </div>
                              </>
                            ) : (
                              <span className="text-gray-400">N/A</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className={`text-sm font-medium ${
                              (grant.ageInDays ?? 0) > 30 ? 'text-amber-600' : 'text-gray-600'
                            }`}>
                              {grant.ageInDays ?? 0} days
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              onClick={() => handleRevokeClick(grant)}
                              variant="destructive"
                              size="sm"
                              className="flex items-center gap-1"
                            >
                              <Unlink className="w-3 h-3" />
                              Revoke
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>

      {/* Revoke Confirmation Dialog */}
      <AlertDialog 
        open={showRevokeDialog && !!selectedGrant} 
        onOpenChange={(open) => {
          if (!open && !revoking) {
            setShowRevokeDialog(false);
            setSelectedGrant(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              Disconnect Calendar
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                Are you sure you want to disconnect the calendar for <strong>{selectedGrant?.userName}</strong> ({selectedGrant?.email})?
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-sm text-amber-800">
                  <strong>This action will:</strong>
                </p>
                <ul className="text-sm text-amber-700 mt-2 space-y-1 list-disc list-inside">
                  <li>Revoke the grant in Nylas</li>
                  <li>Clear the user's calendar connection</li>
                  <li>Free up one grant slot</li>
                  <li>User can reconnect anytime</li>
                </ul>
              </div>
              <p className="text-sm text-gray-600">
                Connected <strong>{selectedGrant?.ageInDays}</strong> days ago via <strong>{selectedGrant?.provider}</strong>.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              disabled={revoking}
              onClick={() => {
                setShowRevokeDialog(false);
                setSelectedGrant(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevokeConfirm}
              disabled={revoking}
              className="bg-red-600 hover:bg-red-700"
            >
              {revoking ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Revoking...
                </>
              ) : (
                <>
                  <Unlink className="w-4 h-4 mr-2" />
                  Disconnect Calendar
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
