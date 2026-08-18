'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addMonths, endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import Layout from '@/components/Layout';
import CalendarViewSwitcher from '@/components/CalendarViewSwitcher';
import LeaveCalendarGrid, { requestsForDay } from '@/components/LeaveCalendarGrid';
import LeaveCalendarRequestDetails from '@/components/LeaveCalendarRequestDetails';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { leavePoliciesApi, leaveRequestsApi } from '@/lib/api';
import { Holiday, LeaveRequest } from '@/types';

export default function CalendarPage() {
  const router = useRouter();
  const { currentOrganization, isAuthenticated, isLoading: authLoading } = useAuth();
  const [month, setMonth] = useState(new Date());
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [selectedDay, setSelectedDay] = useState<Date | null>(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [calendarResponse, holidayResponse] = await Promise.all([
          leaveRequestsApi.getCalendar(format(startOfMonth(month), 'yyyy-MM-dd'), format(endOfMonth(month), 'yyyy-MM-dd')),
          leavePoliciesApi.getHolidays(month.getFullYear()),
        ]);
        setRequests(calendarResponse.requests || []);
        setHolidays(holidayResponse.holidays || []);
      } catch (requestError: any) {
        setError(requestError.response?.data?.error || 'Unable to load your leave calendar.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [isAuthenticated, month]);

  const selectedRequests = selectedDay ? requestsForDay(requests, selectedDay) : [];
  const leavePermissions = currentOrganization?.appPermissions?.['leave-management'] || [];
  const canViewWorkforce = currentOrganization?.role === 'owner' ||
    currentOrganization?.role === 'admin' ||
    currentOrganization?.role === 'hr_manager' ||
    leavePermissions.includes('*') ||
    leavePermissions.includes('view_all_leaves');

  if (authLoading) return <Layout><div className="py-16 text-center text-sm text-muted-foreground">Loading your calendar…</div></Layout>;

  return (
    <Layout>
      <div className="space-y-6">
        <CalendarViewSwitcher active="personal" showWorkforce={canViewWorkforce} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h1 className="text-2xl font-semibold tracking-tight">My leave calendar</h1><p className="mt-1 text-sm text-muted-foreground">Your approved and pending leave requests. Other employees’ requests are not shown here.</p></div>
          <Link href="/leave-requests/new" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Request leave</Link>
        </div>

        {error && <Alert variant="danger">{error}</Alert>}

        <div className="flex items-center justify-between border-y border-border py-3">
          <Button variant="outline" size="sm" onClick={() => setMonth(subMonths(month, 1))}><ChevronLeft className="h-4 w-4" /> Previous</Button>
          <div className="text-center"><h2 className="font-semibold">{format(month, 'MMMM yyyy')}</h2><p className="text-xs text-muted-foreground">{requests.length} active request{requests.length === 1 ? '' : 's'}</p></div>
          <Button variant="outline" size="sm" onClick={() => setMonth(addMonths(month, 1))}>Next <ChevronRight className="h-4 w-4" /></Button>
        </div>

        {loading ? <div className="py-24 text-center text-sm text-muted-foreground">Loading calendar…</div> : (
          <LeaveCalendarGrid month={month} requests={requests} holidays={holidays} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
        )}

        {selectedDay && (
          <section className="border border-border bg-card" aria-labelledby="selected-day-title">
            <div className="border-b border-border px-4 py-3"><h2 id="selected-day-title" className="font-semibold">{format(selectedDay, 'EEEE, MMMM d, yyyy')}</h2></div>
            <LeaveCalendarRequestDetails requests={selectedRequests} emptyMessage="You have no leave scheduled for this day." />
          </section>
        )}
      </div>
    </Layout>
  );
}
