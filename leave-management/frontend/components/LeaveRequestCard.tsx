'use client';

import Link from 'next/link';
import { LeaveRequest } from '@/types';
import {
  formatDateRange,
  getLeaveTypeLabel,
  getLeaveTypeColor,
  getStatusColor,
  getStatusLabel,
  pluralize,
} from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Calendar, Clock, User, ArrowUpRight, Users as UsersIcon } from 'lucide-react';

interface LeaveRequestCardProps {
  request: LeaveRequest;
  showUser?: boolean;
  showActions?: boolean;
  compact?: boolean;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}

export default function LeaveRequestCard({
  request,
  showUser = false,
  showActions = false,
  compact = false,
  onApprove,
  onReject,
}: LeaveRequestCardProps) {
  return (
    <div className={cn('border-b last:border-b-0', compact ? 'px-5 py-4' : 'suite-panel p-5')} style={{ borderColor: 'var(--suite-line)' }}>
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          {showUser && (
            <div className="flex items-center mb-3">
              <div className="suite-icon h-9 w-9 rounded-full">
                <User className="h-4 w-4" />
              </div>
              <div className="ml-2">
                <p className="text-sm font-semibold text-foreground dark:text-zinc-100">{request.userName}</p>
                <p className="text-xs text-muted-foreground">{request.userEmail}</p>
              </div>
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium', getLeaveTypeColor(request.leaveType))}>
              {getLeaveTypeLabel(request.leaveType)}
            </span>
            <span className={cn('inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium', getStatusColor(request.status))}>
              {getStatusLabel(request.status)}
            </span>
          </div>

          <div className="flex items-center text-sm text-muted-foreground mb-2">
            <Calendar className="h-4 w-4 mr-1.5 text-muted-foreground" />
            {formatDateRange(request.startDate, request.endDate)}
          </div>

          <div className="flex items-center text-sm text-muted-foreground">
            <Clock className="h-4 w-4 mr-1.5 text-muted-foreground" />
            {request.numberOfDays} {pluralize(request.numberOfDays, 'day')}
          </div>

          {request.reason && (
            <p className="mt-3 line-clamp-2 text-sm" style={{ color: 'var(--suite-muted)' }}>{request.reason}</p>
          )}

          {request.teamName && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="bg-secondary dark:bg-zinc-800/60 text-secondary-foreground dark:text-zinc-300 border-border dark:border-zinc-700">
                <UsersIcon className="h-3 w-3 mr-1" />
                {request.teamHierarchyPath && request.teamHierarchyPath.length > 0
                  ? request.teamHierarchyPath.join(' → ')
                  : request.teamName}
              </Badge>
            </div>
          )}
          {request.assignedApprover && (
            <div className="mt-2 text-xs text-muted-foreground">
              Assigned to{' '}
              <span className="font-semibold text-foreground dark:text-zinc-300">
                {request.assignedApprover.userName || request.assignedApprover.userEmail}
              </span>
              {request.assignedApprover.assignmentType && (
                <span className="ml-2 inline-flex items-center rounded-lg bg-muted dark:bg-zinc-800/60 px-2 py-0.5 text-muted-foreground dark:text-zinc-400 border border-border dark:border-zinc-700">
                  {request.assignedApprover.assignmentType === 'line_manager'
                    ? 'Line Manager'
                    : request.assignedApprover.assignmentType === 'team_lead'
                      ? 'Team Lead'
                      : 'Organization Role'}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Link
            href={`/leave-requests/${request._id}`}
            className="inline-flex items-center gap-1 text-sm font-semibold"
            style={{ color: 'var(--suite-accent)' }}
          >
            View Details <ArrowUpRight className="h-4 w-4" />
          </Link>

          {showActions && request.status === 'pending' && (
            <div className="flex gap-2 mt-2">
              {onApprove && (
                <button
                  onClick={() => onApprove(request._id)}
                  className="suite-button h-8 text-xs"
                >
                  Approve
                </button>
              )}
              {onReject && (
                <button
                  onClick={() => onReject(request._id)}
                  className="suite-button-secondary h-8 text-xs"
                >
                  Reject
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {request.status === 'approved' && request.approvedBy && !compact && (
        <div className="mt-4 border-t pt-4 text-xs" style={{ borderColor: 'var(--suite-line)', color: 'var(--suite-muted)' }}>
          Approved by <span className="text-green-400 font-medium">{request.approvedBy.userName}</span> on{' '}
          {new Date(request.approvedBy.approvedAt).toLocaleDateString()}
        </div>
      )}

      {request.status === 'rejected' && request.rejectedBy && !compact && (
        <div className="mt-4 border-t pt-4 text-xs" style={{ borderColor: 'var(--suite-line)' }}>
          <span className="text-red-400 font-medium">Rejected:</span> <span className="text-zinc-400">{request.rejectedBy.rejectionReason}</span>
        </div>
      )}
    </div>
  );
}
