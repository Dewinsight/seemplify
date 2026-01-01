'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Layout from '@/components/Layout';
import LeaveRequestCard from '@/components/LeaveRequestCard';
import { leaveRequestsApi } from '@/lib/api';
import { LeaveRequest } from '@/types';
import { AlertCircle, Filter, Users, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';

export default function AdminPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState({
    status: '',
    leaveType: '',
    teamId: '',
    startDate: '',
    endDate: '',
  });

  // For reject dialog
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

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
        const params: Record<string, string | number> = { page, limit: 20 };
        
        if (filters.status) params.status = filters.status;
        if (filters.leaveType) params.leaveType = filters.leaveType;
        if (filters.teamId) params.teamId = filters.teamId;
        if (filters.startDate) params.startDate = filters.startDate;
        if (filters.endDate) params.endDate = filters.endDate;

        const response = await leaveRequestsApi.getAllAdmin(params);
        setRequests(response.requests);
        setTotalPages(response.pagination.pages);
      } catch (err: any) {
        if (err.response?.status === 403) {
          setError('You do not have permission to view all leave requests. Admin or HR Manager role required.');
        } else {
          setError(err.response?.data?.error || 'Failed to load leave requests');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchRequests();
  }, [isAuthenticated, page, filters]);

  const handleApprove = async (requestId: string) => {
    try {
      setActionLoading(true);
      await leaveRequestsApi.approve(requestId);
      setRequests(requests.filter(r => r._id !== requestId));
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to approve request');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectClick = (request: LeaveRequest) => {
    setSelectedRequest(request);
    setRejectReason('');
  };

  const handleReject = async () => {
    if (!selectedRequest || !rejectReason.trim()) {
      alert('Please provide a rejection reason');
      return;
    }

    try {
      setActionLoading(true);
      await leaveRequestsApi.reject(selectedRequest._id, rejectReason);
      setRequests(requests.filter(r => r._id !== selectedRequest._id));
      setSelectedRequest(null);
      setRejectReason('');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to reject request');
    } finally {
      setActionLoading(false);
    }
  };

  const clearFilters = () => {
    setFilters({
      status: '',
      leaveType: '',
      teamId: '',
      startDate: '',
      endDate: '',
    });
    setPage(1);
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

  // Check if user has admin/HR manager role
  const hasAdminAccess = user?.organizations?.some(
    org => org.role === 'admin' || org.role === 'hr_manager' || org.role === 'owner'
  );

  if (!hasAdminAccess) {
    return (
      <Layout>
        <div className="space-y-6">
          <Alert variant="warning" className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-semibold">Access Restricted</div>
              <div className="text-sm mt-1">
                This page is only accessible to Administrators and HR Managers.
              </div>
            </div>
          </Alert>
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
                Admin: Leave Requests
              </h1>
              <p className="text-slate-600 mt-2">View and manage all employee leave requests</p>
            </div>
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
              className="rounded-xl"
            >
              <Filter className="h-4 w-4" />
              Filters
            </Button>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-md border border-slate-200/50 p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">All Statuses</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Leave Type
                </label>
                <select
                  value={filters.leaveType}
                  onChange={(e) => setFilters({ ...filters, leaveType: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">All Types</option>
                  <option value="annual">Annual</option>
                  <option value="sick">Sick</option>
                  <option value="personal">Personal</option>
                  <option value="maternity">Maternity</option>
                  <option value="paternity">Paternity</option>
                  <option value="unpaid">Unpaid</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div className="flex items-end">
                <Button
                  variant="outline"
                  onClick={clearFilters}
                  className="rounded-xl"
                >
                  Clear Filters
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <Alert variant="warning" className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <div className="text-sm">{error}</div>
          </Alert>
        )}

        {/* Loading state */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
          </div>
        ) : requests.length === 0 ? (
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-slate-200/50 p-12 text-center">
            <Users className="h-16 w-16 text-slate-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No leave requests found</h3>
            <p className="text-slate-600">
              {Object.values(filters).some(f => f) 
                ? 'Try adjusting your filters'
                : 'No leave requests have been submitted yet'}
            </p>
          </div>
        ) : (
          <>
            {/* Requests list */}
            <div className="space-y-4">
              {requests.map((request) => (
                <LeaveRequestCard
                  key={request._id}
                  request={request}
                  showUser
                  showActions={request.status === 'pending'}
                  onApprove={handleApprove}
                  onReject={() => handleRejectClick(request)}
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

        {/* Reject dialog */}
        {selectedRequest && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Reject Leave Request
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Rejecting request from {selectedRequest.userName} for{' '}
                {selectedRequest.numberOfDays} day(s) of {selectedRequest.leaveType} leave
              </p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Please provide a reason for rejection..."
                rows={4}
                className="w-full px-3 py-2 border rounded-lg focus:ring-primary-500 focus:border-primary-500"
              />
              <div className="flex justify-end gap-3 mt-4">
                <button
                  onClick={() => {
                    setSelectedRequest(null);
                    setRejectReason('');
                  }}
                  className="px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={actionLoading || !rejectReason.trim()}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Rejecting...' : 'Reject Request'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
