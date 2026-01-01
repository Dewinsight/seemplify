'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import Layout from '@/components/Layout';
import { leaveRequestsApi, leavePoliciesApi } from '@/lib/api';
import { LeaveRequest, Holiday } from '@/types';
import { getLeaveTypeLabel, getLeaveTypeColor, cn } from '@/lib/utils';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  isWeekend,
  parseISO,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';

export default function CalendarPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticated) return;

      try {
        setLoading(true);
        const start = startOfMonth(currentMonth);
        const end = endOfMonth(currentMonth);

        const [leavesRes, holidaysRes] = await Promise.all([
          leaveRequestsApi.getCalendar(
            format(start, 'yyyy-MM-dd'),
            format(end, 'yyyy-MM-dd')
          ),
          leavePoliciesApi.getHolidays(currentMonth.getFullYear()),
        ]);

        setLeaves(leavesRes.requests || []);
        setHolidays(holidaysRes.holidays || []);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to load calendar data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isAuthenticated, currentMonth]);

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  // Pad start with empty days for alignment
  const startDay = startOfMonth(currentMonth).getDay();
  const paddedDays = [...Array(startDay).fill(null), ...days];

  const getLeavesForDay = (day: Date) => {
    return leaves.filter(leave => {
      const start = parseISO(leave.startDate);
      const end = parseISO(leave.endDate);
      return day >= start && day <= end;
    });
  };

  const getHolidayForDay = (day: Date) => {
    return holidays.find(holiday => {
      const holidayDate = parseISO(holiday.date);
      return isSameDay(day, holidayDate);
    });
  };

  const isHoliday = (day: Date) => {
    return holidays.some(holiday => {
      const holidayDate = parseISO(holiday.date);
      return isSameDay(day, holidayDate);
    });
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
          <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 via-blue-500/10 to-emerald-500/10 rounded-2xl blur-3xl"></div>
          <div className="relative bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/50 p-6 shadow-lg">
            <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 bg-clip-text text-transparent">
              Leave Calendar
            </h1>
            <p className="text-slate-600 mt-2">View approved leaves for your organization</p>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <Alert variant="danger">{error}</Alert>
        )}

        {/* Calendar */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-slate-200/50 overflow-hidden">
          {/* Month navigation */}
          <div className="flex items-center justify-between p-4 border-b border-slate-200/50 bg-white/60">
            <button
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900">
                {format(currentMonth, 'MMMM yyyy')}
              </h2>
              <Badge variant="outline" className="bg-white/60">
                {leaves.length} leave(s)
              </Badge>
            </div>
            <button
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {/* Loading state */}
          {loading ? (
            <div className="flex items-center justify-center h-96">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
            </div>
          ) : (
            <>
              {/* Day headers */}
              <div className="grid grid-cols-7 bg-slate-50/80 border-b border-slate-200/50">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="p-2 text-center text-sm font-semibold text-slate-600">
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7">
                {paddedDays.map((day, index) => {
                  if (!day) {
                    return <div key={`empty-${index}`} className="h-24 border-b border-r bg-gray-50" />;
                  }

                  const dayLeaves = getLeavesForDay(day);
                  const holiday = getHolidayForDay(day);
                  const isToday = isSameDay(day, new Date());
                  const weekend = isWeekend(day);

                  return (
                    <div
                      key={day.toISOString()}
                      onClick={() => setSelectedDay(day)}
                      className={cn(
                        'h-24 border-b border-r border-slate-200/50 p-2 cursor-pointer hover:bg-slate-50/70 transition-colors',
                        weekend && 'bg-slate-50/60',
                        holiday && 'bg-red-50/60',
                        isToday && 'ring-2 ring-inset ring-primary/30'
                      )}
                    >
                      <div className="flex justify-between items-start">
                        <span
                          className={cn(
                            'text-sm font-semibold',
                            !isSameMonth(day, currentMonth) && 'text-slate-400',
                            isToday && 'text-primary',
                            weekend && 'text-slate-500'
                          )}
                        >
                          {format(day, 'd')}
                        </span>
                        {holiday && (
                          <span className="text-xs text-red-700 font-semibold" title={holiday.name}>
                            H
                          </span>
                        )}
                      </div>

                      {/* Leave indicators */}
                      <div className="mt-1 space-y-0.5 overflow-hidden">
                        {dayLeaves.slice(0, 2).map((leave, idx) => (
                          <div
                            key={`${leave._id}-${idx}`}
                            className={cn(
                              'text-xs px-1 py-0.5 rounded truncate',
                              getLeaveTypeColor(leave.leaveType)
                            )}
                            title={`${leave.userName} - ${getLeaveTypeLabel(leave.leaveType)}`}
                          >
                            {leave.userName.split(' ')[0]}
                          </div>
                        ))}
                        {dayLeaves.length > 2 && (
                          <div className="text-xs text-slate-500 px-1">
                            +{dayLeaves.length - 2} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Selected day details */}
        {selectedDay && (
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-slate-200/50 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">
                {format(selectedDay, 'EEEE, MMMM d, yyyy')}
              </h3>
              <button
                onClick={() => setSelectedDay(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                &times;
              </button>
            </div>

            {getHolidayForDay(selectedDay) && (
              <div className="mb-4 p-3 bg-red-50 rounded-lg text-red-700">
                <CalendarIcon className="h-4 w-4 inline mr-2" />
                Holiday: {getHolidayForDay(selectedDay)?.name}
              </div>
            )}

            {getLeavesForDay(selectedDay).length === 0 ? (
              <p className="text-slate-600">No leaves scheduled for this day</p>
            ) : (
              <div className="space-y-3">
                {getLeavesForDay(selectedDay).map(leave => (
                  <div
                    key={leave._id}
                    className="flex items-center justify-between p-3 bg-slate-50/70 rounded-xl border border-slate-200/50"
                  >
                    <div>
                      <p className="font-semibold text-slate-900">{leave.userName}</p>
                      <span
                        className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                          getLeaveTypeColor(leave.leaveType)
                        )}
                      >
                        {getLeaveTypeLabel(leave.leaveType)}
                      </span>
                    </div>
                    <div className="text-sm text-slate-600">
                      {leave.numberOfDays} day(s)
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Legend */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-md border border-slate-200/50 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Legend</h3>
          <div className="flex flex-wrap gap-4">
            {['annual', 'sick', 'personal', 'maternity', 'paternity', 'unpaid'].map(type => (
              <div key={type} className="flex items-center gap-2">
                <span
                  className={cn(
                    'w-3 h-3 rounded',
                    getLeaveTypeColor(type).replace('text-', 'bg-').split(' ')[0]
                  )}
                />
                <span className="text-sm text-slate-600">{getLeaveTypeLabel(type)}</span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-red-200" />
              <span className="text-sm text-slate-600">Holiday</span>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
