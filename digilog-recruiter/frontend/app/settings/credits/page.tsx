'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Coins, 
  TrendingUp, 
  TrendingDown,
  Calendar, 
  AlertTriangle,
  ShoppingCart,
  History,
  DollarSign,
  BarChart3,
  RefreshCw,
  Info,
  Clock,
  Zap,
  Loader2
} from 'lucide-react';
import { useOrganization } from '@/context/OrganizationContext';
import { getCreditStatus, getCreditTransactions, getCreditPacks, purchaseCredits, CreditStatus, CreditTransaction, CreditPack } from '@/services/creditsService';
import { toast } from '@/components/ui/use-toast';
import { useRouter } from 'next/navigation';
import { PurchaseResultModal } from '@/components/ui/purchase-result-modal';

export default function CreditsSettingsPage() {
  const { currentOrganization } = useOrganization();
  const router = useRouter();
  const [credits, setCredits] = useState<CreditStatus | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [purchasingPackId, setPurchasingPackId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: 'success' | 'error';
    title: string;
    description: string;
    packName?: string;
  }>({
    isOpen: false,
    type: 'success',
    title: '',
    description: '',
    packName: undefined
  });

  useEffect(() => {
    if (currentOrganization) {
      loadAllData();
    }
  }, [currentOrganization?._id]);

  const loadAllData = async () => {
    try {
      setLoading(true);
      const [creditsRes, transactionsRes, packsRes] = await Promise.all([
        getCreditStatus(),
        getCreditTransactions({ limit: 50 }),
        getCreditPacks()
      ]);

      if (creditsRes.success) setCredits(creditsRes.credits);
      if (transactionsRes.success) setTransactions(transactionsRes.transactions);
      if (packsRes.success) setPacks(packsRes.packs);
    } catch (error: any) {
      console.error('Error loading credits data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load credits information',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAllData();
    setRefreshing(false);
    toast({
      title: 'Success',
      description: 'Credits data refreshed'
    });
  };

  const handlePurchaseRequest = async (packId: string, packName: string) => {
    console.log('🛒 Starting purchase request for pack:', packId, packName);
    setPurchasingPackId(packId);
    
    try {
      console.log('📡 Calling purchaseCredits API...');
      const response = await purchaseCredits(packId);
      console.log('📥 Purchase request response:', response);
      
      if (response.success) {
        setModalState({
          isOpen: true,
          type: 'success',
          title: 'Purchase Request Submitted',
          description: `Your request for ${packName} has been submitted. An admin will review it shortly.`,
          packName: packName
        });
        // Optionally refresh to show pending requests if we add a section for that
      } else {
        setModalState({
          isOpen: true,
          type: 'error',
          title: 'Failed to Submit Request',
          description: response.msg || response.message || 'Failed to submit purchase request',
          packName: packName
        });
      }
    } catch (error: any) {
      console.error('❌ Error creating purchase request:', error);
      setModalState({
        isOpen: true,
        type: 'error',
        title: 'Error',
        description: error.message || 'Failed to submit purchase request',
        packName: packName
      });
    } finally {
      setPurchasingPackId(null);
    }
  };

  const getCreditsColor = (percentage: number, isLowCredit = false) => {
    if (isLowCredit) return 'text-red-600 dark:text-red-400';
    if (percentage >= 80) return 'text-amber-600 dark:text-amber-400';
    if (percentage >= 50) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-green-600 dark:text-green-400';
  };

  const getCreditsProgressColor = (percentage: number, isLowCredit = false) => {
    if (isLowCredit) return 'bg-red-500 dark:bg-red-400';
    if (percentage >= 80) return 'bg-amber-500 dark:bg-amber-400';
    if (percentage >= 50) return 'bg-yellow-500 dark:bg-yellow-400';
    return 'bg-green-500 dark:bg-green-400';
  };

  const getCreditsBackgroundColor = (percentage: number, isLowCredit = false) => {
    if (isLowCredit) return 'bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800';
    if (percentage >= 80) return 'bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800';
    if (percentage >= 50) return 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800';
    return 'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800';
  };

  const formatActionName = (action: string) => {
    const names: { [key: string]: string } = {
      createJob: 'Create Job',
      uploadCandidate: 'Upload Candidate',
      scheduleInterview: 'Schedule Interview',
      aiMatching: 'AI Matching',
      generateQuestions: 'Generate Questions',
      aiAnalysis: 'AI Analysis',
      aiInterviewCandidate: 'AI Interview Candidate',
      bulkUpload: 'Bulk Upload',
      reEmbed: 'Re-embed',
      creditPurchase: 'Credit Purchase',
      cycleReset: 'Cycle Reset',
      creditRefund: 'Credit Refund'
    };
    return names[action] || action;
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatMoneyPerCredit = (n: number) => {
    if (!Number.isFinite(n) || n <= 0) return '0.00';
    return n >= 0.01 ? n.toFixed(2) : n.toFixed(4);
  };

  if (!currentOrganization) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="max-w-md bg-white dark:bg-gray-800">
          <CardHeader>
            <CardTitle className="text-gray-900 dark:text-white">No Organization Selected</CardTitle>
            <CardDescription className="dark:text-gray-400">
              Please select an organization to view credits information.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">Loading credits information...</p>
        </div>
      </div>
    );
  }

  if (!credits) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="max-w-md bg-white dark:bg-gray-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
              <AlertTriangle className="w-5 h-5 text-red-500 dark:text-red-400" />
              Credits Not Available
            </CardTitle>
            <CardDescription className="dark:text-gray-400">
              Unable to load credits information. Please try again later.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleRefresh} className="w-full">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Credits Management</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Manage your organization's credit usage and purchases
          </p>
        </div>
        <Button 
          onClick={handleRefresh} 
          disabled={refreshing}
          variant="outline"
          className="flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Warning Banner */}
      {credits.warnings.lowCredit && (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-800">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-900 dark:text-red-100 mb-1">Low Credits Warning</h3>
                <p className="text-sm text-red-700 dark:text-red-300 mb-3">
                  You have only {credits.remainingCredits} credits remaining ({credits.percentageUsed.toFixed(1)}% used). 
                  Consider purchasing additional credits or upgrading your plan to avoid service interruption.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setActiveTab('purchase')} className="bg-red-600 hover:bg-red-700">
                    <ShoppingCart className="w-4 h-4 mr-2" />
                    Purchase Credits
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => router.push('/settings/subscription')}>
                    Upgrade Plan
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className={getCreditsBackgroundColor(credits.percentageUsed, credits.warnings.lowCredit)}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Remaining</p>
                <p className={`text-3xl font-bold ${getCreditsColor(credits.percentageUsed, credits.warnings.lowCredit)}`}>
                  {credits.remainingCredits}
                </p>
              </div>
              <Coins className={`w-10 h-10 ${getCreditsColor(credits.percentageUsed, credits.warnings.lowCredit)}`} />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-gray-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">{credits.totalCredits}</p>
              </div>
              <BarChart3 className="w-10 h-10 text-blue-600 dark:text-blue-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-gray-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Used</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">{credits.usedCredits}</p>
              </div>
              <TrendingDown className="w-10 h-10 text-purple-600 dark:text-purple-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-gray-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Days Until Reset</p>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">{Math.max(0, credits.daysUntilReset)}</p>
              </div>
              <Clock className="w-10 h-10 text-orange-600 dark:text-orange-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">
            <BarChart3 className="w-4 h-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="transactions">
            <History className="w-4 h-4 mr-2" />
            History
          </TabsTrigger>
          <TabsTrigger value="costs">
            <DollarSign className="w-4 h-4 mr-2" />
            Costs
          </TabsTrigger>
          <TabsTrigger value="purchase">
            <ShoppingCart className="w-4 h-4 mr-2" />
            Purchase
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <Card className="bg-white dark:bg-gray-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
                <TrendingUp className="w-5 h-5" />
                Credit Usage Overview
              </CardTitle>
              <CardDescription className="dark:text-gray-400">
                Current billing cycle: {new Date(credits.cycleStart).toLocaleDateString()} - {new Date(credits.cycleEnd).toLocaleDateString()}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">Usage Progress</span>
                  <span className={`font-bold ${getCreditsColor(credits.percentageUsed, credits.warnings.lowCredit)}`}>
                    {credits.percentageUsed.toFixed(1)}%
                  </span>
                </div>
                <Progress 
                  value={credits.percentageUsed} 
                  className="h-3"
                />
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>{credits.usedCredits} used</span>
                  <span>{credits.remainingCredits} remaining</span>
                </div>
              </div>

              {/* Usage Breakdown */}
              {credits.usageBreakdown && Object.keys(credits.usageBreakdown).length > 0 && (
                <div>
                  <h4 className="font-semibold mb-3 text-gray-900 dark:text-white">Usage Breakdown</h4>
                  <div className="space-y-2">
                    {Object.entries(credits.usageBreakdown).map(([action, data]: [string, any]) => (
                      <div key={action} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="flex items-center gap-3">
                          <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          <span className="font-medium text-gray-900 dark:text-white">{formatActionName(action)}</span>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-gray-600 dark:text-gray-400">{data.count} times</span>
                          <Badge variant="secondary">{data.credits} credits</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Additional Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t dark:border-gray-700">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm text-gray-900 dark:text-white">Rollover Credits</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{credits.rolloverCredits} credits from previous cycle</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <ShoppingCart className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm text-gray-900 dark:text-white">Purchased Credits</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{credits.purchasedCredits} additional credits</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Transactions Tab */}
        <TabsContent value="transactions" className="space-y-6">
          <Card className="bg-white dark:bg-gray-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
                <History className="w-5 h-5" />
                Transaction History
              </CardTitle>
              <CardDescription className="dark:text-gray-400">
                All credit transactions for your organization
              </CardDescription>
            </CardHeader>
            <CardContent>
              {transactions.length === 0 ? (
                <div className="text-center py-12">
                  <History className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
                  <p className="text-gray-500 dark:text-gray-400">No transactions yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {transactions.map((transaction, index) => (
                    <div 
                      key={index} 
                      className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-2 h-2 rounded-full ${transaction.credits > 0 ? 'bg-green-500' : 'bg-red-500'}`} />
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{formatActionName(transaction.action)}</p>
                          <p className="text-sm text-gray-500 dark:text-gray-400">{formatDate(transaction.timestamp)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold ${transaction.credits > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {transaction.credits > 0 ? '+' : ''}{transaction.credits}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Balance: {transaction.balanceAfter}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Costs Tab */}
        <TabsContent value="costs" className="space-y-6">
          <Card className="bg-white dark:bg-gray-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
                <DollarSign className="w-5 h-5" />
                Credit Costs
              </CardTitle>
              <CardDescription className="dark:text-gray-400">
                Cost per action for your organization's plan
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(credits.creditCosts).map(([action, cost]) => (
                  <Card key={action} className="border-2 bg-white dark:bg-gray-700 dark:border-gray-600">
                    <CardContent className="pt-6 text-center">
                      <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Coins className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                      </div>
                      <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mb-1">{cost}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">{formatActionName(action)}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Purchase Tab */}
        <TabsContent value="purchase" className="space-y-6">
          <Card className="bg-white dark:bg-gray-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
                <ShoppingCart className="w-5 h-5" />
                Purchase Additional Credits
              </CardTitle>
              <CardDescription className="dark:text-gray-400">
                Request additional credits - admin approval required
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {packs.map((pack) => (
                  <Card key={pack.id} className={`border-2 bg-white dark:bg-gray-700 ${pack.popular ? 'border-blue-500 dark:border-blue-400' : 'dark:border-gray-600'}`}>
                    <CardHeader>
                      {pack.popular && (
                        <Badge className="w-fit mb-2 bg-blue-600 dark:bg-blue-500">Most Popular</Badge>
                      )}
                      <CardTitle className="text-gray-900 dark:text-white">{pack.name}</CardTitle>
                      <CardDescription className="dark:text-gray-400">{pack.bestFor}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold text-gray-900 dark:text-white">${pack.price}</span>
                        <span className="text-gray-600 dark:text-gray-300">
                          for {pack.credits} credits
                          {pack.bonusCredits ? ` (${pack.credits - pack.bonusCredits} + ${pack.bonusCredits} bonus)` : ''}
                        </span>
                      </div>
                      <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                        <div className="flex justify-between">
                          <span>Price per credit:</span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            ${formatMoneyPerCredit(pack.pricePerCredit)}
                          </span>
                        </div>
                        {(pack.bonusCredits || 0) > 0 && (
                          <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                            <span>Bonus credits:</span>
                            <span className="font-medium">+{pack.bonusCredits}</span>
                          </div>
                        )}
                      </div>
                      <Button 
                        className="w-full" 
                        onClick={() => handlePurchaseRequest(pack.id, pack.name)}
                        disabled={purchasingPackId === pack.id}
                      >
                        {purchasingPackId === pack.id ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Submitting...
                          </>
                        ) : (
                          <>
                            <ShoppingCart className="w-4 h-4 mr-2" />
                            Request Purchase
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
                <h4 className="font-semibold mb-2 flex items-center gap-2 text-gray-900 dark:text-white">
                  <Info className="w-4 h-4" />
                  About Purchased Credits
                </h4>
                <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                  <li>• Purchase requests require admin approval</li>
                  <li>• Purchased credits never expire</li>
                  <li>• They supplement your monthly allocation</li>
                  <li>• Monthly credits are used first, then purchased credits</li>
                  <li>• Unused purchased credits carry over indefinitely</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Full Analytics Link */}
      <Card className="bg-gradient-to-r from-[#F1ECFF] to-[#E9E2FB] dark:from-[#1E0059] dark:to-purple-950 border-blue-200 dark:border-blue-800">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-lg mb-1 text-gray-900 dark:text-white">Need more detailed analytics?</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                View comprehensive charts, projections, and insights in the Credits Analytics dashboard
              </p>
            </div>
            <Button onClick={() => router.push('/analytics/credits')}>
              <BarChart3 className="w-4 h-4 mr-2" />
              View Analytics
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Purchase Result Modal */}
      <PurchaseResultModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState({ ...modalState, isOpen: false })}
        type={modalState.type}
        title={modalState.title}
        description={modalState.description}
        packName={modalState.packName}
      />
    </div>
  );
}
