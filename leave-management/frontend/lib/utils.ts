import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date, formatStr: string = 'MMM dd, yyyy') {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, formatStr);
}

export function formatDateRange(startDate: string | Date, endDate: string | Date) {
  const start = formatDate(startDate);
  const end = formatDate(endDate);

  if (start === end) {
    return start;
  }

  return `${start} - ${end}`;
}

export function getLeaveTypeLabel(type: string, configuredName?: string): string {
  if (configuredName) return configuredName;
  const labels: Record<string, string> = {
    annual: 'Annual Leave',
    sick: 'Sick Leave',
    personal: 'Personal Leave',
    maternity: 'Maternity Leave',
    paternity: 'Paternity Leave',
    unpaid: 'Unpaid Leave',
  };
  return labels[type] || type
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getLeaveTypeColor(type: string): string {
  const colors: Record<string, string> = {
    annual: 'bg-blue-100 text-blue-800',
    sick: 'bg-red-100 text-red-800',
    personal: 'bg-purple-100 text-purple-800',
    maternity: 'bg-pink-100 text-pink-800',
    paternity: 'bg-cyan-100 text-cyan-800',
    unpaid: 'bg-gray-100 text-gray-800',
  };
  return colors[type] || 'bg-gray-100 text-gray-800';
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-800',
  };
  return colors[status] || 'bg-gray-100 text-gray-800';
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  };
  return labels[status] || status;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural || `${singular}s`;
}

export function getEntitlementAdjustmentLabel(adjustment: {
  operation?: 'add' | 'deduct' | 'set' | 'reset';
  delta: number;
}) {
  const operation = adjustment.operation || (adjustment.delta > 0 ? 'add' : adjustment.delta < 0 ? 'deduct' : 'set');
  if (operation === 'add') return `Added ${Math.abs(adjustment.delta)} days`;
  if (operation === 'deduct') return `Deducted ${Math.abs(adjustment.delta)} days`;
  if (operation === 'reset') return 'Reset to organization default';
  return 'Set exact total';
}
