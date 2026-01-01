'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Coins, TrendingDown, TrendingUp, Calendar, ShoppingCart, 
  History, BarChart3, AlertCircle, CheckCircle, ArrowRight 
} from 'lucide-react';
import { getCreditStatus, getCreditTransactions, getCreditPacks, CreditStatus, CreditTransaction, CreditPack } from '@/services/creditsService';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

export default function CreditsAnalyticsPage() {
  const [credits, setCredits] = useState<CreditStatus | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [creditsRes, transactionsRes, packsRes] = await Promise.all([
        getCreditStatus(),
        getCreditTransactions({ limit: 20 }),
        getCreditPacks()
      ]);

      if (creditsRes.success) setCredits(creditsRes.credits);
      if (transactionsRes.success) setTransactions(transactionsRes.transactions);
      if (packsRes.success) setPacks(packsRes.packs);
    } catch (error) {
      console.error('Error loading credits data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-slate-400">Loading credits data...</p>
        </div>
      </div>
    );
  }

  if (!credits) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-slate-900">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 dark:text-red-400 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-slate-400">Failed to load credits data</p>
        </div>
      </div>
    );
  }

  const getStatusColor = (percentage: number) => {
    if (percentage >= 80) return 'text-red-500 dark:text-red-400';
    if (percentage >= 50) return 'text-yellow-500 dark:text-yellow-400';
    return 'text-green-500 dark:text-green-400';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-slate-900 dark:to-slate-800 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Credits Management</h1>
            <p className="text-gray-600 dark:text-slate-400">Monitor and manage your organization's credit usage</p>
          </div>
          
          <Button className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700">
            <ShoppingCart className="w-4 h-4 mr-2" />
            Purchase Credits
          </Button>
        </div>

        {/* Warning Banner */}
        {credits.warnings.lowCredit && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg p-4 flex items-start space-x-3"
          >
            <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-red-700 dark:text-red-400 mb-1">Low Credits Warning</h3>
              <p className="text-sm text-red-600 dark:text-slate-300">
                You have only {credits.remainingCredits} credits remaining ({credits.percentageUsed.toFixed(1)}% used). 
                Consider purchasing more credits or upgrading your plan.
              </p>
            </div>
          </motion.div>
        )}

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="text-gray-700 dark:text-slate-200 flex items-center">
                <Coins className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" />
                Total Credits
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900 dark:text-white">{credits.totalCredits}</div>
              <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">Monthly allocation</p>
            </CardContent>
          </Card>

          <Card className="bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700">
            <CardHeader>
              <CardTitle className={`text-gray-700 dark:text-slate-200 flex items-center`}>
                <TrendingDown className={`w-5 h-5 mr-2 ${getStatusColor(credits.percentageUsed)}`} />
                Used Credits
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${getStatusColor(credits.percentageUsed)}`}>
                {credits.usedCredits}
              </div>
              <div className="flex items-center justify-between mt-2">
                <p className="text-sm text-gray-600 dark:text-slate-400">{credits.percentageUsed.toFixed(1)}% of total</p>
                <Progress value={credits.percentageUsed} className="w-20 h-2" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="text-gray-700 dark:text-slate-200 flex items-center">
                <CheckCircle className="w-5 h-5 mr-2 text-green-600 dark:text-green-400" />
                Remaining
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-600 dark:text-green-400">{credits.remainingCredits}</div>
              <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">Credits available</p>
            </CardContent>
          </Card>

          <Card className="bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700">
            <CardHeader>
              <CardTitle className="text-gray-700 dark:text-slate-200 flex items-center">
                <Calendar className="w-5 h-5 mr-2 text-purple-600 dark:text-purple-400" />
                Cycle Reset
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">{credits.daysUntilReset}</div>
              <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">Days remaining</p>
            </CardContent>
          </Card>
        </div>

        {/* Usage Breakdown */}
        <Card className="bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700">
          <CardHeader>
            <CardTitle className="text-gray-900 dark:text-white">Credit Usage Breakdown</CardTitle>
            <CardDescription className="dark:text-slate-400">See how your credits are being used</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {Object.entries(credits.usageBreakdown).map(([action, data]) => (
                <div key={action} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <BarChart3 className="w-4 h-4 text-gray-600 dark:text-slate-400" />
                    <span className="text-gray-900 dark:text-slate-200 capitalize">{action.replace(/([A-Z])/g, ' $1').trim()}</span>
                  </div>
                  <div className="flex items-center space-x-4">
                    <span className="text-gray-600 dark:text-slate-400 text-sm">{data.count} actions</span>
                    <span className="text-gray-900 dark:text-white font-semibold">{data.credits} credits</span>
                  </div>
                </div>
              ))}
              
              {Object.keys(credits.usageBreakdown).length === 0 && (
                <p className="text-gray-600 dark:text-slate-400 text-center py-4">No credit usage this cycle</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Transactions */}
        <Card className="bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700">
          <CardHeader>
            <CardTitle className="text-gray-900 dark:text-white flex items-center">
              <History className="w-5 h-5 mr-2" />
              Recent Transactions
            </CardTitle>
            <CardDescription className="dark:text-slate-400">Last 20 credit transactions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {transactions.map((transaction, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-slate-700/30 hover:bg-gray-100 dark:hover:bg-slate-700/50 transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    {transaction.credits < 0 ? (
                      <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
                    ) : (
                      <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
                    )}
                    <div>
                      <div className="text-gray-900 dark:text-slate-200 font-medium capitalize">
                        {transaction.action.replace(/([A-Z])/g, ' $1').trim()}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-slate-400">
                        {new Date(transaction.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  
                  <div className="text-right">
                    <div className={`font-semibold ${transaction.credits < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                      {transaction.credits > 0 ? '+' : ''}{transaction.credits}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-slate-400">
                      Balance: {transaction.balanceAfter}
                    </div>
                  </div>
                </div>
              ))}
              
              {transactions.length === 0 && (
                <p className="text-gray-600 dark:text-slate-400 text-center py-8">No transactions yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Credit Packs */}
        <Card className="bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700">
          <CardHeader>
            <CardTitle className="text-gray-900 dark:text-white">Purchase Additional Credits</CardTitle>
            <CardDescription className="dark:text-slate-400">Top up your credits anytime with these packs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {packs.map((pack) => (
                <div
                  key={pack.id}
                  className={`relative p-4 rounded-lg border ${
                    pack.popular 
                      ? 'border-blue-500 dark:border-blue-500 bg-blue-50 dark:bg-blue-500/10' 
                      : 'border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-700/30'
                  }`}
                >
                  {pack.popular && (
                    <div className="absolute -top-2 -right-2 bg-blue-600 dark:bg-blue-600 text-white text-xs px-2 py-1 rounded-full">
                      Popular
                    </div>
                  )}
                  
                  <div className="text-center">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-2">{pack.name}</h3>
                    <div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-1">
                      {pack.credits}
                    </div>
                    <p className="text-xs text-gray-600 dark:text-slate-400 mb-4">credits</p>
                    
                    <div className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                      ${pack.price}
                    </div>
                    <p className="text-xs text-gray-600 dark:text-slate-400 mb-4">
                      ${pack.pricePerCredit.toFixed(2)}/credit
                    </p>
                    
                    {pack.savings > 0 && (
                      <div className="bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400 text-xs px-2 py-1 rounded mb-4">
                        Save ${pack.savings}
                      </div>
                    )}
                    
                    <Button className="w-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700" size="sm">
                      Purchase
                    </Button>
                    
                    <p className="text-xs text-gray-500 dark:text-slate-500 mt-2">{pack.bestFor}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

