'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Layout from '@/components/Layout';
import LeaveRequestCard from '@/components/LeaveRequestCard';
import { leaveRequestsApi } from '@/lib/api';
import { LeaveRequest, LeaveStatus, LeaveType } from '@/types';
import { Plus, Filter } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function LeaveRequestsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<LeaveType | ''>('');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    const fetchRequests = async () => {
      if (!isAuthenticated) return;

      try {
        setLoading(true);
        const params: Record<string, string | number> = { page, limit: 10 };
        if (statusFilter) params.status = statusFilter;
        if (typeFilter) params.leaveType = typeFilter;

        const response = await leaveRequestsApi.getAll(params);
        setRequests(response.requests);
        setTotalPages(response.pagination.pages);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to load leave requests');
      } finally {
        setLoading(false);
      }
    };

    fetchRequests();
  }, [isAuthenticated, page, statusFilter, typeFilter]);

  const handleCancel = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this leave request?')) return;

    try {
      await leaveRequestsApi.cancel(id);
      setRequests(requests.map(r =>
        r._id === id ? { ...r, status: 'cancelled' as LeaveStatus } : r
      ));
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to cancel request');
    }
  };

  if (authLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-8">
        {/* Header */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 rounded-2xl blur-3xl"></div>
          <div className="relative bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/50 p-6 shadow-lg flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 bg-clip-text text-transparent">
                My Leave Requests
              </h1>
              <p className="text-slate-600 mt-2">View and manage your leave requests</p>
            </div>
            <Link href="/leave-requests/new">
              <Button
                className="rounded-xl h-11 px-5 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-md shadow-blue-500/20"
              >
                <Plus className="h-4 w-4" />
                New Request
              </Button>
            </Link>
          </div>
        </div>

        {/* Filters */}
        <Card className="bg-white/80 backdrop-blur-sm border-slate-200/50 rounded-2xl shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-slate-900">
              <Filter className="h-4 w-4 text-slate-500" />
              Filters
              {(statusFilter || typeFilter) && (
                <Badge variant="secondary" className="ml-2 bg-slate-100 border-slate-200 text-slate-700">
                  Active
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3 items-center">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as LeaveStatus | '');
                setPage(1);
              }}
              className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value as LeaveType | '');
                setPage(1);
              }}
              className="px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">All Types</option>
              <option value="annual">Annual Leave</option>
              <option value="sick">Sick Leave</option>
              <option value="personal">Personal Leave</option>
              <option value="maternity">Maternity Leave</option>
              <option value="paternity">Paternity Leave</option>
              <option value="unpaid">Unpaid Leave</option>
            </select>
          </CardContent>
        </Card>

        {/* Error message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
          </div>
        ) : requests.length === 0 ? (
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-slate-200/50 p-12 text-center">
            <p className="text-slate-600 mb-5">No leave requests found</p>
            <Link href="/leave-requests/new">
              <Button className="rounded-xl h-11 px-5 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white shadow-md shadow-blue-500/20">
                <Plus className="h-4 w-4" />
                Create Your First Request
              </Button>
            </Link>
          </div>
        ) : (
          <>
            {/* Requests list */}
            <div className="space-y-4">
              {requests.map((request) => (
                <LeaveRequestCard
                  key={request._id}
                  request={request}
                />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 bg-white"
                >
                  Previous
                </button>
                <span className="px-4 py-2 text-sm">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 bg-white"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
