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
    <div className="bg-card dark:bg-gradient-to-br dark:from-zinc-900/90 dark:to-zinc-800/90 backdrop-blur-xl rounded-xl shadow-lg border border-border dark:border-zinc-700/50 p-6 relative overflow-hidden hover:border-purple-500/50 hover:shadow-purple-500/10 transition-all duration-300">
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-pink-500/5 to-indigo-500/5 opacity-0 hover:opacity-100 transition-opacity" />
      <div className="relative">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-foreground dark:text-zinc-100">Leave Balance</h3>
          <Badge variant="outline" className="bg-muted dark:bg-zinc-800/60 border-border dark:border-zinc-700 text-muted-foreground dark:text-zinc-300">This year</Badge>
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
                  <span className="text-sm font-semibold text-foreground dark:text-zinc-200">
                    {getLeaveTypeLabel(type)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground dark:text-zinc-200">{available}</span>
                    <span className="text-muted-foreground dark:text-zinc-500"> / {typeBalance.total} days</span>
                  </span>
                </div>
                <div className="w-full bg-muted dark:bg-zinc-800/70 rounded-full h-2.5 overflow-hidden relative">
                  <div
                    className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(percentage, 100)}%` }}
                  />
                  <div className="animate-shimmer absolute inset-y-0 left-0 w-1/3 bg-white/20 blur-sm" />
                </div>
                {typeBalance.pending > 0 && (
                  <p className="text-xs text-amber-400 mt-2 bg-amber-500/10 px-2 py-1 rounded-md inline-block">
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
      <div className="bg-card dark:bg-gradient-to-br dark:from-zinc-900/90 dark:to-zinc-800/90 rounded-xl p-5 border border-green-500/20 hover:border-green-500/40 transition-all duration-300 shadow-lg hover:shadow-green-500/10 relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
        <p className="text-sm font-medium text-green-400 relative">Available</p>
        <p className="text-3xl font-bold text-green-300 relative">{summary.totalAvailable} days</p>
      </div>
      <div className="bg-card dark:bg-gradient-to-br dark:from-zinc-900/90 dark:to-zinc-800/90 rounded-xl p-5 border border-indigo-500/20 hover:border-indigo-500/40 transition-all duration-300 shadow-lg hover:shadow-indigo-500/10 relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
        <p className="text-sm font-medium text-indigo-400 relative">Used</p>
        <p className="text-3xl font-bold text-indigo-300 relative">{summary.totalUsed} days</p>
      </div>
      <div className="bg-card dark:bg-gradient-to-br dark:from-zinc-900/90 dark:to-zinc-800/90 rounded-xl p-5 border border-amber-500/20 hover:border-amber-500/40 transition-all duration-300 shadow-lg hover:shadow-amber-500/10 relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-yellow-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
        <p className="text-sm font-medium text-amber-400 relative">Pending</p>
        <p className="text-3xl font-bold text-amber-300 relative">{summary.totalPending} days</p>
      </div>
    </div>
  );
}
