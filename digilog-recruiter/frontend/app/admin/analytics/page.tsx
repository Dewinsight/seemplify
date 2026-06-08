"use client";

import { useAdmin } from '@/context/AdminContext';
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3 } from 'lucide-react';

export default function AdminAnalyticsPage() {
  const { checkPermission } = useAdmin();

  if (!checkPermission('viewAnalytics')) {
    return (
      <div className="flex h-screen bg-gray-900">
        <AdminSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <AdminHeader />
          <main className="flex-1 overflow-y-auto bg-gray-900 p-6">
            <Card className="bg-gray-800 border-gray-700 max-w-2xl mx-auto mt-8">
              <CardContent className="p-6 text-center">
                <BarChart3 className="h-12 w-12 text-gray-500 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-white mb-2">Access Denied</h2>
                <p className="text-gray-400">You don't have permission to view analytics.</p>
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
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white">Analytics</CardTitle>
                <CardDescription className="text-gray-400">
                  Platform analytics and insights
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-gray-300">Analytics features coming soon.</p>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
