'use client';

import { LeaveBalance } from '@/types';
import { getLeaveTypeLabel } from '@/lib/utils';

interface LeaveBalanceCardProps { balance: LeaveBalance; }

export default function LeaveBalanceCard({ balance }: LeaveBalanceCardProps) {
  const entitlements = (balance.entitlements || []).filter((item) => item.active);
  return (
    <div className="suite-panel overflow-hidden">
      {entitlements.map((item) => {
        const available = item.available ?? item.remaining - item.pending;
        const used = item.total > 0 ? Math.min(100, (item.used / item.total) * 100) : 0;
        return (
          <div key={item.leaveTypeKey} className="border-b px-5 py-5 last:border-b-0" style={{ borderColor: 'var(--suite-line)' }}>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">{getLeaveTypeLabel(item.leaveTypeKey, item.leaveTypeName)}</p>
                <p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>
                  {item.used} used · {item.pending} pending{item.source === 'override' ? ' · adjusted' : ''}
                </p>
              </div>
              <p className="text-sm"><span className="text-xl font-semibold">{available}</span> <span style={{ color: 'var(--suite-muted)' }}>/ {item.total} days</span></p>
            </div>
            <div className="suite-progress mt-4"><span style={{ width: `${used}%` }} /></div>
          </div>
        );
      })}
      {entitlements.length === 0 && (
        <p className="px-5 py-8 text-sm text-muted-foreground">No active leave entitlements are configured.</p>
      )}
    </div>
  );
}

interface BalanceSummaryProps {
  summary: { totalAvailable: number; totalUsed: number; totalPending: number; byType: Record<string, unknown>; };
}

export function BalanceSummary({ summary }: BalanceSummaryProps) {
  return (
    <div className="suite-metrics lg:grid-cols-3">
      <div className="suite-metric"><p className="suite-label">Available</p><p className="suite-metric-value">{summary.totalAvailable} days</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-positive)' }}>Ready to request</p></div>
      <div className="suite-metric"><p className="suite-label">Used this year</p><p className="suite-metric-value">{summary.totalUsed} days</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-muted)' }}>Approved time off</p></div>
      <div className="suite-metric"><p className="suite-label">Pending</p><p className="suite-metric-value">{summary.totalPending} days</p><p className="mt-1 text-xs" style={{ color: 'var(--suite-warning)' }}>Awaiting a decision</p></div>
    </div>
  );
}
