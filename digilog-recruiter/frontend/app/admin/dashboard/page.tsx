"use client";

import { useState, useEffect } from 'react';
import { useAdmin } from '@/context/AdminContext';
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Building2, CreditCard, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react';
import { apiRequest } from '@/services/apiConfig';
import { Progress } from '@/components/ui/progress';

interface DashboardStats {
  totalUsers: number;
  totalOrganizations: number;
  activeOrganizations: number;
  planDistribution: Array<{ _id: string; count: number }>;
  recentSignups: {
    users: number;
    organizations: number;
  };
}

export default function AdminDashboard() {
  const { admin } = useAdmin();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardStats();
  }, []);

  const fetchDashboardStats = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest('/api/admin/dashboard/stats', {
        headers: {
          'x-admin-auth-token': token!
        }
      });

      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPlanColor = (plan: string) => {
    switch (plan) {
      case 'free': return 'bg-gray-500';
      case 'basic': return 'bg-blue-500';
      case 'pro': return 'bg-purple-500';
      case 'enterprise': return 'bg-gradient-to-r from-yellow-500 to-orange-500';
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
              <h1 className="text-3xl font-bold text-white">Welcome back, {admin?.name}!</h1>
              <p className="text-gray-400 mt-2">Here's an overview of your SmartHR platform</p>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
              </div>
            ) : stats ? (
              <>
                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                  <Card className="bg-gray-800 border-gray-700">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium text-gray-400">Total Users</CardTitle>
                      <Users className="h-4 w-4 text-blue-400" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-white">{stats.totalUsers}</div>
                      <p className="text-xs text-gray-500 mt-1">
                        +{stats.recentSignups.users} in last 30 days
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-gray-800 border-gray-700">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium text-gray-400">Organizations</CardTitle>
                      <Building2 className="h-4 w-4 text-purple-400" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-white">{stats.totalOrganizations}</div>
                      <p className="text-xs text-gray-500 mt-1">
                        +{stats.recentSignups.organizations} in last 30 days
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-gray-800 border-gray-700">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium text-gray-400">Active Licenses</CardTitle>
                      <CheckCircle className="h-4 w-4 text-green-400" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-white">{stats.activeOrganizations}</div>
                      <p className="text-xs text-gray-500 mt-1">
                        {Math.round((stats.activeOrganizations / stats.totalOrganizations) * 100)}% of total
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-gray-800 border-gray-700">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium text-gray-400">Revenue Status</CardTitle>
                      <CreditCard className="h-4 w-4 text-yellow-400" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold text-white">Active</div>
                      <p className="text-xs text-gray-500 mt-1">All systems operational</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Plan Distribution */}
                <Card className="bg-gray-800 border-gray-700 mb-8">
                  <CardHeader>
                    <CardTitle className="text-white">Plan Distribution</CardTitle>
                    <CardDescription className="text-gray-400">
                      Breakdown of organizations by subscription plan
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {stats.planDistribution.map((plan) => {
                        const percentage = (plan.count / stats.totalOrganizations) * 100;
                        return (
                          <div key={plan._id} className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-300 capitalize">{plan._id}</span>
                              <span className="text-gray-400">{plan.count} orgs</span>
                            </div>
                            <Progress 
                              value={percentage} 
                              className="h-2 bg-gray-700"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Quick Actions */}
                <Card className="bg-gray-800 border-gray-700">
                  <CardHeader>
                    <CardTitle className="text-white">Quick Actions</CardTitle>
                    <CardDescription className="text-gray-400">
                      Common administrative tasks
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <button className="p-4 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors text-left">
                        <h3 className="text-white font-semibold mb-1">View All Users</h3>
                        <p className="text-gray-400 text-sm">Manage user accounts and permissions</p>
                      </button>
                      <button className="p-4 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors text-left">
                        <h3 className="text-white font-semibold mb-1">Organization Licenses</h3>
                        <p className="text-gray-400 text-sm">Update plans and license keys</p>
                      </button>
                      <button className="p-4 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors text-left">
                        <h3 className="text-white font-semibold mb-1">System Settings</h3>
                        <p className="text-gray-400 text-sm">Configure platform settings</p>
                      </button>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card className="bg-gray-800 border-gray-700">
                <CardContent className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
                    <p className="text-white">Failed to load dashboard statistics</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
