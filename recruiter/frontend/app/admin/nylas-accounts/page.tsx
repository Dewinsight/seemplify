'use client';

import { useState, useEffect } from 'react';
import { useAdmin } from '@/context/AdminContext';
import { 
  Plus, Check, X, Edit, Trash2, TestTube, 
  AlertCircle, Server, Activity, TrendingUp,
  Star
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';
import { NylasAccountModal } from '@/components/NylasAccountModal';
import { apiRequest } from '@/services/apiConfig';

interface NylasAccount {
  _id: string;
  name: string;
  clientId: string;
  region: string;
  maxGrants: number;
  currentGrantCount: number;
  availableSlots: number;
  utilizationPercentage: number;
  active: boolean;
  verified: boolean;
  accountType: 'production' | 'sandbox';
  priority: number;
  lastVerified?: string;
  lastUsed?: string;
  notes?: string;
  createdAt: string;
  isPreferred: boolean;
}

interface SystemCapacity {
  totalMax: number;
  totalUsed: number;
  availableSlots: number;
  accountCount: number;
  utilizationPercentage: number;
}

export default function NylasAccountsPage() {
  const { checkPermission } = useAdmin();
  const [accounts, setAccounts] = useState<NylasAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<NylasAccount | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [totalCapacity, setTotalCapacity] = useState<SystemCapacity>({
    totalMax: 0,
    totalUsed: 0,
    availableSlots: 0,
    accountCount: 0,
    utilizationPercentage: 0
  });

  // Check permission
  useEffect(() => {
    if (!checkPermission('systemSettings')) {
      window.location.href = '/admin/dashboard';
    }
  }, [checkPermission]);

  // Fetch accounts on mount
  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest('/api/admin/nylas-accounts', {
        headers: {
          'x-admin-auth-token': token!
        }
      });
      const data = await response.json();
      
      if (data.success) {
        setAccounts(data.accounts);
        setTotalCapacity(data.totalCapacity);
      }
    } catch (error: any) {
      console.error('Error fetching accounts:', error);
      toast.error('Failed to load Nylas accounts');
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async (accountId: string, accountName: string) => {
    setTestingId(accountId);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest(`/api/admin/nylas-accounts/${accountId}/test`, {
        method: 'POST',
        headers: {
          'x-admin-auth-token': token!
        }
      });
      const data = await response.json();
      
      if (data.success) {
        toast.success('✅ Connection successful!', {
          description: `Account "${accountName}" verified and ready to use`
        });
        fetchAccounts(); // Refresh to show verified status
      } else {
        toast.error('❌ Connection failed', {
          description: data.message || 'Invalid credentials'
        });
      }
    } catch (error) {
      toast.error('Test failed', {
        description: 'Network error or invalid credentials'
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (accountId: string, accountName: string) => {
    const account = accounts.find(a => a._id === accountId);
    
    if (account && account.currentGrantCount > 0) {
      toast.error('Cannot delete account with active grants', {
        description: `${account.currentGrantCount} user(s) are using this account. Revoke their grants first.`
      });
      return;
    }
    
    if (!confirm(`Delete "${accountName}"?\n\nThis action cannot be undone.`)) {
      return;
    }

    setDeletingId(accountId);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest(`/api/admin/nylas-accounts/${accountId}`, {
        method: 'DELETE',
        headers: {
          'x-admin-auth-token': token!
        }
      });

      const data = await response.json();
      
      if (data.success) {
        toast.success('Account deleted');
        fetchAccounts();
      } else {
        toast.error(data.error || 'Failed to delete account');
      }
    } catch (error) {
      toast.error('Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const handleEdit = (account: NylasAccount) => {
    setEditingAccount(account);
    setShowModal(true);
  };

  const handleAdd = () => {
    setEditingAccount(null);
    setShowModal(true);
  };

  const handleModalClose = () => {
    setShowModal(false);
    setEditingAccount(null);
  };

  const handleModalSave = () => {
    setShowModal(false);
    setEditingAccount(null);
    fetchAccounts();
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <AdminSidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <AdminHeader />
        
        <main className="flex-1 overflow-y-auto p-6">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Nylas Account Management</h1>
              <p className="text-gray-600 mt-1">Manage multiple Nylas accounts for system-wide calendar integration</p>
            </div>
            <Button onClick={handleAdd} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              Add Account
            </Button>
          </div>

          {/* Capacity Overview Card */}
          <Card className="p-6 mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 mb-1">System-Wide Capacity</p>
                <h2 className="text-4xl font-bold text-gray-900">
                  {totalCapacity.totalUsed} <span className="text-2xl text-gray-400">/ {totalCapacity.totalMax}</span>
                </h2>
                <p className="text-sm text-gray-600 mt-2">
                  grants across <strong>{totalCapacity.accountCount}</strong> account{totalCapacity.accountCount !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <TrendingUp className={`w-8 h-8 ${
                    totalCapacity.utilizationPercentage > 80 ? 'text-amber-500' : 'text-green-500'
                  }`} />
                  <div className="text-5xl font-bold text-blue-600">
                    {totalCapacity.availableSlots}
                  </div>
                </div>
                <p className="text-sm text-gray-600 mt-1">available slots</p>
              </div>
            </div>
            
            {/* Progress Bar */}
            <div className="mt-4 h-4 bg-gray-200 rounded-full overflow-hidden shadow-inner">
              <div 
                className={`h-full transition-all duration-500 ${
                  totalCapacity.utilizationPercentage > 90 ? 'bg-red-500' :
                  totalCapacity.utilizationPercentage > 75 ? 'bg-amber-500' :
                  'bg-gradient-to-r from-blue-500 to-indigo-600'
                }`}
                style={{ width: `${totalCapacity.utilizationPercentage}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2 text-right">
              {totalCapacity.utilizationPercentage}% utilized
            </p>
          </Card>

          {/* Accounts Table */}
          <Card>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold">Account</TableHead>
                    <TableHead className="font-semibold">Type</TableHead>
                    <TableHead className="font-semibold">Region</TableHead>
                    <TableHead className="font-semibold">Grants Usage</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="font-semibold">Priority</TableHead>
                    <TableHead className="text-right font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-64 text-center">
                        <div className="flex flex-col items-center justify-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-3"></div>
                          <p className="text-gray-500">Loading accounts...</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : accounts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-64">
                        <div className="flex flex-col items-center justify-center text-center">
                          <Server className="w-16 h-16 text-gray-400 mb-4" />
                          <p className="text-lg font-medium text-gray-600 mb-1">No Nylas accounts configured</p>
                          <p className="text-sm text-gray-500 mb-4">Add your first account to enable calendar integration</p>
                          <Button onClick={handleAdd} className="bg-blue-600 hover:bg-blue-700">
                            <Plus className="w-4 h-4 mr-2" />
                            Add Nylas Account
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    accounts.map((account) => (
                      <TableRow key={account._id} className="hover:bg-gray-50">
                        <TableCell>
                          <div className="flex items-center">
                            <Activity className={`w-5 h-5 mr-3 flex-shrink-0 ${
                              account.active ? 'text-green-500' : 'text-gray-400'
                            }`} />
                            <div>
                              <div className="flex items-center">
                                <span className="font-medium text-gray-900">{account.name}</span>
                                {account.isPreferred && (
                                  <div className="ml-2 group relative cursor-help">
                                    <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-48 p-2 bg-gray-800 text-xs text-white rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                      This account will be used for the next user connection based on priority and availability.
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 font-mono mt-0.5">
                                {account.clientId.substring(0, 25)}...
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={account.accountType === 'production' ? 'default' : 'secondary'}>
                            {account.accountType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-gray-600 uppercase font-medium">{account.region}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <span className={`font-semibold ${
                              account.currentGrantCount >= account.maxGrants 
                                ? 'text-red-600' 
                                : 'text-gray-900'
                            }`}>
                              {account.currentGrantCount}/{account.maxGrants}
                            </span>
                            <div className="w-24 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className={`h-full transition-all ${
                                  account.utilizationPercentage >= 100 ? 'bg-red-500' :
                                  account.utilizationPercentage >= 75 ? 'bg-amber-500' :
                                  'bg-green-500'
                                }`}
                                style={{ width: `${Math.min(account.utilizationPercentage, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500">{account.utilizationPercentage}%</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {account.verified ? (
                            <div className="flex items-center text-green-600">
                              <Check className="w-4 h-4 mr-1.5" />
                              <span className="text-sm font-medium">Verified</span>
                            </div>
                          ) : (
                            <div className="flex items-center text-amber-600">
                              <AlertCircle className="w-4 h-4 mr-1.5" />
                              <span className="text-sm font-medium">Unverified</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono">
                            {account.priority}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleTest(account._id, account.name)}
                              disabled={testingId === account._id}
                              className="border-blue-200 hover:bg-blue-50"
                            >
                              <TestTube className="w-4 h-4 mr-1.5" />
                              {testingId === account._id ? 'Testing...' : 'Test'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEdit(account)}
                              className="hover:bg-gray-100"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(account._id, account.name)}
                              disabled={deletingId === account._id}
                              className="hover:bg-red-50 text-red-600"
                            >
                              {deletingId === account._id ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Help Text */}
          {accounts.length > 0 && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="text-sm font-semibold text-blue-900 mb-2">💡 How it works</h3>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• When users connect their calendars, the system automatically selects an account with available slots</li>
                <li>• Accounts with higher priority are used first</li>
                <li>• Each account can have different grant limits (5, 10, etc.)</li>
                <li>• Total capacity = Sum of all account limits</li>
                <li>• Same auto-rotation and interview protection rules apply system-wide</li>
              </ul>
              
              <div className="mt-3 flex items-center">
                <Star className="w-4 h-4 text-amber-400 fill-amber-400 mr-2" />
                <span className="text-xs font-medium text-blue-900">
                  Star icon indicates which account will be used for the next connection
                </span>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <NylasAccountModal
          account={editingAccount}
          onClose={handleModalClose}
          onSave={handleModalSave}
        />
      )}
    </div>
  );
}
