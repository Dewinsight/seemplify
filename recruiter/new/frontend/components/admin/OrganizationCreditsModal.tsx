'use client';

import { useState, useEffect } from 'react';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Minus, RefreshCw } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { apiRequest } from "@/services/apiConfig";

interface CreditTransaction {
  action: string;
  credits: number;
  entityId?: string;
  entityType?: string;
  performedBy?: string;
  timestamp: string;
  balanceAfter: number;
  metadata?: any;
}

interface OrganizationCreditInfo {
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  cycleStart: string;
  cycleEnd: string;
  transactions: CreditTransaction[];
}

interface Organization {
  _id: string;
  name: string;
  subscription?: {
    plan?: string;
    creditUsage?: OrganizationCreditInfo;
  };
}

interface OrganizationCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  organization: Organization | null;
  onSuccess: () => void;
}

export default function OrganizationCreditsModal({ 
  isOpen, 
  onClose, 
  organization, 
  onSuccess 
}: OrganizationCreditsModalProps) {
  const [loading, setLoading] = useState(false);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [creditInfo, setCreditInfo] = useState<OrganizationCreditInfo | null>(null);
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [creditsAmount, setCreditsAmount] = useState(0);
  const [adjustmentType, setAdjustmentType] = useState<'add' | 'remove'>('add');
  const [reason, setReason] = useState('');
  const [localOrganization, setLocalOrganization] = useState<Organization | null>(organization);
  
  const { toast } = useToast();

  // Update local organization when prop changes
  useEffect(() => {
    setLocalOrganization(organization);
  }, [organization]);

  // Fetch credit info when the modal is opened
  useEffect(() => {
    if (isOpen && organization?._id) {
      fetchCreditInfo();
    }
  }, [isOpen, organization?._id]);

  const fetchCreditInfo = async () => {
    if (!organization?._id) return;
    
    setTransactionsLoading(true);
    
    try {
      const token = localStorage.getItem('adminToken');
      if (!token) {
        throw new Error("Authentication required");
      }

      // Fetch the organization details to get latest credit info
      const orgResponse = await apiRequest(`/api/admin/organizations/${organization._id}`, {
        headers: {
          'x-admin-auth-token': token
        }
      });

      if (orgResponse.ok) {
        const orgData = await orgResponse.json();
        if (orgData.organization) {
          // Update local organization with fresh data
          setLocalOrganization(orgData.organization);
          
          // Extract transactions from credit usage
          const creditUsage = orgData.organization.subscription?.creditUsage;
          if (creditUsage?.transactions) {
            // Sort transactions by timestamp (newest first) and limit to 20
            const sortedTransactions = [...creditUsage.transactions]
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              .slice(0, 20);
            setTransactions(sortedTransactions);
          } else {
            setTransactions([]);
          }
        }
      }
    } catch (err: any) {
      console.error('Error fetching credit info:', err);
      // Don't show error toast for fetch failures
    } finally {
      setTransactionsLoading(false);
    }
  };

  const handleAdjustCredits = async () => {
    if (creditsAmount <= 0) {
      toast({
        title: "Invalid Input",
        description: "Credits must be a positive number",
        variant: "destructive"
      });
      return;
    }

    if (!reason.trim()) {
      toast({
        title: "Reason Required",
        description: `Please provide a reason for ${adjustmentType === 'add' ? 'adding' : 'removing'} credits`,
        variant: "destructive"
      });
      return;
    }

    const currentBalance = localOrganization?.subscription?.creditUsage?.remainingCredits || 0;
    
    if (adjustmentType === 'remove' && creditsAmount > currentBalance) {
      toast({
        title: "Insufficient Credits",
        description: `Cannot remove ${creditsAmount} credits. Organization only has ${currentBalance} credits.`,
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    
    try {
      const token = localStorage.getItem('adminToken');
      if (!token) {
        throw new Error("Authentication required");
      }

      const response = await apiRequest(`/api/admin/organizations/${organization?._id}/credits`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth-token': token
        },
        body: JSON.stringify({
          credits: creditsAmount,
          adjustmentType,
          reason: reason.trim()
        })
      });

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.msg || `Failed to ${adjustmentType} credits`);
      }
      
      toast({
        title: "Credits Adjusted",
        description: `Successfully ${adjustmentType === 'add' ? 'added' : 'removed'} ${creditsAmount} credits`,
      });
      
      // Reset form
      setCreditsAmount(0);
      setReason('');
      setAdjustmentType('add');
      
      // Immediately fetch updated info
      await fetchCreditInfo();
      
      // Also notify parent to refresh the org list
      onSuccess();
      
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    try {
      await fetchCreditInfo();
      onSuccess(); // Also refresh parent
      
      toast({
        title: "Refreshed",
        description: "Credit information has been updated",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: "Failed to refresh credit information",
        variant: "destructive"
      });
    }
  };

  const handleResetCycle = async () => {
    if (!confirm("Are you sure you want to reset the credit cycle? This will restore the full credit allocation and reset usage counters.")) {
      return;
    }

    setLoading(true);
    
    try {
      const token = localStorage.getItem('adminToken');
      if (!token) {
        throw new Error("Authentication required");
      }

      const response = await apiRequest(`/api/credits/admin/${organization?._id}/reset`, {
        method: 'POST',
        headers: {
          'x-admin-auth-token': token
        }
      });

      if (!response.ok) {
        throw new Error("Failed to reset cycle");
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || "Failed to reset cycle");
      }
      
      toast({
        title: "Cycle Reset",
        description: `Credit cycle has been reset successfully`,
      });
      
      // Refresh credit info
      fetchCreditInfo();
      
      // Notify parent
      onSuccess();
      
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'createJob': return 'text-purple-400';
      case 'uploadCandidate': return 'text-green-400';
      case 'scheduleInterview': return 'text-blue-400';
      case 'aiMatching': return 'text-yellow-400';
      case 'generateQuestions': return 'text-pink-400';
      case 'aiAnalysis': return 'text-cyan-400';
      case 'creditPurchase': return 'text-green-500';
      case 'creditRefund': return 'text-blue-500';
      case 'cycleReset': return 'text-yellow-500';
      default: return 'text-gray-400';
    }
  };

  const currentBalance = localOrganization?.subscription?.creditUsage?.remainingCredits || 0;
  const totalCredits = localOrganization?.subscription?.creditUsage?.totalCredits || 0;
  const usedCredits = localOrganization?.subscription?.creditUsage?.usedCredits || 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl w-[95vw] bg-gray-800 border-gray-700 text-white">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl text-white">
              {localOrganization?.name} - Credits Management
            </DialogTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualRefresh}
              disabled={transactionsLoading}
              className="bg-gray-700 hover:bg-gray-600 text-gray-300 border-gray-600"
            >
              {transactionsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </DialogHeader>

        <div className="mt-4">
          {loading && !creditInfo ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                  <div className="text-gray-400 text-sm mb-1">Total Credits</div>
                  <div className="text-white text-2xl font-semibold">
                    {totalCredits}
                  </div>
                </div>
                
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                  <div className="text-gray-400 text-sm mb-1">Used Credits</div>
                  <div className="text-red-400 text-2xl font-semibold">
                    {usedCredits}
                  </div>
                </div>
                
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                  <div className="text-gray-400 text-sm mb-1">Remaining Credits</div>
                  <div className="text-green-400 text-2xl font-semibold">
                    {currentBalance}
                  </div>
                </div>
              </div>

              <div className="mb-6">
                <h3 className="text-lg font-medium text-white mb-2">Adjust Credits</h3>
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                  <div className="grid grid-cols-1 gap-4">
                    {/* Adjustment Type Toggle */}
                    <div>
                      <Label className="text-sm font-medium mb-2 block text-gray-300">Adjustment Type</Label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant={adjustmentType === 'add' ? 'default' : 'outline'}
                          onClick={() => setAdjustmentType('add')}
                          className={adjustmentType === 'add' 
                            ? 'bg-green-600 hover:bg-green-700 text-white' 
                            : 'bg-gray-700 hover:bg-gray-600 text-gray-300 border-gray-600'
                          }
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add Credits
                        </Button>
                        <Button
                          type="button"
                          variant={adjustmentType === 'remove' ? 'default' : 'outline'}
                          onClick={() => setAdjustmentType('remove')}
                          className={adjustmentType === 'remove' 
                            ? 'bg-red-600 hover:bg-red-700 text-white' 
                            : 'bg-gray-700 hover:bg-gray-600 text-gray-300 border-gray-600'
                          }
                        >
                          <Minus className="mr-2 h-4 w-4" />
                          Remove Credits
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="creditsAmount" className="text-gray-300">Number of Credits</Label>
                        <div className="flex items-center gap-2">
                          <Button 
                            variant="outline" 
                            size="icon"
                            onClick={() => setCreditsAmount(Math.max(0, creditsAmount - 10))}
                            className="bg-gray-700 hover:bg-gray-600 text-gray-300 border-gray-600"
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <Input
                            id="creditsAmount"
                            type="number"
                            value={creditsAmount}
                            onChange={(e) => setCreditsAmount(Math.max(0, parseInt(e.target.value) || 0))}
                            className="flex-1 bg-gray-800 border-gray-600 text-white"
                          />
                          <Button 
                            variant="outline" 
                            size="icon"
                            onClick={() => setCreditsAmount(creditsAmount + 10)}
                            className="bg-gray-700 hover:bg-gray-600 text-gray-300 border-gray-600"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      
                      <div>
                        <Label htmlFor="reason" className="text-gray-300">Reason *</Label>
                        <Input
                          id="reason"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder="e.g., Promotional bonus, Refund, etc."
                          className="bg-gray-800 border-gray-600 text-white placeholder:text-gray-500"
                        />
                      </div>
                    </div>

                    {/* Preview */}
                    {creditsAmount > 0 && (
                      <div className={`border rounded-lg p-3 ${
                        adjustmentType === 'add' 
                          ? 'bg-green-950 border-green-800' 
                          : 'bg-orange-950 border-orange-800'
                      }`}>
                        <p className="text-sm text-gray-300">
                          {adjustmentType === 'add' ? 'Adding' : 'Removing'} <span className="font-semibold">{creditsAmount}</span> credits
                          {' → New balance: '}
                          <span className="font-bold">
                            {adjustmentType === 'add' 
                              ? currentBalance + creditsAmount 
                              : currentBalance - creditsAmount
                            }
                          </span>
                        </p>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex justify-between mt-4">
                    <Button
                      variant="outline"
                      onClick={handleResetCycle}
                      disabled={loading}
                      className="bg-gray-700 hover:bg-gray-600 text-gray-300 border-gray-600"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Reset Cycle
                    </Button>
                    
                    <Button
                      onClick={handleAdjustCredits}
                      disabled={loading || creditsAmount <= 0 || !reason.trim()}
                      className={adjustmentType === 'add' 
                        ? "bg-green-600 hover:bg-green-700 text-white" 
                        : "bg-orange-600 hover:bg-orange-700 text-white"
                      }
                    >
                      {loading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : adjustmentType === 'add' ? (
                        <Plus className="mr-2 h-4 w-4" />
                      ) : (
                        <Minus className="mr-2 h-4 w-4" />
                      )}
                      {adjustmentType === 'add' ? 'Add' : 'Remove'} Credits
                    </Button>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-white mb-2">Recent Transactions</h3>
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 overflow-x-auto">
                  {transactionsLoading ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                    </div>
                  ) : transactions.length > 0 ? (
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-gray-700">
                          <th className="py-2 px-4 text-gray-400">Action</th>
                          <th className="py-2 px-4 text-gray-400">Credits</th>
                          <th className="py-2 px-4 text-gray-400">Balance</th>
                          <th className="py-2 px-4 text-gray-400">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((transaction, index) => (
                          <tr key={index} className="border-b border-gray-700/50">
                            <td className={`py-2 px-4 ${getActionColor(transaction.action)}`}>
                              {transaction.action}
                            </td>
                            <td className={`py-2 px-4 ${transaction.credits >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {transaction.credits >= 0 ? `+${transaction.credits}` : transaction.credits}
                            </td>
                            <td className="py-2 px-4 text-gray-300">
                              {transaction.balanceAfter}
                            </td>
                            <td className="py-2 px-4 text-gray-400 text-sm">
                              {formatDate(transaction.timestamp)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-center py-4 text-gray-400">
                      No transaction history available
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="mt-6">
          <Button
            variant="outline"
            onClick={onClose}
            className="bg-gray-700 hover:bg-gray-600 text-white border-gray-600"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
