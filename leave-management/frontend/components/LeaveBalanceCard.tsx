'use client';

import { LeaveBalance } from '@/types';
import { getLeaveTypeLabel } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface LeaveBalanceCardProps {
  balance: LeaveBalance;
}

export default function LeaveBalanceCard({ balance }: LeaveBalanceCardProps) {
  const leaveTypes = ['annual', 'sick', 'personal'] as const;

  return (
    <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-slate-200/50 p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-purple-500/5 to-pink-500/5" />
      <div className="relative">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-slate-900">Leave Balance</h3>
          <Badge variant="outline" className="bg-white/60">This year</Badge>
        </div>
      <div className="space-y-4">
        {leaveTypes.map((type) => {
          const typeBalance = balance[type];
          const available = typeBalance.remaining - typeBalance.pending;
          const percentage = typeBalance.total > 0
            ? (typeBalance.used / typeBalance.total) * 100
            : 0;

          return (
            <div key={type}>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold text-slate-800">
                  {getLeaveTypeLabel(type)}
                </span>
                <span className="text-sm text-slate-600">
                  <span className="font-semibold text-slate-800">{available}</span>
                  <span className="text-slate-500"> / {typeBalance.total} days</span>
                </span>
              </div>
              <div className="w-full bg-slate-200/70 rounded-full h-2.5 overflow-hidden relative">
                <div
                  className="bg-gradient-to-r from-blue-500 to-purple-600 h-2.5 rounded-full transition-all"
                  style={{ width: `${Math.min(percentage, 100)}%` }}
                />
                <div className="animate-shimmer absolute inset-y-0 left-0 w-1/3 bg-white/30 blur-sm" />
              </div>
              {typeBalance.pending > 0 && (
                <p className="text-xs text-amber-700 mt-2">
                  {typeBalance.pending} day(s) pending approval
                </p>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

interface BalanceSummaryProps {
  summary: {
    totalAvailable: number;
    totalUsed: number;
    totalPending: number;
    byType: Record<string, {
      total: number;
      used: number;
      remaining: number;
      pending: number;
      available: number;
    }>;
  };
}

export function BalanceSummary({ summary }: BalanceSummaryProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-green-50 rounded-xl p-4 border border-green-100">
        <p className="text-sm font-medium text-green-700">Available</p>
        <p className="text-2xl font-bold text-green-900">{summary.totalAvailable} days</p>
      </div>
      <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
        <p className="text-sm font-medium text-blue-700">Used</p>
        <p className="text-2xl font-bold text-blue-900">{summary.totalUsed} days</p>
      </div>
      <div className="bg-yellow-50 rounded-xl p-4 border border-yellow-100">
        <p className="text-sm font-medium text-yellow-700">Pending</p>
        <p className="text-2xl font-bold text-yellow-900">{summary.totalPending} days</p>
      </div>
    </div>
  );
}
