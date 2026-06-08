"use client";

import { useState, useEffect } from 'react';
import { useAdmin } from '@/context/AdminContext';
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';
import { Card, CardContent } from '@/components/ui/card';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiRequest } from '@/services/apiConfig';
import { 
  Search, 
  Users, 
  Mail,
  Building2,
  Calendar,
  Shield,
  UserCheck,
  UserX,
  TrendingUp,
  Eye,
  X,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import { format } from 'date-fns';

interface User {
  _id: string;
  email: string;
  profile?: {
    firstName?: string;
    lastName?: string;
    displayName?: string;
    title?: string;
  };
  company?: {
    name?: string;
  };
  // Users no longer have subscription plans
  currentOrganization?: {
    _id: string;
    name: string;
  };
  organizationMemberships: Array<{
    organization: {
      _id: string;
      name: string;
      subscription?: {
        plan: string;
      };
    };
    role: string;
    joinedAt: string;
    isActive: boolean;
  }>;
  calendarConnected: boolean;
  isActive: boolean;
  createdAt: string;
  lastLogin?: string;
}

export default function AdminUsersPage() {
  const { checkPermission } = useAdmin();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrg, setSelectedOrg] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [userDetails, setUserDetails] = useState<any>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [forceDelete, setForceDelete] = useState(false);
  const [confirmationStage, setConfirmationStage] = useState<'initial' | 'confirm' | 'final'>('initial');
  const [typeConfirmation, setTypeConfirmation] = useState('');
  const [confirmCheckboxes, setConfirmCheckboxes] = useState({
    dataLoss: false,
    permanent: false,
    understand: false
  });
  // User plan management removed - users can create unlimited organizations

  useEffect(() => {
    fetchUsers();
  }, [currentPage, selectedOrg]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('adminToken');
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '20',
        ...(searchTerm && { search: searchTerm }),
        ...(selectedOrg !== 'all' && { organizationId: selectedOrg })
      });

      const response = await apiRequest(`/api/admin/users?${params}`, {
        headers: {
          'x-admin-auth-token': token!
        }
      });

      if (response.ok) {
        const data = await response.json();
        setUsers(data.users);
        setTotalPages(data.totalPages);
        setTotalUsers(data.totalUsers);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setCurrentPage(1);
    fetchUsers();
  };

  const handleViewDetails = async (user: User) => {
    try {
      setSelectedUser(user);
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest(`/api/admin/users/${user._id}`, {
        headers: {
          'x-admin-auth-token': token!
        }
      });

      if (response.ok) {
        const data = await response.json();
        setUserDetails(data);
        setShowDetailsDialog(true);
      }
    } catch (error) {
      console.error('Error fetching user details:', error);
    }
  };
  
  const handleDeleteUser = (user: User) => {
    setSelectedUser(user);
    setDeleteError(null);
    setForceDelete(false);
    setConfirmationStage('initial');
    setTypeConfirmation('');
    setConfirmCheckboxes({
      dataLoss: false,
      permanent: false,
      understand: false
    });
    setShowDeleteDialog(true);
  };
  
  const advanceConfirmationStage = () => {
    if (confirmationStage === 'initial') {
      // First stage - check if all confirmation checkboxes are checked
      if (!confirmCheckboxes.dataLoss || !confirmCheckboxes.permanent || !confirmCheckboxes.understand) {
        setDeleteError('Please acknowledge all warnings by checking all boxes to continue.');
        return;
      }
      setConfirmationStage('confirm');
      setDeleteError(null);
    } else if (confirmationStage === 'confirm') {
      // Second stage - check if typed confirmation matches
      if (!typeConfirmation || typeConfirmation.toLowerCase() !== 'delete') {
        setDeleteError('Please type "DELETE" in all capital letters to confirm.');
        return;
      }
      setConfirmationStage('final');
      setDeleteError(null);
    }
  };
  
  const confirmDeleteUser = async () => {
    if (!selectedUser) return;
    
    // Check which confirmation stage we're in
    if (confirmationStage === 'initial' || confirmationStage === 'confirm') {
      advanceConfirmationStage();
      return;
    }
    
    // Final stage - actual deletion
    setDeleteLoading(true);
    setDeleteError(null);
    
    try {
      const token = localStorage.getItem('adminToken');
      const forceParam = forceDelete ? '?force=true' : '';
      
      const response = await apiRequest(`/api/admin/users/${selectedUser._id}${forceParam}`, {
        method: 'DELETE',
        headers: {
          'x-admin-auth-token': token!
        }
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('User deletion result:', result);
        
        // Close dialog
        setShowDeleteDialog(false);
        
        // Update user list
        fetchUsers();
      } else {
        const errorData = await response.json();
        
        // Special handling for organization ownership errors
        if (response.status === 400 && errorData.ownsOrganizations) {
          setDeleteError(
            `This user owns ${errorData.ownedOrganizationCount} organization(s). ` +
            `Use the force delete option to delete the user and their organizations.`
          );
          // Go back to first stage if there's an error
          setConfirmationStage('initial');
        } else {
          setDeleteError(errorData.msg || 'Failed to delete user');
          setConfirmationStage('initial');
        }
      }
    } catch (error: any) {
      setDeleteError(error.message || 'An unexpected error occurred');
      console.error('Error deleting user:', error);
      setConfirmationStage('initial');
    } finally {
      setDeleteLoading(false);
    }
  };

  // User plan management removed - users can create unlimited organizations

  const getUserRoleBadge = (role: string) => {
    const roleColors: Record<string, string> = {
      owner: 'bg-gradient-to-r from-yellow-500 to-orange-500',
      admin: 'bg-blue-500',
      hr_manager: 'bg-purple-500',
      recruiter: 'bg-green-500',
      interviewer: 'bg-gray-500'
    };
    
    return (
      <Badge className={`${roleColors[role] || 'bg-gray-500'} text-white text-xs`}>
        {role.replace('_', ' ')}
      </Badge>
    );
  };

  // User plan badges removed - users no longer have subscription plans

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

  return (
    <div className="flex h-screen bg-gray-900">
      <AdminSidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <AdminHeader />
        
        <main className="flex-1 overflow-y-auto bg-gray-900 p-6">
          <div className="max-w-7xl mx-auto">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-white mb-2">Users</h1>
              <p className="text-gray-400">Manage all user accounts and their organization memberships</p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <Card className="bg-gray-800 border-gray-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-gray-400 text-sm">Total Users</p>
                      <p className="text-2xl font-bold text-white">{totalUsers}</p>
                    </div>
                    <Users className="h-8 w-8 text-blue-400" />
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-gray-800 border-gray-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-gray-400 text-sm">Active Users</p>
                      <p className="text-2xl font-bold text-white">
                        {users.filter(u => u.isActive).length}
                      </p>
                    </div>
                    <UserCheck className="h-8 w-8 text-green-400" />
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-gray-800 border-gray-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-gray-400 text-sm">With Organizations</p>
                      <p className="text-2xl font-bold text-white">
                        {users.filter(u => u.organizationMemberships.length > 0).length}
                      </p>
                    </div>
                    <Building2 className="h-8 w-8 text-purple-400" />
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-gray-800 border-gray-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-gray-400 text-sm">Calendar Connected</p>
                      <p className="text-2xl font-bold text-white">
                        {users.filter(u => u.calendarConnected).length}
                      </p>
                    </div>
                    <Calendar className="h-8 w-8 text-yellow-400" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Filters */}
            <Card className="bg-gray-800 border-gray-700 mb-6">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                      <Input
                        placeholder="Search by email, name, or company..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                        className="pl-10 bg-gray-700 border-gray-600 text-white"
                      />
                    </div>
                  </div>
                  
                  <Button onClick={handleSearch} className="bg-blue-600 hover:bg-blue-700">
                    Search
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Users Table */}
            <Card className="bg-gray-800 border-gray-700">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-700">
                      <TableHead className="text-gray-400">User</TableHead>
                      <TableHead className="text-gray-400">Organizations</TableHead>
                      <TableHead className="text-gray-400">Organizations</TableHead>
                      <TableHead className="text-gray-400">Status</TableHead>
                      <TableHead className="text-gray-400">Calendar</TableHead>
                      <TableHead className="text-gray-400">Joined</TableHead>
                      <TableHead className="text-gray-400 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                                              <TableRow>
                        <TableCell colSpan={7} className="text-center text-gray-400 py-8">
                          Loading users...
                        </TableCell>
                      </TableRow>
                    ) : users.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-gray-400 py-8">
                          No users found
                        </TableCell>
                      </TableRow>
                    ) : (
                      users.map((user) => (
                        <TableRow key={user._id} className="border-gray-700">
                          <TableCell className="text-white">
                            <div>
                              <div className="font-medium">
                                {user.profile?.firstName || user.profile?.displayName || 'Unknown User'}
                                {user.profile?.lastName && ` ${user.profile.lastName}`}
                              </div>
                              <div className="text-sm text-gray-400 flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                {user.email}
                              </div>
                              {user.profile?.title && (
                                <div className="text-xs text-gray-500 mt-1">{user.profile.title}</div>
                              )}
                              {user.company?.name && (
                                <div className="text-xs text-gray-500">{user.company.name}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-gray-300">
                              {user.organizationMemberships.length} organization{user.organizationMemberships.length !== 1 ? 's' : ''}
                            </div>
                          </TableCell>
                          <TableCell>
                            {user.organizationMemberships.length > 0 ? (
                              <div className="space-y-1">
                                {user.organizationMemberships.slice(0, 2).map((membership) => (
                                  <div key={membership.organization._id} className="flex items-center gap-2">
                                    <span className="text-sm text-gray-300">
                                      {membership.organization.name}
                                    </span>
                                    {getUserRoleBadge(membership.role)}
                                    {membership.organization.subscription?.plan && 
                                      <Badge className="bg-green-600 text-white text-xs">
                                        {membership.organization.subscription.plan}
                                      </Badge>}
                                  </div>
                                ))}
                                {user.organizationMemberships.length > 2 && (
                                  <div className="text-xs text-gray-500">
                                    +{user.organizationMemberships.length - 2} more
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-500 text-sm">No organizations</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge className={user.isActive ? 'bg-green-600' : 'bg-red-600'}>
                              {user.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {user.calendarConnected ? (
                              <Badge className="bg-blue-600">Connected</Badge>
                            ) : (
                              <Badge className="bg-gray-600">Not Connected</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-gray-300 text-sm">
                            {format(new Date(user.createdAt), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end space-x-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleViewDetails(user)}
                                className="text-blue-400 hover:text-blue-300"
                              >
                                View Details
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeleteUser(user)}
                                className="text-red-400 hover:text-red-300"
                              >
                                Remove User
                              </Button>
                              {/* User plan upgrade removed - users have unlimited organization creation */}
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

      {/* User Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="bg-gray-800 border-gray-700 text-white max-w-3xl">
          <DialogHeader>
            <DialogTitle>User Details - {selectedUser?.email}</DialogTitle>
            <DialogDescription className="text-gray-400">
              Detailed information about this user
            </DialogDescription>
          </DialogHeader>
          
          {userDetails && (
            <div className="space-y-4 max-h-96 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-gray-300">Email</Label>
                  <p className="text-white">{userDetails.email}</p>
                </div>
                <div>
                  <Label className="text-gray-300">Name</Label>
                  <p className="text-white">
                    {userDetails.profile?.firstName} {userDetails.profile?.lastName || 'N/A'}
                  </p>
                </div>
                <div>
                  <Label className="text-gray-300">Organization Creation</Label>
                  <div className="mt-1 text-green-400">Unlimited</div>
                </div>
                <div>
                  <Label className="text-gray-300">Organizations Owned</Label>
                  <p className="text-white">
                    {userDetails.organizationStats?.currentOwnedOrganizations || 0} (No limit)
                  </p>
                </div>
              </div>
              
              <div>
                <Label className="text-gray-300">Organization Memberships</Label>
                <div className="mt-2 space-y-2">
                  {userDetails.organizationMemberships?.map((membership: any) => (
                    <div key={membership.organization._id} className="flex items-center justify-between p-2 bg-gray-700 rounded">
                      <div>
                        <span className="text-white">{membership.organization.name}</span>
                        <div className="text-xs text-gray-400">
                          {getRoleLabel(membership.role)} • Joined {format(new Date(membership.joinedAt), 'MMM d, yyyy')}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getUserRoleBadge(membership.role)}
                        {membership.organization.subscription?.plan && 
                          <Badge className="bg-green-600 text-white text-xs">
                            {membership.organization.subscription.plan}
                          </Badge>}
                      </div>
                    </div>
                  )) || <p className="text-gray-400">No organization memberships</p>}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-gray-300">Calendar Connected</Label>
                  <p className="text-white">{userDetails.calendarConnected ? 'Yes' : 'No'}</p>
                </div>
                <div>
                  <Label className="text-gray-300">Account Status</Label>
                  <p className="text-white">{userDetails.isActive ? 'Active' : 'Inactive'}</p>
                </div>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowDetailsDialog(false)}
              className="bg-gray-700 border-gray-600"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User Plan Upgrade Dialog removed - users can create unlimited organizations */}
      
      {/* Delete User Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="bg-gray-800 border-gray-700 text-white">
          <DialogHeader>
            <DialogTitle className="text-red-400">
              <div className="flex items-center gap-2">
                <UserX className="h-5 w-5" />
                {confirmationStage === 'initial' ? 'Remove User' : 
                 confirmationStage === 'confirm' ? 'Confirm Deletion' : 'Final Confirmation'}
              </div>
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              {confirmationStage === 'initial' ? 
                'This will permanently remove the user from the system, allowing them to register again with the same email.' :
               confirmationStage === 'confirm' ? 
                'Please type "DELETE" to confirm you want to remove this user.' :
                'Are you absolutely certain you want to delete this user? This is your last chance to cancel.'}
            </DialogDescription>
          </DialogHeader>
          
          {selectedUser && (
            <div className="space-y-4">
              <div className="bg-gray-700 p-4 rounded-md">
                <div className="font-medium text-white">
                  {selectedUser.profile?.firstName || ''} {selectedUser.profile?.lastName || ''}
                </div>
                <div className="text-gray-300">{selectedUser.email}</div>
                {confirmationStage !== 'initial' && (
                  <div className="text-yellow-300 text-xs mt-2">
                    Account ID: {selectedUser._id}
                  </div>
                )}
              </div>
              
              {/* Stage 1: Initial warnings and confirmations */}
              {confirmationStage === 'initial' && (
                <>
                  <div className="bg-red-900/30 border border-red-700 p-4 rounded-md text-sm text-red-300">
                    <p className="font-medium mb-1">Warning:</p>
                    <p>This action cannot be undone. The user will lose access to all their data and organizations they own.</p>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox" 
                        id="dataLoss"
                        checked={confirmCheckboxes.dataLoss} 
                        onChange={e => setConfirmCheckboxes({...confirmCheckboxes, dataLoss: e.target.checked})}
                        className="rounded bg-gray-700 border-gray-600 text-blue-600"
                      />
                      <label htmlFor="dataLoss" className="text-sm text-gray-300">
                        I understand that all user data will be permanently lost
                      </label>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox" 
                        id="permanent"
                        checked={confirmCheckboxes.permanent} 
                        onChange={e => setConfirmCheckboxes({...confirmCheckboxes, permanent: e.target.checked})}
                        className="rounded bg-gray-700 border-gray-600 text-blue-600"
                      />
                      <label htmlFor="permanent" className="text-sm text-gray-300">
                        I understand this action cannot be undone
                      </label>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox" 
                        id="understand"
                        checked={confirmCheckboxes.understand} 
                        onChange={e => setConfirmCheckboxes({...confirmCheckboxes, understand: e.target.checked})}
                        className="rounded bg-gray-700 border-gray-600 text-blue-600"
                      />
                      <label htmlFor="understand" className="text-sm text-gray-300">
                        I understand I am about to remove the user "{selectedUser.email}"
                      </label>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="forceDelete"
                      checked={forceDelete} 
                      onChange={e => setForceDelete(e.target.checked)}
                      className="rounded bg-gray-700 border-gray-600 text-blue-600"
                    />
                    <label htmlFor="forceDelete" className="text-sm text-gray-300">
                      Force delete and remove all organizations owned by this user
                    </label>
                  </div>
                </>
              )}
              
              {/* Stage 2: Type "DELETE" to confirm */}
              {confirmationStage === 'confirm' && (
                <div className="space-y-3">
                  <div className="bg-yellow-900/30 border border-yellow-700 p-4 rounded-md text-sm text-yellow-300">
                    <p className="font-medium mb-1">Security Check:</p>
                    <p>Type "DELETE" in the field below to confirm this action.</p>
                  </div>
                  
                  <div className="space-y-1">
                    <label htmlFor="deleteConfirmation" className="text-sm text-gray-300">Type "DELETE":</label>
                    <input 
                      type="text" 
                      id="deleteConfirmation"
                      value={typeConfirmation}
                      onChange={e => setTypeConfirmation(e.target.value)}
                      className="w-full rounded bg-gray-700 border-gray-600 text-white"
                      placeholder="DELETE"
                      autoComplete="off"
                    />
                  </div>
                </div>
              )}
              
              {/* Stage 3: Final confirmation */}
              {confirmationStage === 'final' && (
                <div className="bg-red-900/30 border-2 border-red-700 p-4 rounded-md text-sm text-red-300">
                  <p className="font-bold mb-2 text-red-400 uppercase">Final Warning:</p>
                  <p>You are about to permanently delete this user account. This will:</p>
                  <ul className="list-disc pl-5 mt-2 space-y-1">
                    <li>Permanently delete the user account</li>
                    <li>Remove all associated data</li>
                    {forceDelete && <li>Delete all organizations owned by this user</li>}
                    <li>Allow the email to be reused for registration</li>
                  </ul>
                  <p className="mt-3 font-bold">Press "CONFIRM DELETE" to proceed.</p>
                </div>
              )}
              
              {/* Error Message Display */}
              {deleteError && (
                <div className="bg-red-900/30 border border-red-700 p-4 rounded-md text-sm text-red-300">
                  <p className="font-medium mb-1">Error:</p>
                  <p>{deleteError}</p>
                </div>
              )}
            </div>
          )}
          
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowDeleteDialog(false)}
              className="bg-gray-700 border-gray-600"
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={confirmDeleteUser}
              className={`${
                confirmationStage === 'final' 
                  ? 'bg-red-700 hover:bg-red-800 border-2 border-red-500' 
                  : 'bg-red-600 hover:bg-red-700'
              }`}
              disabled={deleteLoading}
            >
              {deleteLoading ? "Removing..." : 
               confirmationStage === 'initial' ? "Continue" :
               confirmationStage === 'confirm' ? "Next" : 
               "CONFIRM DELETE"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
