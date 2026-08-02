"use client";

import { useState } from 'react';
import AdminResponsiveLayout from '@/components/AdminResponsiveLayout';
import AdminResponsiveGrid, { AdminResponsiveCard } from '@/components/AdminResponsiveGrid';
import AdminResponsiveTable, { Column } from '@/components/AdminResponsiveTable';
import AdminResponsiveDialog from '@/components/AdminResponsiveDialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { 
  LayoutDashboard, 
  Users, 
  Building2, 
  Calendar,
  Mail,
  Info
} from 'lucide-react';

// Sample data types
interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  organization?: {
    name: string;
  };
  createdAt: string;
  lastLoginAt?: string;
  status: 'active' | 'inactive';
}

interface Stat {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  change?: number;
  color: string;
}

// Example implementation using all responsive components
export default function ResponsiveExample() {
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  
  // Sample users data
  const users: User[] = [
    {
      id: '1',
      name: 'John Smith',
      email: 'john@example.com',
      role: 'Admin',
      organization: { name: 'Acme Inc' },
      createdAt: '2023-05-15T12:00:00Z',
      lastLoginAt: '2023-10-16T08:30:00Z',
      status: 'active'
    },
    {
      id: '2',
      name: 'Sarah Johnson',
      email: 'sarah@example.com',
      role: 'Manager',
      organization: { name: 'Global Corp' },
      createdAt: '2023-06-22T09:15:00Z',
      lastLoginAt: '2023-10-15T14:22:00Z',
      status: 'active'
    },
    {
      id: '3',
      name: 'Robert Williams',
      email: 'robert@example.com',
      role: 'User',
      organization: { name: 'Tech Systems' },
      createdAt: '2023-07-08T16:45:00Z',
      status: 'inactive'
    },
    {
      id: '4',
      name: 'Emma Davis',
      email: 'emma@example.com',
      role: 'Manager',
      organization: { name: 'Acme Inc' },
      createdAt: '2023-08-12T11:30:00Z',
      lastLoginAt: '2023-10-14T09:12:00Z',
      status: 'active'
    },
    {
      id: '5',
      name: 'Michael Brown',
      email: 'michael@example.com',
      role: 'Admin',
      organization: { name: 'Global Corp' },
      createdAt: '2023-09-05T14:20:00Z',
      lastLoginAt: '2023-10-16T10:45:00Z',
      status: 'active'
    }
  ];

  // Sample stats data
  const stats: Stat[] = [
    { 
      title: 'Total Users', 
      value: 1248, 
      icon: <Users className="h-5 w-5" />, 
      change: 12,
      color: 'from-[#754BE5] to-[#6935CF]'
    },
    { 
      title: 'Organizations', 
      value: 84, 
      icon: <Building2 className="h-5 w-5" />, 
      change: 3,
      color: 'from-purple-500 to-purple-600'
    },
    { 
      title: 'Active Sessions', 
      value: 357, 
      icon: <Calendar className="h-5 w-5" />, 
      change: -5,
      color: 'from-green-500 to-green-600'
    },
    { 
      title: 'Messages', 
      value: '1.2K', 
      icon: <Mail className="h-5 w-5" />, 
      change: 8,
      color: 'from-amber-500 to-amber-600'
    }
  ];
  
  // Table column definitions
  const columns: Column<User>[] = [
    {
      header: 'Name',
      accessorKey: 'name',
      enableSorting: true,
      priority: 'high',
      cell: (user) => (
        <div className="font-medium">{user.name}</div>
      ),
    },
    {
      header: 'Email',
      accessorKey: 'email',
      priority: 'medium',
      cell: (user) => (
        <div className="text-sm text-gray-400">{user.email}</div>
      ),
    },
    {
      header: 'Role',
      accessorKey: 'role',
      priority: 'medium',
      cell: (user) => (
        <Badge className={
          user.role === 'Admin' ? 'bg-blue-600' : 
          user.role === 'Manager' ? 'bg-purple-600' : 
          'bg-gray-600'
        }>
          {user.role}
        </Badge>
      ),
    },
    {
      header: 'Organization',
      accessorKey: 'organization.name',
      priority: 'low',
      cell: (user) => (
        <span>{user.organization?.name || '—'}</span>
      ),
    },
    {
      header: 'Status',
      accessorKey: 'status',
      priority: 'high',
      cell: (user) => (
        <Badge className={user.status === 'active' ? 'bg-green-600' : 'bg-red-600'}>
          {user.status}
        </Badge>
      ),
    },
    {
      header: 'Actions',
      accessorKey: 'actions',
      priority: 'high',
      cell: (user) => (
        <Button 
          variant="ghost"
          size="sm"
          className="text-blue-400 hover:text-blue-300"
          onClick={() => {
            setSelectedUser(user);
            setDetailsDialogOpen(true);
          }}
        >
          View Details
        </Button>
      ),
    },
  ];
  
  const handleSearch = (searchTerm: string) => {
    console.log('Searching for:', searchTerm);
    // Implement actual search functionality here
  };

  return (
    <AdminResponsiveLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Dashboard</h1>
          <p className="text-gray-400">Welcome to your responsive admin dashboard</p>
        </div>
        
        {/* Stats Grid */}
        <AdminResponsiveGrid 
          columns={{ sm: 1, md: 2, lg: 2, xl: 4 }}
          gap="md"
        >
          {stats.map((stat, index) => (
            <AdminResponsiveCard key={index}>
              <Card className="bg-gray-800 border-gray-700 overflow-hidden">
                <CardContent className="p-6">
                  <div className="flex justify-between items-center">
                    <div className="space-y-1">
                      <p className="text-sm text-gray-400">{stat.title}</p>
                      <p className="text-2xl font-bold text-white">{stat.value}</p>
                      {stat.change !== undefined && (
                        <p className={`text-xs ${stat.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {stat.change >= 0 ? '+' : ''}{stat.change}% from last month
                        </p>
                      )}
                    </div>
                    <div className={`bg-gradient-to-br ${stat.color} p-3 rounded-lg text-white`}>
                      {stat.icon}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </AdminResponsiveCard>
          ))}
        </AdminResponsiveGrid>
        
        {/* Users Table */}
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-6">
            <h2 className="text-xl font-bold text-white mb-4">Recent Users</h2>
            <AdminResponsiveTable
              data={users}
              columns={columns}
              searchPlaceholder="Search users..."
              onSearch={handleSearch}
              pagination={{
                currentPage: 1,
                totalPages: 1,
                onPageChange: (page) => console.log('Page changed:', page)
              }}
            />
          </CardContent>
        </Card>
        
        {/* Mixed Content Area */}
        <AdminResponsiveGrid columns={{ sm: 1, md: 2, lg: 2 }} gap="lg">
          <AdminResponsiveCard colSpan={{ lg: 1 }}>
            <Card className="bg-gray-800 border-gray-700 h-full">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Important Information</h3>
                <div className="prose prose-invert max-w-none">
                  <p>This is an example of mixed content layout that adapts well to all screen sizes.</p>
                  <p>The responsive components ensure content is properly displayed on:</p>
                  <ul>
                    <li>Mobile devices (portrait/landscape)</li>
                    <li>Tablets</li>
                    <li>Desktop screens of all sizes</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </AdminResponsiveCard>
          
          <AdminResponsiveCard colSpan={{ lg: 1 }}>
            <Card className="bg-gray-800 border-gray-700 h-full">
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Button className="bg-blue-600 hover:bg-blue-700 w-full">
                    Add User
                  </Button>
                  <Button className="bg-purple-600 hover:bg-purple-700 w-full">
                    New Organization
                  </Button>
                  <Button className="bg-green-600 hover:bg-green-700 w-full">
                    Generate Report
                  </Button>
                  <Button className="bg-amber-600 hover:bg-amber-700 w-full">
                    View Analytics
                  </Button>
                </div>
              </CardContent>
            </Card>
          </AdminResponsiveCard>
        </AdminResponsiveGrid>
      </div>
      
      {/* Responsive Dialog Example */}
      <AdminResponsiveDialog
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        title="User Details"
        description={selectedUser?.email}
        fullScreenOnMobile={true}
        footer={
          <>
            <Button 
              variant="outline" 
              onClick={() => setDetailsDialogOpen(false)}
              className="bg-gray-700 border-gray-600 sm:ml-2 w-full sm:w-auto"
            >
              Close
            </Button>
            <Button 
              className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
            >
              Edit User
            </Button>
          </>
        }
      >
        {selectedUser && (
          <div className="space-y-4">
            <div className="bg-gray-700 p-4 rounded-md flex items-center space-x-4">
              <div className="h-16 w-16 rounded-full bg-gradient-to-br from-[#754BE5] to-[#6935CF] flex items-center justify-center text-white text-2xl font-bold">
                {selectedUser.name.charAt(0)}
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">{selectedUser.name}</h3>
                <p className="text-gray-300">{selectedUser.role} • {selectedUser.organization?.name}</p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-400">Email</label>
                <p className="text-white">{selectedUser.email}</p>
              </div>
              <div>
                <label className="text-sm text-gray-400">Status</label>
                <p>
                  <Badge className={selectedUser.status === 'active' ? 'bg-green-600' : 'bg-red-600'}>
                    {selectedUser.status}
                  </Badge>
                </p>
              </div>
              <div>
                <label className="text-sm text-gray-400">Created</label>
                <p className="text-white">{format(new Date(selectedUser.createdAt), 'PPP')}</p>
              </div>
              <div>
                <label className="text-sm text-gray-400">Last Login</label>
                <p className="text-white">
                  {selectedUser.lastLoginAt 
                    ? format(new Date(selectedUser.lastLoginAt), 'PPP') 
                    : 'Never'}
                </p>
              </div>
            </div>
            
            <div className="bg-blue-900/20 border border-blue-800/30 rounded-md p-4 flex items-start space-x-3">
              <Info className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-300">
                <p>This user interface is fully responsive and adapts to all screen sizes.</p>
                <p className="mt-2">Try resizing your browser window to see how it responds!</p>
              </div>
            </div>
          </div>
        )}
      </AdminResponsiveDialog>
    </AdminResponsiveLayout>
  );
}
