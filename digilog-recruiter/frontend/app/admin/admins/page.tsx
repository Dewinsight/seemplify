"use client";

import { useState, useEffect } from 'react';
import { useAdmin } from '@/context/AdminContext';
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
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
import { Checkbox } from '@/components/ui/checkbox';
import { apiRequest } from '@/services/apiConfig';
import { 
  Search, 
  UserPlus, 
  Edit,
  Trash2,
  Key,
  UserCog,
  Shield,
  Eye,
  EyeOff
} from 'lucide-react';
import { format } from 'date-fns';

interface AdminUser {
  _id: string;
  email: string;
  name: string;
  role: 'super_admin' | 'admin' | 'support';
  permissions: {
    manageUsers: boolean;
    manageOrganizations: boolean;
    manageLicenses: boolean;
    manageBilling: boolean;
    viewAnalytics: boolean;
    systemSettings: boolean;
  };
  isActive: boolean;
  lastLogin?: string;
  createdAt: string;
}

export default function AdminManagementPage() {
  const { isSuperAdmin, admin: currentAdmin } = useAdmin();
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalAdmins, setTotalAdmins] = useState(0);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState<AdminUser | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [createForm, setCreateForm] = useState({
    email: '',
    password: '',
    name: '',
    role: 'admin' as 'super_admin' | 'admin' | 'support',
    permissions: {
      manageUsers: true,
      manageOrganizations: true,
      manageLicenses: true,
      manageBilling: false,
      viewAnalytics: true,
      systemSettings: false
    }
  });

  const [editForm, setEditForm] = useState({
    name: '',
    role: 'admin' as 'super_admin' | 'admin' | 'support',
    permissions: {
      manageUsers: false,
      manageOrganizations: false,
      manageLicenses: false,
      manageBilling: false,
      viewAnalytics: false,
      systemSettings: false
    },
    isActive: true
  });

  const [passwordForm, setPasswordForm] = useState({
    newPassword: '',
    confirmPassword: ''
  });

  useEffect(() => {
    if (isSuperAdmin()) {
      fetchAdmins();
    }
  }, [currentPage, isSuperAdmin]);

  const fetchAdmins = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('adminToken');
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: '10',
        ...(searchTerm && { search: searchTerm })
      });

      const response = await apiRequest(`/api/admin/admins?${params}`, {
        headers: {
          'x-admin-auth-token': token!
        }
      });

      if (response.ok) {
        const data = await response.json();
        setAdmins(data.admins);
        setTotalPages(data.totalPages);
        setTotalAdmins(data.totalAdmins);
      }
    } catch (error) {
      console.error('Error fetching admins:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setCurrentPage(1);
    fetchAdmins();
  };

  const handleCreateAdmin = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest('/api/admin/admins', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth-token': token!
        },
        body: JSON.stringify(createForm)
      });

      if (response.ok) {
        setShowCreateDialog(false);
        resetCreateForm();
        fetchAdmins();
      } else {
        const error = await response.json();
        alert(error.msg || 'Error creating admin');
      }
    } catch (error) {
      console.error('Error creating admin:', error);
      alert('Error creating admin');
    }
  };

  const handleEditAdmin = async () => {
    if (!selectedAdmin) return;

    try {
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest(`/api/admin/admins/${selectedAdmin._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth-token': token!
        },
        body: JSON.stringify(editForm)
      });

      if (response.ok) {
        setShowEditDialog(false);
        setSelectedAdmin(null);
        fetchAdmins();
      } else {
        const error = await response.json();
        alert(error.msg || 'Error updating admin');
      }
    } catch (error) {
      console.error('Error updating admin:', error);
      alert('Error updating admin');
    }
  };

  const handleResetPassword = async () => {
    if (!selectedAdmin || passwordForm.newPassword !== passwordForm.confirmPassword) {
      alert('Passwords do not match');
      return;
    }

    try {
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest(`/api/admin/admins/${selectedAdmin._id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth-token': token!
        },
        body: JSON.stringify({ newPassword: passwordForm.newPassword })
      });

      if (response.ok) {
        setShowPasswordDialog(false);
        setSelectedAdmin(null);
        setPasswordForm({ newPassword: '', confirmPassword: '' });
        alert('Password reset successfully');
      } else {
        const error = await response.json();
        alert(error.msg || 'Error resetting password');
      }
    } catch (error) {
      console.error('Error resetting password:', error);
      alert('Error resetting password');
    }
  };

  const handleDeactivateAdmin = async (adminId: string) => {
    if (!confirm('Are you sure you want to deactivate this admin?')) return;

    try {
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest(`/api/admin/admins/${adminId}`, {
        method: 'DELETE',
        headers: {
          'x-admin-auth-token': token!
        }
      });

      if (response.ok) {
        fetchAdmins();
      } else {
        const error = await response.json();
        alert(error.msg || 'Error deactivating admin');
      }
    } catch (error) {
      console.error('Error deactivating admin:', error);
      alert('Error deactivating admin');
    }
  };

  const openEditDialog = (admin: AdminUser) => {
    setSelectedAdmin(admin);
    setEditForm({
      name: admin.name,
      role: admin.role as 'super_admin' | 'admin' | 'support',
      permissions: admin.permissions,
      isActive: admin.isActive
    });
    setShowEditDialog(true);
  };

  const openPasswordDialog = (admin: AdminUser) => {
    setSelectedAdmin(admin);
    setPasswordForm({ newPassword: '', confirmPassword: '' });
    setShowPasswordDialog(true);
  };

  const resetCreateForm = () => {
    setCreateForm({
      email: '',
      password: '',
      name: '',
      role: 'admin',
      permissions: {
        manageUsers: true,
        manageOrganizations: true,
        manageLicenses: true,
        manageBilling: false,
        viewAnalytics: true,
        systemSettings: false
      }
    });
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'super_admin': return 'bg-gradient-to-r from-yellow-500 to-orange-500';
      case 'admin': return 'bg-blue-500';
      case 'support': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  if (!isSuperAdmin()) {
    return (
      <div className="flex h-screen bg-gray-900">
        <AdminSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <AdminHeader />
          <main className="flex-1 overflow-y-auto bg-gray-900 p-6">
            <Card className="bg-gray-800 border-gray-700 max-w-2xl mx-auto mt-8">
              <CardContent className="p-6 text-center">
                <Shield className="h-12 w-12 text-gray-500 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-white mb-2">Super Admin Access Required</h2>
                <p className="text-gray-400">You don't have permission to manage admin users.</p>
              </CardContent>
            </Card>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-900">
      <AdminSidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <AdminHeader />
        
        <main className="flex-1 overflow-y-auto bg-gray-900 p-6">
          <div className="max-w-7xl mx-auto">
            <div className="mb-8 flex justify-between items-center">
              <div>
                <h1 className="text-3xl font-bold text-white mb-2">Admin Management</h1>
                <p className="text-gray-400">Create and manage admin users</p>
              </div>
              <Button 
                onClick={() => setShowCreateDialog(true)}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Create Admin
              </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <Card className="bg-gray-800 border-gray-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-gray-400 text-sm">Total Admins</p>
                      <p className="text-2xl font-bold text-white">{totalAdmins}</p>
                    </div>
                    <UserCog className="h-8 w-8 text-blue-400" />
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-gray-800 border-gray-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-gray-400 text-sm">Active Admins</p>
                      <p className="text-2xl font-bold text-white">
                        {admins.filter(a => a.isActive).length}
                      </p>
                    </div>
                    <Shield className="h-8 w-8 text-green-400" />
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-gray-800 border-gray-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-gray-400 text-sm">Super Admins</p>
                      <p className="text-2xl font-bold text-white">
                        {admins.filter(a => a.role === 'super_admin').length}
                      </p>
                    </div>
                    <Shield className="h-8 w-8 text-yellow-400" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Search */}
            <Card className="bg-gray-800 border-gray-700 mb-6">
              <CardContent className="p-6">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                      <Input
                        placeholder="Search admins by name or email..."
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

            {/* Admins Table */}
            <Card className="bg-gray-800 border-gray-700">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-700">
                      <TableHead className="text-gray-400">Admin</TableHead>
                      <TableHead className="text-gray-400">Role</TableHead>
                      <TableHead className="text-gray-400">Permissions</TableHead>
                      <TableHead className="text-gray-400">Status</TableHead>
                      <TableHead className="text-gray-400">Created</TableHead>
                      <TableHead className="text-gray-400 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-gray-400 py-8">
                          Loading admins...
                        </TableCell>
                      </TableRow>
                    ) : admins.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-gray-400 py-8">
                          No admins found
                        </TableCell>
                      </TableRow>
                    ) : (
                      admins.map((admin) => (
                        <TableRow key={admin._id} className="border-gray-700">
                          <TableCell className="text-white">
                            <div>
                              <div className="font-medium">{admin.name}</div>
                              <div className="text-sm text-gray-400">{admin.email}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={`${getRoleBadgeColor(admin.role)} text-white`}>
                              {admin.role.replace('_', ' ').toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {admin.role === 'super_admin' ? (
                                <Badge className="bg-yellow-600 text-white text-xs">ALL</Badge>
                              ) : (
                                Object.entries(admin.permissions)
                                  .filter(([_, value]) => value)
                                  .map(([key]) => (
                                    <Badge key={key} className="bg-gray-600 text-white text-xs">
                                      {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                                    </Badge>
                                  ))
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={admin.isActive ? 'bg-green-600' : 'bg-red-600'}>
                              {admin.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-gray-300 text-sm">
                            {format(new Date(admin.createdAt), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end space-x-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openEditDialog(admin)}
                                className="text-blue-400 hover:text-blue-300"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openPasswordDialog(admin)}
                                className="text-yellow-400 hover:text-yellow-300"
                              >
                                <Key className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeactivateAdmin(admin._id)}
                                className="text-red-400 hover:text-red-300"
                                disabled={admin._id === currentAdmin?.id} // Prevent self-deletion
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
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

      {/* Create Admin Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-gray-800 border-gray-700 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Admin</DialogTitle>
            <DialogDescription className="text-gray-400">
              Create a new admin user with specific permissions
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name" className="text-gray-300">Full Name</Label>
                <Input
                  id="name"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({...createForm, name: e.target.value})}
                  className="bg-gray-700 border-gray-600"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <Label htmlFor="email" className="text-gray-300">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({...createForm, email: e.target.value})}
                  className="bg-gray-700 border-gray-600"
                  placeholder="john@company.com"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="password" className="text-gray-300">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={createForm.password}
                    onChange={(e) => setCreateForm({...createForm, password: e.target.value})}
                    className="bg-gray-700 border-gray-600 pr-10"
                    placeholder="••••••••"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-gray-400" />
                    ) : (
                      <Eye className="h-4 w-4 text-gray-400" />
                    )}
                  </Button>
                </div>
              </div>
              <div>
                <Label htmlFor="role" className="text-gray-300">Role</Label>
                <Select 
                  value={createForm.role} 
                  onValueChange={(v: 'super_admin' | 'admin' | 'support') => {
                    const newForm = {...createForm, role: v};
                    // Auto-set permissions based on role
                    if (v === 'super_admin') {
                      newForm.permissions = {
                        manageUsers: true,
                        manageOrganizations: true,
                        manageLicenses: true,
                        manageBilling: true,
                        viewAnalytics: true,
                        systemSettings: true
                      };
                    } else if (v === 'admin') {
                      newForm.permissions = {
                        manageUsers: true,
                        manageOrganizations: true,
                        manageLicenses: true,
                        manageBilling: false,
                        viewAnalytics: true,
                        systemSettings: false
                      };
                    } else if (v === 'support') {
                      newForm.permissions = {
                        manageUsers: false,
                        manageOrganizations: false,
                        manageLicenses: false,
                        manageBilling: false,
                        viewAnalytics: true,
                        systemSettings: false
                      };
                    }
                    setCreateForm(newForm);
                  }}
                >
                  <SelectTrigger className="bg-gray-700 border-gray-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="support">Support</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-gray-300 mb-3 block">Permissions</Label>
              {createForm.role === 'super_admin' ? (
                <div className="p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg">
                  <p className="text-yellow-400 text-sm mb-2">
                    <Shield className="h-4 w-4 inline mr-2" />
                    Super Admin has all permissions automatically
                  </p>
                  <div className="text-xs text-yellow-300">
                    All system permissions are granted by default for super admin role.
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(createForm.permissions).map(([key, value]) => (
                    <div key={key} className="flex items-center space-x-2">
                      <Checkbox
                        id={key}
                        checked={value}
                        onCheckedChange={(checked) => 
                          setCreateForm({
                            ...createForm,
                            permissions: {
                              ...createForm.permissions,
                              [key]: checked as boolean
                            }
                          })
                        }
                      />
                      <Label htmlFor={key} className="text-gray-300 text-sm">
                        {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} className="bg-gray-700 border-gray-600">
              Cancel
            </Button>
            <Button onClick={handleCreateAdmin} className="bg-blue-600 hover:bg-blue-700">
              Create Admin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Admin Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="bg-gray-800 border-gray-700 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Admin - {selectedAdmin?.name}</DialogTitle>
            <DialogDescription className="text-gray-400">
              Update admin information and permissions
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="editName" className="text-gray-300">Full Name</Label>
                <Input
                  id="editName"
                  value={editForm.name}
                  onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                  className="bg-gray-700 border-gray-600"
                />
              </div>
              <div>
                <Label htmlFor="editRole" className="text-gray-300">Role</Label>
                <Select 
                  value={editForm.role} 
                  onValueChange={(v: 'super_admin' | 'admin' | 'support') => {
                    const newForm = {...editForm, role: v};
                    // Auto-set permissions based on role
                    if (v === 'super_admin') {
                      newForm.permissions = {
                        manageUsers: true,
                        manageOrganizations: true,
                        manageLicenses: true,
                        manageBilling: true,
                        viewAnalytics: true,
                        systemSettings: true
                      };
                    }
                    setEditForm(newForm);
                  }}
                >
                  <SelectTrigger className="bg-gray-700 border-gray-600">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="support">Support</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-gray-300 mb-3 block">Permissions</Label>
              {editForm.role === 'super_admin' ? (
                <div className="p-4 bg-yellow-900/20 border border-yellow-700 rounded-lg">
                  <p className="text-yellow-400 text-sm mb-2">
                    <Shield className="h-4 w-4 inline mr-2" />
                    Super Admin has all permissions automatically
                  </p>
                  <div className="text-xs text-yellow-300">
                    All system permissions are granted by default for super admin role.
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(editForm.permissions).map(([key, value]) => (
                    <div key={key} className="flex items-center space-x-2">
                      <Checkbox
                        id={`edit-${key}`}
                        checked={value}
                        onCheckedChange={(checked) => 
                          setEditForm({
                            ...editForm,
                            permissions: {
                              ...editForm.permissions,
                              [key]: checked as boolean
                            }
                          })
                        }
                      />
                      <Label htmlFor={`edit-${key}`} className="text-gray-300 text-sm">
                        {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="isActive"
                checked={editForm.isActive}
                onCheckedChange={(checked) => setEditForm({...editForm, isActive: checked as boolean})}
              />
              <Label htmlFor="isActive" className="text-gray-300">
                Active
              </Label>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} className="bg-gray-700 border-gray-600">
              Cancel
            </Button>
            <Button onClick={handleEditAdmin} className="bg-blue-600 hover:bg-blue-700">
              Update Admin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent className="bg-gray-800 border-gray-700 text-white">
          <DialogHeader>
            <DialogTitle>Reset Password - {selectedAdmin?.name}</DialogTitle>
            <DialogDescription className="text-gray-400">
              Set a new password for this admin user
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="newPassword" className="text-gray-300">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                className="bg-gray-700 border-gray-600"
                placeholder="••••••••"
              />
            </div>
            <div>
              <Label htmlFor="confirmPassword" className="text-gray-300">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm({...passwordForm, confirmPassword: e.target.value})}
                className="bg-gray-700 border-gray-600"
                placeholder="••••••••"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)} className="bg-gray-700 border-gray-600">
              Cancel
            </Button>
            <Button onClick={handleResetPassword} className="bg-blue-600 hover:bg-blue-700">
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
