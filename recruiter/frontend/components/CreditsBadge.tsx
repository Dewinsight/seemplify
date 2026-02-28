'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Coins, TrendingDown, AlertTriangle, ArrowRight } from 'lucide-react';
import { getCreditStatus, CreditStatus } from '@/services/creditsService';
import { useRouter } from 'next/navigation';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export default function CreditsBadge() {
  const [credits, setCredits] = useState<CreditStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    loadCredits();
    
    // Refresh credits every 30 seconds
    const interval = setInterval(loadCredits, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadCredits = async () => {
    try {
      const response = await getCreditStatus();
      if (response.success) {
        setCredits(response.credits);
      }
    } catch (error) {
      console.error('Error loading credits:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !credits) {
    return null;
  }

  const getStatusColor = () => {
    if (credits.warnings.lowCredit) return 'text-red-500';
    if (credits.percentageUsed >= 80) return 'text-amber-500';
    if (credits.percentageUsed >= 50) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getProgressColor = () => {
    if (credits.warnings.lowCredit) return 'bg-red-500';
    if (credits.percentageUsed >= 80) return 'bg-amber-500';
    if (credits.percentageUsed >= 50) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <motion.button
            onClick={() => router.push('/analytics/credits')}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 transition-colors border border-slate-700"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            {credits.warnings.lowCredit ? (
              <AlertTriangle className={`w-4 h-4 ${getStatusColor()} animate-pulse`} />
            ) : (
              <Coins className={`w-4 h-4 ${getStatusColor()}`} />
            )}
            
            <div className="flex flex-col items-start min-w-[80px]">
              <div className="text-xs text-slate-400">Credits</div>
              <div className={`text-sm font-semibold ${getStatusColor()}`}>
                {credits.remainingCredits} / {credits.totalCredits}
              </div>
            </div>
            
            <div className="w-16 bg-slate-700 rounded-full h-1.5 overflow-hidden">
              <motion.div
                className={`h-full ${getProgressColor()}`}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(credits.percentageUsed, 100)}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </motion.button>
        </TooltipTrigger>
        
        <TooltipContent side="bottom" className="w-80 p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">Credit Usage</h4>
              <span className={`text-sm font-medium ${getStatusColor()}`}>
                {credits.percentageUsed.toFixed(1)}% used
              </span>
            </div>
            
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Remaining:</span>
                <span className="font-medium">{credits.remainingCredits} credits</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-slate-400">Reset in:</span>
                <span className="font-medium">{Math.max(0, credits.daysUntilReset)} days</span>
              </div>
              
              {credits.rolloverCredits > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Rollover:</span>
                  <span className="font-medium text-green-500">+{credits.rolloverCredits}</span>
                </div>
              )}
            </div>
            
            {credits.warnings.lowCredit && (
              <div className="bg-red-500/10 border border-red-500/20 rounded p-2 text-xs text-red-400">
                ⚠️ Low credits! Consider purchasing more or upgrading your plan.
              </div>
            )}
            
            <button
              onClick={() => router.push('/analytics/credits')}
              className="w-full flex items-center justify-center space-x-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium transition-colors"
            >
              <span>View Details</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

