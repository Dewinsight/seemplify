'use client';

import {
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isWeekend,
  parseISO,
  startOfMonth,
} from 'date-fns';

import { cn, getLeaveTypeColor, getLeaveTypeLabel } from '@/lib/utils';
import { CalendarDailyCoverage, Holiday, LeaveRequest } from '@/types';

type Props = {
  month: Date;
  requests: LeaveRequest[];
  holidays: Holiday[];
  selectedDay: Date | null;
  onSelectDay: (day: Date) => void;
  showEmployeeNames?: boolean;
  dailyCoverage?: CalendarDailyCoverage[];
};

export function requestsForDay(requests: LeaveRequest[], day: Date) {
  const dayKey = format(day, 'yyyy-MM-dd');
  return requests.filter((request) => (
    request.startDate.slice(0, 10) <= dayKey && request.endDate.slice(0, 10) >= dayKey
  ));
}

export default function LeaveCalendarGrid({
  month,
  requests,
  holidays,
  selectedDay,
  onSelectDay,
  showEmployeeNames = false,
  dailyCoverage = [],
}: Props) {
  const monthStart = startOfMonth(month);
  const days = eachDayOfInterval({ start: monthStart, end: endOfMonth(month) });
  const paddedDays: Array<Date | null> = [...Array(monthStart.getDay()).fill(null), ...days];
  const coverageByDate = new Map(dailyCoverage.map((entry) => [entry.date, entry]));

  return (
    <div className="overflow-hidden border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday) => (
          <div key={weekday} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">{weekday}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {paddedDays.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className="min-h-28 border-b border-r border-border bg-muted/20" />;
          const dayRequests = requestsForDay(requests, day);
          const holiday = holidays.find((item) => isSameDay(day, parseISO(item.date)));
          const selected = selectedDay ? isSameDay(day, selectedDay) : false;
          const coverage = coverageByDate.get(format(day, 'yyyy-MM-dd'));
          return (
            <button
              type="button"
              key={day.toISOString()}
              onClick={() => onSelectDay(day)}
              className={cn(
                'min-h-28 border-b border-r border-border p-2 text-left hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary',
                isWeekend(day) && 'bg-muted/20',
                selected && 'bg-accent'
              )}
            >
              <div className="flex items-start justify-between gap-1">
                <span className={cn('text-sm font-medium', isSameDay(day, new Date()) && 'text-primary')}>{format(day, 'd')}</span>
                {coverage && coverage.approvedAway > 0 && (
                  <span className="text-[11px] text-muted-foreground">{coverage.approvedAwayPercent}% away</span>
                )}
              </div>
              {holiday && <p className="mt-1 truncate text-[11px] text-red-700 dark:text-red-300" title={holiday.name}>{holiday.name}</p>}
              <div className="mt-1 space-y-1">
                {dayRequests.slice(0, 3).map((request) => (
                  <div
                    key={request._id}
                    className={cn('truncate rounded px-1.5 py-0.5 text-[11px]', getLeaveTypeColor(request.leaveType))}
                    title={`${showEmployeeNames ? `${request.userName} · ` : ''}${getLeaveTypeLabel(request.leaveType, request.leaveTypeName)} · ${request.status}`}
                  >
                    {showEmployeeNames ? request.userName : getLeaveTypeLabel(request.leaveType, request.leaveTypeName)}
                    {request.status === 'pending' ? ' · Pending' : ''}
                  </div>
                ))}
                {dayRequests.length > 3 && <p className="px-1 text-[11px] text-muted-foreground">+{dayRequests.length - 3} more</p>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
