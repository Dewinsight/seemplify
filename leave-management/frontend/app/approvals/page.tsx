'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Layout from '@/components/Layout';
import LeaveRequestCard from '@/components/LeaveRequestCard';
import { leaveRequestsApi } from '@/lib/api';
import { LeaveRequest } from '@/types';
import { CheckSquare, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';

export default function ApprovalsPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [pendingRequests, setPendingRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // For reject dialog
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    const fetchApprovals = async () => {
      if (!isAuthenticated) return;

      try {
        setLoading(true);
        const response = await leaveRequestsApi.getApprovals({ page, limit: 10 });
        setPendingRequests(response.requests);
        setTotalPages(response.pagination.pages);
      } catch (err: any) {
        if (err.response?.status === 403) {
          setError('You do not have permission to approve leave requests');
        } else {
          setError(err.response?.data?.error || 'Failed to load pending approvals');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchApprovals();
  }, [isAuthenticated, page]);

  const handleApprove = async (requestId: string) => {
    try {
      setActionLoading(true);
      await leaveRequestsApi.approve(requestId);
      // Remove from list
      setPendingRequests(pendingRequests.filter(r => r._id !== requestId));
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
      // Remove from list
      setPendingRequests(pendingRequests.filter(r => r._id !== selectedRequest._id));
      setSelectedRequest(null);
      setRejectReason('');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to reject request');
    } finally {
      setActionLoading(false);
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
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 via-blue-500/10 to-purple-500/10 rounded-2xl blur-3xl"></div>
          <div className="relative bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/50 p-6 shadow-lg">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 bg-clip-text text-transparent">
              Pending Approvals
            </h1>
            <p className="text-slate-600 mt-2">
              Review and approve leave requests from your team members
            </p>
          </div>
        </div>

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
        ) : pendingRequests.length === 0 ? (
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-slate-200/50 p-12 text-center">
            <CheckSquare className="h-16 w-16 text-emerald-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">All caught up!</h3>
            <p className="text-slate-600">No pending leave requests to approve</p>
          </div>
        ) : (
          <>
            {/* Approvals list */}
            <div className="space-y-4">
              {pendingRequests.map((request) => (
                <div key={request._id}>
                  <LeaveRequestCard
                    request={request}
                    showUser
                    showActions
                    onApprove={handleApprove}
                    onReject={() => handleRejectClick(request)}
                  />
                </div>
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
            <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl border border-slate-200/60">
              <h3 className="text-lg font-bold text-slate-900 mb-2">Reject Leave Request</h3>
              <p className="text-sm text-slate-600 mb-4">
                Rejecting request from {selectedRequest.userName} for{' '}
                {selectedRequest.numberOfDays} day(s) of {selectedRequest.leaveType} leave
              </p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Please provide a reason for rejection..."
                rows={4}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="flex justify-end gap-3 mt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedRequest(null);
                    setRejectReason('');
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleReject}
                  disabled={actionLoading || !rejectReason.trim()}
                  className="rounded-xl bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white"
                >
                  {actionLoading ? 'Rejecting...' : 'Reject Request'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
