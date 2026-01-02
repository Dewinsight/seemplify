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
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}

export default function LeaveRequestCard({
  request,
  showUser = false,
  showActions = false,
  onApprove,
  onReject,
}: LeaveRequestCardProps) {
  return (
    <div className="group bg-gradient-to-br from-zinc-900/80 to-zinc-800/80 backdrop-blur-sm rounded-xl shadow-lg border border-zinc-700/50 p-5 hover:shadow-xl hover:border-purple-500/30 hover:-translate-y-0.5 transition-all duration-200 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/0 via-purple-500/0 to-pink-500/0 group-hover:from-indigo-500/5 group-hover:via-purple-500/5 group-hover:to-pink-500/5 transition-all" />
      <div className="flex justify-between items-start">
        <div className="flex-1 relative">
          {showUser && (
            <div className="flex items-center mb-3">
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg ring-2 ring-zinc-700">
                <User className="h-4 w-4 text-white" />
              </div>
              <div className="ml-2">
                <p className="text-sm font-semibold text-zinc-100">{request.userName}</p>
                <p className="text-xs text-zinc-500">{request.userEmail}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mb-3">
            <span className={cn('inline-flex items-center rounded-lg px-3 py-1 text-xs font-semibold border', getLeaveTypeColor(request.leaveType))}>
              {getLeaveTypeLabel(request.leaveType)}
            </span>
            <span className={cn('inline-flex items-center rounded-lg px-3 py-1 text-xs font-semibold border', getStatusColor(request.status))}>
              {getStatusLabel(request.status)}
            </span>
          </div>

          <div className="flex items-center text-sm text-zinc-300 mb-2">
            <Calendar className="h-4 w-4 mr-1.5 text-zinc-500" />
            {formatDateRange(request.startDate, request.endDate)}
          </div>

          <div className="flex items-center text-sm text-zinc-400">
            <Clock className="h-4 w-4 mr-1.5 text-zinc-500" />
            {request.numberOfDays} {pluralize(request.numberOfDays, 'day')}
          </div>

          {request.reason && (
            <p className="mt-3 text-sm text-zinc-400 line-clamp-2 bg-zinc-800/40 p-2 rounded-lg border border-zinc-700/30">{request.reason}</p>
          )}

          {request.teamName && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="bg-zinc-800/60 text-zinc-300 border-zinc-700">
                <UsersIcon className="h-3 w-3 mr-1" />
                {request.teamHierarchyPath && request.teamHierarchyPath.length > 0
                  ? request.teamHierarchyPath.join(' → ')
                  : request.teamName}
              </Badge>
            </div>
          )}
          {request.assignedApprover && (
            <div className="mt-2 text-xs text-zinc-500">
              Assigned to{' '}
              <span className="font-semibold text-zinc-300">
                {request.assignedApprover.userName || request.assignedApprover.userEmail}
              </span>
              {request.assignedApprover.assignmentType && (
                <span className="ml-2 inline-flex items-center rounded-lg bg-zinc-800/60 px-2 py-0.5 text-zinc-400 border border-zinc-700">
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

        <div className="flex flex-col items-end gap-2 relative">
          <Link
            href={`/leave-requests/${request._id}`}
            className="text-sm font-semibold text-purple-400 hover:text-purple-300 inline-flex items-center gap-1 transition-colors"
          >
            View Details <ArrowUpRight className="h-4 w-4" />
          </Link>

          {showActions && request.status === 'pending' && (
            <div className="flex gap-2 mt-2">
              {onApprove && (
                <button
                  onClick={() => onApprove(request._id)}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-emerald-500 to-green-600 rounded-lg hover:from-emerald-600 hover:to-green-700 shadow-lg shadow-green-500/20 hover:shadow-green-500/30 transition-all"
                >
                  Approve
                </button>
              )}
              {onReject && (
                <button
                  onClick={() => onReject(request._id)}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-red-500 to-rose-600 rounded-lg hover:from-red-600 hover:to-rose-700 shadow-lg shadow-red-500/20 hover:shadow-red-500/30 transition-all"
                >
                  Reject
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {request.status === 'approved' && request.approvedBy && (
        <div className="mt-4 pt-4 border-t border-zinc-700/60 text-xs text-zinc-500 relative">
          Approved by <span className="text-green-400 font-medium">{request.approvedBy.userName}</span> on{' '}
          {new Date(request.approvedBy.approvedAt).toLocaleDateString()}
        </div>
      )}

      {request.status === 'rejected' && request.rejectedBy && (
        <div className="mt-4 pt-4 border-t border-zinc-700/60 text-xs relative">
          <span className="text-red-400 font-medium">Rejected:</span> <span className="text-zinc-400">{request.rejectedBy.rejectionReason}</span>
        </div>
      )}
    </div>
  );
}
