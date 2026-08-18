'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import {
  formatDate,
  formatDateRange,
  getLeaveTypeLabel,
  getStatusColor,
  getStatusLabel,
} from '@/lib/utils';
import { LeaveRequest } from '@/types';

type Props = {
  requests: LeaveRequest[];
  emptyMessage: string;
};

function initials(name?: string) {
  return String(name || 'Member')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export default function LeaveCalendarRequestDetails({ requests, emptyMessage }: Props) {
  if (requests.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="divide-y divide-border">
      {requests.map((request) => (
        <article key={request._id} className="px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold" aria-hidden="true">
                {initials(request.userName)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{request.userName || 'Member'}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[request.userEmail, request.teamName].filter(Boolean).join(' · ') || 'No team information'}
                </p>
              </div>
            </div>
            <span className={`rounded px-2 py-1 text-xs font-medium ${getStatusColor(request.status)}`}>
              {getStatusLabel(request.status)}
            </span>
          </div>

          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Leave type</dt>
              <dd className="mt-1 font-medium">{getLeaveTypeLabel(request.leaveType, request.leaveTypeName)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Dates</dt>
              <dd className="mt-1 font-medium">{formatDateRange(request.startDate, request.endDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Duration</dt>
              <dd className="mt-1 font-medium">{request.numberOfDays} day{request.numberOfDays === 1 ? '' : 's'}</dd>
            </div>
            {request.createdAt && (
              <div>
                <dt className="text-xs text-muted-foreground">Submitted</dt>
                <dd className="mt-1 font-medium">{formatDate(request.createdAt)}</dd>
              </div>
            )}
          </dl>

          {request.reason && (
            <div className="mt-4 border-l-2 border-border pl-3">
              <p className="text-xs text-muted-foreground">Reason</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{request.reason}</p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              {request.approvedBy
                ? `Approved by ${request.approvedBy.userName}`
                : request.assignedApprover
                  ? `Assigned to ${request.assignedApprover.userName}`
                  : 'Awaiting an available approver'}
            </p>
            <Link href={`/leave-requests/${request._id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              View full request <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
