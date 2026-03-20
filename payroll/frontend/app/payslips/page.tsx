'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api, { authApi, handleAuthCallback, isAuthenticated } from '@/lib/api';
import { formatPayrollMoney } from '@/lib/payrollMoney';
import { ArrowLeft, Download, FileText, Loader2 } from 'lucide-react';

type Money = number;

type Payslip = {
  _id: string;
  payslipNumber: string;
  currency: string;
  status: string;
  netPay: Money;
  payPeriod?: { month?: number; year?: number; paymentDate?: string };
  earnings?: Array<{ type: string; name: string; amount: Money }>;
  deductions?: Array<{ type: string; name: string; amount: Money }>;
  earningsSummary?: { grossPay?: Money };
  deductionsSummary?: { totalDeductions?: Money };
  createdAt?: string;
};

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function MyPayslipsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [isHRAdmin, setIsHRAdmin] = useState(false);

  useEffect(() => {
    handleAuthCallback();

    if (!isAuthenticated()) {
      router.push('/login');
      return;
    }

    (async () => {
      try {
        const [meRes, payslipRes] = await Promise.all([
          authApi.getMe(),
          api.get('/payroll/my-payslips'),
        ]);

        const currentOrgId = meRes.currentOrganizationId;
        const currentOrg =
          meRes.user?.organizations?.find((o: any) => o.id === currentOrgId) ||
          meRes.user?.organizations?.[0];
        setIsHRAdmin(!!currentOrg && ['owner', 'admin', 'hr_manager'].includes(currentOrg.role));

        const data = payslipRes.data;
        setPayslips(Array.isArray(data) ? data : data?.payslips || []);
      } catch (err) {
        console.error('Failed to fetch payslips:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const totals = useMemo(() => {
    const gross = payslips.reduce((sum, p) => sum + (Number(p.earningsSummary?.grossPay) || 0), 0);
    const deductions = payslips.reduce((sum, p) => sum + (Number(p.deductionsSummary?.totalDeductions) || 0), 0);
    const net = payslips.reduce((sum, p) => sum + (Number(p.netPay) || 0), 0);
    return { gross, deductions, net };
  }, [payslips]);

  const displayCurrency = payslips[0]?.currency || 'USD';

  const downloadPdf = async (payslipId: string, payslipNumber?: string) => {
    setDownloadingId(payslipId);
    try {
      const res = await api.get(`/payroll/payslips/${payslipId}/pdf`, { responseType: 'blob' });
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = payslipNumber ? `${payslipNumber}.pdf` : `payslip-${payslipId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Failed to download PDF');
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 p-8 pb-20">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link
              href="/dashboard"
              className="inline-flex items-center text-sm text-zinc-400 hover:text-amber-400 mb-2 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Dashboard
            </Link>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
              My Payslips
            </h1>
            <p className="text-zinc-500 mt-1">View and download your approved payroll statements</p>
          </div>
        </div>

        {payslips.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
              <div className="text-xs text-zinc-500 mb-1">Total Gross</div>
              <div className="text-2xl font-bold text-zinc-100 font-mono">{formatPayrollMoney(totals.gross, displayCurrency)}</div>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
              <div className="text-xs text-zinc-500 mb-1">Total Deductions</div>
              <div className="text-2xl font-bold text-red-400 font-mono">{formatPayrollMoney(totals.deductions, displayCurrency)}</div>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
              <div className="text-xs text-zinc-500 mb-1">Total Net</div>
              <div className="text-2xl font-bold text-emerald-400 font-mono">{formatPayrollMoney(totals.net, displayCurrency)}</div>
            </div>
          </div>
        )}

        {payslips.length === 0 ? (
          <div className="text-center py-20 bg-zinc-900/50 border border-zinc-800 rounded-2xl">
            <div className="w-16 h-16 bg-zinc-800/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-zinc-600" />
            </div>
            <h3 className="text-zinc-300 font-medium mb-1">No payslips yet</h3>
            <p className="text-zinc-500 text-sm">Your payslips will appear once HR approves and finalizes payroll.</p>
            {isHRAdmin && (
              <p className="text-zinc-500 text-xs mt-2">
                In admin workflows, draft payslips appear after payroll calculation. Open payroll runs to review status.
              </p>
            )}
            {isHRAdmin && (
              <div className="mt-4">
                <Link
                  href="/admin/runs"
                  className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs px-3 py-2"
                >
                  Go to Payroll Runs
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {payslips.map((slip) => {
              const m = slip.payPeriod?.month ? monthNames[slip.payPeriod.month - 1] : 'Period';
              const y = slip.payPeriod?.year || '';
              const gross = Number(slip.earningsSummary?.grossPay) || 0;
              const ded = Number(slip.deductionsSummary?.totalDeductions) || 0;
              const net = Number(slip.netPay) || 0;

              return (
                <div key={slip._id} className="bg-zinc-900/70 border border-zinc-800 rounded-2xl overflow-hidden">
                  <div className="p-5 flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-zinc-100">{m} {y}</h3>
                        <span className="text-xs text-zinc-500 font-mono">{slip.payslipNumber}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700/50 capitalize">
                          {slip.status?.replace(/_/g, ' ') || 'unknown'}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <div className="text-xs text-zinc-500">Gross</div>
                          <div className="font-mono text-zinc-200">{formatPayrollMoney(gross, slip.currency || 'USD')}</div>
                        </div>
                        <div>
                          <div className="text-xs text-zinc-500">Deductions</div>
                          <div className="font-mono text-red-400">{formatPayrollMoney(ded, slip.currency || 'USD')}</div>
                        </div>
                        <div>
                          <div className="text-xs text-zinc-500">Net</div>
                          <div className="font-mono text-emerald-400">{formatPayrollMoney(net, slip.currency || 'USD')}</div>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => downloadPdf(slip._id, slip.payslipNumber)}
                      disabled={downloadingId === slip._id}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50"
                    >
                      <Download className="w-4 h-4" />
                      {downloadingId === slip._id ? 'Downloading...' : 'PDF'}
                    </button>
                  </div>

                  <div className="border-t border-zinc-800/70 p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Earnings</div>
                      <div className="space-y-2">
                        {(slip.earnings || []).map((e, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm">
                            <span className="text-zinc-300">{e.name}</span>
                            <span className="font-mono text-zinc-200">{formatPayrollMoney(e.amount || 0, slip.currency || 'USD')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Deductions</div>
                      <div className="space-y-2">
                        {(slip.deductions || []).map((d, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm">
                            <span className="text-zinc-300">{d.name}</span>
                            <span className="font-mono text-red-400">{formatPayrollMoney(-(Number(d.amount || 0)), slip.currency || 'USD')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
