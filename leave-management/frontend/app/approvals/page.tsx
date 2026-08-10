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
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-green-500"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-8">
        {/* Header */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-green-500/20 via-emerald-500/20 to-teal-500/20 rounded-2xl blur-3xl"></div>
          <div className="relative bg-card dark:bg-zinc-900/80 backdrop-blur-xl rounded-2xl border border-border dark:border-zinc-700/50 p-8 shadow-2xl shadow-green-500/10">
            <h1 className="text-3xl font-semibold tracking-tight text-card-foreground">
              Pending Approvals
            </h1>
            <p className="text-muted-foreground mt-2">
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
          <div className="bg-card/80 dark:bg-white/5 backdrop-blur-sm rounded-2xl shadow-lg border border-border dark:border-slate-200/5 p-12 text-center">
            <CheckSquare className="h-16 w-16 text-emerald-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground dark:text-slate-200 mb-2">All caught up!</h3>
            <p className="text-muted-foreground dark:text-slate-400">No pending leave requests to approve</p>
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
                  className="px-4 py-2 border border-border dark:border-zinc-700 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent dark:hover:bg-zinc-800/70 bg-card dark:bg-zinc-900/60 text-foreground dark:text-zinc-200 transition-all"
                >
                  Previous
                </button>
                <span className="px-4 py-2 text-sm text-muted-foreground dark:text-zinc-300">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-4 py-2 border border-border dark:border-zinc-700 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent dark:hover:bg-zinc-800/70 bg-card dark:bg-zinc-900/60 text-foreground dark:text-zinc-200 transition-all"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}

        {/* Reject dialog */}
        {selectedRequest && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-popover dark:bg-gradient-to-br dark:from-zinc-900 dark:to-zinc-800 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl border border-border dark:border-zinc-700/50">
              <h3 className="text-lg font-bold text-foreground dark:text-zinc-100 mb-2">Reject Leave Request</h3>
              <p className="text-sm text-muted-foreground dark:text-zinc-400 mb-4">
                Rejecting request from <span className="text-foreground dark:text-zinc-200 font-medium">{selectedRequest.userName}</span> for{' '}
                {selectedRequest.numberOfDays} day(s) of {selectedRequest.leaveType} leave
              </p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Please provide a reason for rejection..."
                rows={4}
                className="w-full px-3 py-2.5 border border-input dark:border-zinc-700 bg-background dark:bg-zinc-800/60 text-foreground dark:text-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/50 placeholder:text-muted-foreground dark:placeholder:text-zinc-500"
              />
              <div className="flex justify-end gap-3 mt-4">
                <Button
                  variant="outline"
                  className="border-input dark:border-zinc-700 bg-background dark:bg-zinc-800/60 text-foreground dark:text-zinc-200 hover:bg-accent dark:hover:bg-zinc-800 hover:text-accent-foreground dark:hover:text-white"
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
                  className="rounded-lg bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-lg shadow-red-500/20"
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
