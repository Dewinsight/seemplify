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
    <div className="group bg-white/90 backdrop-blur-sm rounded-2xl shadow-md border border-slate-200/50 p-5 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-purple-500/5 to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="flex justify-between items-start">
        <div className="flex-1 relative">
          {showUser && (
            <div className="flex items-center mb-2">
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-md ring-2 ring-white">
                <User className="h-4 w-4 text-white" />
              </div>
              <div className="ml-2">
                <p className="text-sm font-semibold text-slate-900">{request.userName}</p>
                <p className="text-xs text-slate-500">{request.userEmail}</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mb-2">
            <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold', getLeaveTypeColor(request.leaveType))}>
              {getLeaveTypeLabel(request.leaveType)}
            </span>
            <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold', getStatusColor(request.status))}>
              {getStatusLabel(request.status)}
            </span>
          </div>

          <div className="flex items-center text-sm text-slate-700 mb-1">
            <Calendar className="h-4 w-4 mr-1.5 text-slate-500" />
            {formatDateRange(request.startDate, request.endDate)}
          </div>

          <div className="flex items-center text-sm text-slate-600">
            <Clock className="h-4 w-4 mr-1.5 text-slate-500" />
            {request.numberOfDays} {pluralize(request.numberOfDays, 'day')}
          </div>

          {request.reason && (
            <p className="mt-3 text-sm text-slate-700 line-clamp-2">{request.reason}</p>
          )}

          {request.teamName && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="bg-slate-100 text-slate-700 border-slate-200">
                <UsersIcon className="h-3 w-3 mr-1" />
                {request.teamHierarchyPath && request.teamHierarchyPath.length > 0
                  ? request.teamHierarchyPath.join(' → ')
                  : request.teamName}
              </Badge>
            </div>
          )}
          {request.assignedApprover && (
            <div className="mt-2 text-xs text-slate-600">
              Assigned to{' '}
              <span className="font-semibold text-slate-800">
                {request.assignedApprover.userName || request.assignedApprover.userEmail}
              </span>
              {request.assignedApprover.assignmentType && (
                <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 border border-slate-200">
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
            className="text-sm font-semibold text-primary hover:text-primary/80 inline-flex items-center gap-1"
          >
            View Details <ArrowUpRight className="h-4 w-4" />
          </Link>

          {showActions && request.status === 'pending' && (
            <div className="flex gap-2 mt-2">
              {onApprove && (
                <button
                  onClick={() => onApprove(request._id)}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-emerald-500 to-green-600 rounded-xl hover:from-emerald-600 hover:to-green-700 shadow-sm hover:shadow-md transition-all"
                >
                  Approve
                </button>
              )}
              {onReject && (
                <button
                  onClick={() => onReject(request._id)}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-red-500 to-rose-600 rounded-xl hover:from-red-600 hover:to-rose-700 shadow-sm hover:shadow-md transition-all"
                >
                  Reject
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {request.status === 'approved' && request.approvedBy && (
        <div className="mt-4 pt-4 border-t border-slate-200/60 text-xs text-slate-500 relative">
          Approved by {request.approvedBy.userName} on{' '}
          {new Date(request.approvedBy.approvedAt).toLocaleDateString()}
        </div>
      )}

      {request.status === 'rejected' && request.rejectedBy && (
        <div className="mt-4 pt-4 border-t border-slate-200/60 text-xs text-red-700 relative">
          Rejected: {request.rejectedBy.rejectionReason}
        </div>
      )}
    </div>
  );
}
