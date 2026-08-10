'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Layout from '@/components/Layout';
import { leaveRequestsApi } from '@/lib/api';
import { LeaveRequest } from '@/types';
import {
  formatDate,
  formatDateRange,
  getLeaveTypeLabel,
  getLeaveTypeColor,
  getStatusColor,
  getStatusLabel,
  pluralize,
} from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import {
  ArrowLeft,
  Calendar,
  Clock,
  User,
  CheckCircle,
  XCircle,
  AlertCircle,
  History,
} from 'lucide-react';
import Link from 'next/link';

type ActivityHistoryEntry = LeaveRequest['auditLog'][number];

function formatActivityTitle(action: string): string {
  const actionLabels: Record<string, string> = {
    created: 'Request submitted',
    updated: 'Request updated',
    approved: 'Request approved',
    rejected: 'Request rejected',
    cancelled: 'Request cancelled',
  };

  if (actionLabels[action]) {
    return actionLabels[action];
  }

  return action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getActivityFallbackText(entry: ActivityHistoryEntry): string | null {
  const fallbackText: Record<string, string> = {
    created: 'Leave request was submitted for approval.',
    updated: 'Leave request information was updated.',
    approved: 'Leave request was approved.',
    rejected: 'Leave request was rejected.',
    cancelled: 'Leave request was cancelled.',
  };

  return fallbackText[entry.action] || null;
}

export default function LeaveRequestDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [request, setRequest] = useState<LeaveRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // For rejection dialog
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const requestId = params.id as string;

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    const fetchRequest = async () => {
      if (!isAuthenticated || !requestId) return;

      try {
        setLoading(true);
        const response = await leaveRequestsApi.getById(requestId);
        setRequest(response.request);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to load leave request');
      } finally {
        setLoading(false);
      }
    };

    fetchRequest();
  }, [isAuthenticated, requestId]);

  const handleCancel = async () => {
    if (!request || !confirm('Are you sure you want to cancel this leave request?')) return;

    try {
      setActionLoading(true);
      await leaveRequestsApi.cancel(request._id);
      setRequest({ ...request, status: 'cancelled' });
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to cancel request');
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!request) return;

    try {
      setActionLoading(true);
      const response = await leaveRequestsApi.approve(request._id);
      setRequest(response.request);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to approve request');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!request || !rejectReason.trim()) {
      alert('Please provide a rejection reason');
      return;
    }

    try {
      setActionLoading(true);
      const response = await leaveRequestsApi.reject(request._id, rejectReason);
      setRequest(response.request);
      setShowRejectDialog(false);
      setRejectReason('');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to reject request');
    } finally {
      setActionLoading(false);
    }
  };

  const canCancel = request && request.userId === user?.id &&
    (request.status === 'pending' ||
      (request.status === 'approved' && request.approvedBy?.approvedAt &&
        (Date.now() - new Date(request.approvedBy.approvedAt).getTime()) < 24 * 60 * 60 * 1000));

  const isApprover = request && request.assignedApprover?.userId === user?.id;

  if (authLoading || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
        </div>
      </Layout>
    );
  }

  if (error || !request) {
    return (
      <Layout>
        <div className="w-full">
          <Link
            href="/leave-requests"
            className="inline-flex items-center text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 mb-4 font-medium"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Requests
          </Link>
          <Alert variant="danger">{error || 'Leave request not found'}</Alert>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="w-full">
        {/* Header */}
        <div className="mb-6 relative">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 rounded-2xl blur-3xl"></div>
          <div className="relative bg-card dark:bg-zinc-900/80 backdrop-blur-sm rounded-2xl border border-border dark:border-slate-200/50 p-6 shadow-lg">
            <Link
              href="/leave-requests"
              className="inline-flex items-center text-sm text-muted-foreground dark:text-slate-400 hover:text-foreground dark:hover:text-slate-200 mb-4 font-medium"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Requests
            </Link>
            <div className="flex justify-between items-start gap-4 flex-wrap">
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground dark:from-slate-100 dark:via-slate-200 dark:to-slate-300 bg-clip-text text-transparent">
                  Leave Request
                </h1>
                <p className="text-muted-foreground dark:text-slate-400 mt-2">
                  Submitted on {formatDate(request.createdAt)}
                </p>
              </div>
              <span className={cn('inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold', getStatusColor(request.status))}>
                {getStatusLabel(request.status)}
              </span>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="bg-card dark:bg-zinc-900/90 backdrop-blur-sm rounded-2xl shadow-lg border border-border dark:border-slate-200/50 overflow-hidden">
          {/* Leave details */}
          <div className="p-6 border-b border-border dark:border-slate-200/50">
            <div className="flex items-center gap-3 mb-4">
              <span
                className={cn(
                  'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium',
                  getLeaveTypeColor(request.leaveType)
                )}
              >
                {getLeaveTypeLabel(request.leaveType, request.leaveTypeName)}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="flex items-center text-muted-foreground dark:text-slate-400 mb-2">
                  <Calendar className="h-5 w-5 mr-2 text-muted-foreground dark:text-slate-500" />
                  <span className="font-medium">Date Range</span>
                </div>
                <p className="text-lg font-semibold text-foreground dark:text-slate-100">
                  {formatDateRange(request.startDate, request.endDate)}
                </p>
              </div>

              <div>
                <div className="flex items-center text-muted-foreground dark:text-slate-400 mb-2">
                  <Clock className="h-5 w-5 mr-2 text-muted-foreground dark:text-slate-500" />
                  <span className="font-medium">Duration</span>
                </div>
                <p className="text-lg font-semibold text-foreground dark:text-slate-100">
                  {request.numberOfDays} {pluralize(request.numberOfDays, 'day')}
                </p>
              </div>
            </div>

            {request.reason && (
              <div className="mt-6">
                <p className="font-semibold text-foreground/80 dark:text-slate-300 mb-2">Reason</p>
                <p className="text-foreground dark:text-slate-200">{request.reason}</p>
              </div>
            )}

            {request.teamName && (
              <div className="mt-4">
                <Badge variant="secondary" className="bg-muted dark:bg-slate-800 border-border dark:border-slate-700 text-foreground dark:text-slate-300">
                  Team: {request.teamHierarchyPath?.join(' → ') || request.teamName}
                </Badge>
              </div>
            )}
          </div>

          {/* Requester info */}
          <div className="p-6 border-b border-border dark:border-slate-200/50 bg-muted/30 dark:bg-slate-50/5">
            <div className="flex items-center">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-md ring-2 ring-background dark:ring-white/10">
                <User className="h-5 w-5 text-white" />
              </div>
              <div className="ml-3">
                <p className="font-semibold text-foreground dark:text-slate-100">{request.userName}</p>
                <p className="text-sm text-muted-foreground dark:text-slate-400">{request.userEmail}</p>
              </div>
            </div>
          </div>

          {/* Approval status */}
          {request.status === 'approved' && request.approvedBy && (
            <div className="p-6 border-b border-border dark:border-slate-200/50 bg-emerald-500/10 dark:bg-emerald-500/20">
              <div className="flex items-start">
                <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 mr-3" />
                <div>
                  <p className="font-medium text-green-700 dark:text-green-300">Approved</p>
                  <p className="text-sm text-green-600 dark:text-green-400">
                    by {request.approvedBy.userName} on{' '}
                    {formatDate(request.approvedBy.approvedAt)}
                  </p>
                  {request.approvedBy.comment && (
                    <p className="mt-2 text-green-800 dark:text-green-200">{request.approvedBy.comment}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {request.status === 'rejected' && request.rejectedBy && (
            <div className="p-6 border-b border-border dark:border-slate-200/50 bg-red-500/10 dark:bg-red-500/20">
              <div className="flex items-start">
                <XCircle className="h-5 w-5 text-red-600 mt-0.5 mr-3" />
                <div>
                  <p className="font-medium text-red-700 dark:text-red-300">Rejected</p>
                  <p className="text-sm text-red-600 dark:text-red-400">
                    by {request.rejectedBy.userName} on{' '}
                    {formatDate(request.rejectedBy.rejectedAt)}
                  </p>
                  <p className="mt-2 text-red-800 dark:text-red-200">{request.rejectedBy.rejectionReason}</p>
                </div>
              </div>
            </div>
          )}

          {request.status === 'pending' && request.assignedApprover && (
            <div className="p-6 border-b border-border dark:border-slate-200/50 bg-amber-500/10 dark:bg-amber-500/20">
              <div className="flex items-start">
                <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5 mr-3" />
                <div>
                  <p className="font-medium text-amber-700 dark:text-yellow-300">Awaiting Approval</p>
                  <p className="text-sm text-amber-600 dark:text-yellow-400">
                    Assigned to {request.assignedApprover.userName}
                    {request.assignedApprover.assignmentType === 'line_manager' && (
                      <span> (Line Manager)</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Audit log */}
          {request.auditLog && request.auditLog.length > 0 && (
            <div className="p-6 border-b border-border dark:border-slate-200/50">
              <div className="flex items-center mb-4">
                <History className="h-5 w-5 text-slate-500 dark:text-slate-400 mr-2" />
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">Activity History</h3>
                  <p className="text-sm text-muted-foreground dark:text-slate-400">
                    Chronological updates for this request.
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                {request.auditLog.map((entry, index) => {
                  const activityText = entry.details || getActivityFallbackText(entry);

                  return (
                    <div key={index} className="flex items-start text-sm">
                      <div className="w-2 h-2 rounded-full bg-muted-foreground/50 dark:bg-slate-500 mt-2 mr-3" />
                      <div>
                        <p className="text-foreground dark:text-slate-200">
                          <span className="font-medium">{formatActivityTitle(entry.action)}</span>
                          {entry.performedByName && ` by ${entry.performedByName}`}
                        </p>
                        <p className="text-muted-foreground dark:text-slate-400">
                          {formatDate(entry.performedAt, 'MMM dd, yyyy HH:mm')}
                        </p>
                        {activityText && (
                          <p className="text-foreground/80 dark:text-slate-300 mt-1">{activityText}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="p-6 bg-muted/30 dark:bg-slate-50/5">
            <div className="flex justify-end gap-3">
              {canCancel && (
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={actionLoading}
                  className="rounded-xl border-red-300 dark:border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10"
                >
                  Cancel Request
                </Button>
              )}

              {isApprover && request.status === 'pending' && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setShowRejectDialog(true)}
                    disabled={actionLoading}
                    className="rounded-xl border-red-300 dark:border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10"
                  >
                    Reject
                  </Button>
                  <Button
                    onClick={handleApprove}
                    disabled={actionLoading}
                    className="rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white"
                  >
                    Approve
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Reject dialog */}
        {showRejectDialog && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-popover dark:bg-zinc-800/90 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl border border-border dark:border-slate-200/20">
              <h3 className="text-lg font-bold text-foreground dark:text-zinc-100 mb-4">
                Reject Leave Request
              </h3>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Please provide a reason for rejection..."
                rows={4}
                className="w-full px-3 py-2.5 border border-input dark:border-zinc-700 rounded-xl bg-background dark:bg-zinc-900/50 text-foreground dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="flex justify-end gap-3 mt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowRejectDialog(false);
                    setRejectReason('');
                  }}
                  className="rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleReject}
                  disabled={actionLoading || !rejectReason.trim()}
                  className="rounded-xl bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white disabled:opacity-50"
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
