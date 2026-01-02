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
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-8">
        {/* Header */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/20 via-purple-500/20 to-pink-500/20 rounded-2xl blur-3xl"></div>
          <div className="relative bg-gradient-to-br from-zinc-900/80 to-zinc-800/80 backdrop-blur-xl rounded-2xl border border-zinc-700/50 p-8 shadow-2xl shadow-purple-500/10 flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-zinc-100 to-zinc-200 bg-clip-text text-transparent">
                My Leave Requests
              </h1>
              <p className="text-zinc-400 mt-2">View and manage your leave requests</p>
            </div>
            <Link href="/leave-requests/new">
              <Button
                className="rounded-lg h-11 px-5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 text-white shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30 transition-all"
              >
                <Plus className="h-4 w-4" />
                New Request
              </Button>
            </Link>
          </div>
        </div>

        {/* Filters */}
        <Card className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 backdrop-blur-xl border-zinc-700/50 rounded-xl shadow-lg">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-zinc-100">
              <Filter className="h-4 w-4 text-zinc-500" />
              Filters
              {(statusFilter || typeFilter) && (
                <Badge variant="secondary" className="ml-2 bg-purple-500/20 border-purple-500/30 text-purple-300">
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
              className="px-3 py-2.5 border border-zinc-700 rounded-lg text-sm bg-zinc-800/60 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
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
              className="px-3 py-2.5 border border-zinc-700 rounded-lg text-sm bg-zinc-800/60 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
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
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
          </div>
        ) : requests.length === 0 ? (
          <div className="bg-gradient-to-br from-zinc-900/90 to-zinc-800/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-zinc-700/50 p-12 text-center">
            <p className="text-zinc-400 mb-5">No leave requests found</p>
            <Link href="/leave-requests/new">
              <Button className="rounded-lg h-11 px-5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 text-white shadow-lg shadow-purple-500/20">
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
