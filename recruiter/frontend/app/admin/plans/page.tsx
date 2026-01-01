"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';
import { 
  Table, TableBody, TableCell, TableHead, 
  TableHeader, TableRow 
} from '@/components/ui/table';
import { 
  Card, CardContent, CardDescription, 
  CardHeader, CardTitle 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { 
  Plus, Edit, Trash2, Check, X, 
  Users, ArrowUpDown, Eye, EyeOff, Loader2, Filter
} from 'lucide-react';
import { apiRequest } from '@/services/apiConfig';
import PlanFormModal from '@/components/admin/plan-form-modal';
import PlanDeleteModal from '@/components/admin/plan-delete-modal';

interface PlanLimit {
  memberLimit: number | string | null | undefined;        // For organization plans
  storageLimit: number | string | null | undefined;       // For organization plans
  apiCallsLimit: number | string | null | undefined;      // For organization plans
}

interface PlanFeature {
  name: string;
  description?: string;
  included: boolean;
}

interface PlanCreditCosts {
  createJob: number;
  uploadCandidate: number;
  scheduleInterview: number;
  aiMatching: number;
  generateQuestions: number;
  aiAnalysis: number;
  bulkUpload: number;
  reEmbed: number;
}

interface PlanCredits {
  totalCredits: number;
  creditCosts: PlanCreditCosts;
  rolloverEnabled: boolean;
  rolloverPercentage: number;
}

interface Plan {
  _id: string;
  name: string;
  code: string;
  price: number;
  currency: string;
  billingCycle: string;
  features: PlanFeature[];
  limits: PlanLimit;
  credits?: PlanCredits;
  trialDays: number;
  isPublished: boolean;
  displayOrder: number;
  planType: 'user' | 'organization';
  isDefault: boolean;
  isCustom: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [planUsageStats, setPlanUsageStats] = useState<Record<string, { usersCount: number; orgsCount: number }>>({});
  // Only organization plans exist now - no filtering needed
  
  const router = useRouter();
  const { toast } = useToast();

  // Load plans from the API
  const fetchPlans = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      if (!token) {
        throw new Error("Authentication required");
      }

      const response = await apiRequest(`/api/plans`, {
        headers: {
          'x-admin-auth-token': token
        }
      });

      if (!response.ok) {
        throw new Error("Failed to fetch plans");
      }

      const data = await response.json();
      if (data.success) {
        setPlans(data.plans);
        // Fetch usage stats for each plan
        fetchPlanUsageStats(data.plans);
      } else {
        throw new Error(data.message || "Failed to fetch plans");
      }
    } catch (err: any) {
      setError(err.message);
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch plan usage statistics
  const fetchPlanUsageStats = async (plansList: Plan[]) => {
    const stats: Record<string, { usersCount: number; orgsCount: number }> = {};
    
    try {
      const token = localStorage.getItem('adminToken');
      if (!token) return;

      for (const plan of plansList) {
        const response = await apiRequest(`/api/plans/${plan._id}/stats`, {
          headers: {
            'x-admin-auth-token': token
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            stats[plan._id] = {
              usersCount: data.stats.usersCount,
              orgsCount: data.stats.orgsCount
            };
          }
        }
      }
      
      setPlanUsageStats(stats);
    } catch (err) {
      console.error("Error fetching plan usage statistics:", err);
    }
  };

  // Toggle plan publish status
  const togglePlanPublish = async (plan: Plan) => {
    try {
      const token = localStorage.getItem('adminToken');
      if (!token) {
        throw new Error("Authentication required");
      }

      const response = await apiRequest(`/api/plans/${plan._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth-token': token
        },
        body: JSON.stringify({
          isPublished: !plan.isPublished
        })
      });

      if (!response.ok) {
        throw new Error("Failed to update plan");
      }

      const data = await response.json();
      if (data.success) {
        // Update plans in state
        setPlans(prev => prev.map(p => 
          p._id === plan._id ? { ...p, isPublished: !p.isPublished } : p
        ));
        
        toast({
          title: "Success",
          description: `Plan ${!plan.isPublished ? 'published' : 'unpublished'} successfully`,
        });
      } else {
        throw new Error(data.message || "Failed to update plan");
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive"
      });
    }
  };

  // Handle create/edit plan
  const handleOpenPlanForm = (plan: Plan | null = null) => {
    setCurrentPlan(plan);
    setIsModalOpen(true);
  };

  // Handle plan deletion
  const handleOpenDeleteModal = (plan: Plan) => {
    setCurrentPlan(plan);
    setIsDeleteModalOpen(true);
  };

  // Format currency display
  const formatCurrency = (price: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(price);
  };

  // Format limit display
  const formatLimit = (limit: number | string | null | undefined) => {
    if (limit === null || limit === undefined) {
      return '0';
    }
    if (limit === 'unlimited' || limit === Infinity) {
      return '∞';
    }
    return limit.toString();
  };

  // Load plans on component mount
  useEffect(() => {
    fetchPlans();
  }, []);

  // Handle successful plan creation/update/deletion
  const handlePlanChange = () => {
    fetchPlans();
  };

  return (
    <div className="flex h-screen bg-gray-900">
      <AdminSidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <AdminHeader />
        
        <main className="flex-1 overflow-y-auto bg-gray-900 p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-white">Subscription Plans</h1>
                <p className="text-gray-400 mt-1">
                  🏢 <strong>Organization Plans</strong> control internal resources (users can create unlimited organizations)
                </p>
              </div>
              
              <div className="flex items-center gap-3">
                {/* Plan type filter removed - only organization plans exist now */}
                
                <Button 
                  onClick={() => handleOpenPlanForm(null)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="mr-2 h-4 w-4" /> Create Plan
                </Button>
              </div>
            </div>
            
            {/* Plans Table */}
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-xl text-white">All Plans</CardTitle>
                <CardDescription className="text-gray-400">
                  View and manage all subscription plans
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
                  </div>
                ) : error ? (
                  <div className="bg-red-900/20 border border-red-800 text-red-300 p-4 rounded-md">
                    {error}
                  </div>
                ) : plans.length === 0 ? (
                  <div className="text-center py-10 text-gray-400">
                    <p>No subscription plans found</p>
                    <Button 
                      variant="link" 
                      className="text-blue-400 mt-2"
                      onClick={() => handleOpenPlanForm(null)}
                    >
                      Create your first plan
                    </Button>
                  </div>
                ) : (
                  <div className="relative overflow-x-auto">
                    <Table className="w-full">
                      <TableHeader>
                        <TableRow className="border-gray-700">
                          <TableHead className="text-gray-400">Name</TableHead>
                          <TableHead className="text-gray-400">Type</TableHead>
                          <TableHead className="text-gray-400">Code</TableHead>
                          <TableHead className="text-gray-400">Price</TableHead>
                          <TableHead className="text-gray-400">Billing</TableHead>
                          <TableHead className="text-gray-400">Limits</TableHead>
                          <TableHead className="text-gray-400">Credits</TableHead>
                          <TableHead className="text-gray-400">Status</TableHead>
                          <TableHead className="text-gray-400">Usage</TableHead>
                          <TableHead className="text-right text-gray-400">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {plans.map((plan) => (
                          <TableRow key={plan._id} className="border-gray-700">
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-white">{plan.name}</span>
                                {plan.isDefault && (
                                  <Badge className="bg-blue-900 text-blue-200">
                                    Default
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge 
                                className={`${plan.planType === 'user' 
                                  ? 'bg-green-900 text-green-200' 
                                  : 'bg-purple-900 text-purple-200'
                                }`}
                              >
                                {plan.planType === 'user' ? '👤 User' : '🏢 Organization'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-gray-300 font-mono">
                              {plan.code}
                            </TableCell>
                            <TableCell className="text-gray-300">
                              {formatCurrency(plan.price, plan.currency)}
                            </TableCell>
                            <TableCell className="text-gray-300 capitalize">
                              {plan.billingCycle}
                            </TableCell>
                            <TableCell className="text-gray-300">
                              {`${formatLimit(plan.limits.memberLimit)} members`}
                            </TableCell>
                            <TableCell>
                              {plan.credits?.totalCredits ? (
                                <div className="flex items-center">
                                  <Badge className="bg-blue-900 text-blue-200">
                                    {plan.credits.totalCredits} Credits
                                  </Badge>
                                  {plan.credits.rolloverEnabled && (
                                    <Badge className="ml-1 bg-green-900 text-green-200 text-xs">
                                      {plan.credits.rolloverPercentage}% Rollover
                                    </Badge>
                                  )}
                                </div>
                              ) : (
                                <Badge variant="outline" className="text-gray-400 border-gray-500">
                                  Not Configured
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {plan.isPublished ? (
                                <Badge className="bg-green-900 text-green-200">
                                  Published
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-gray-400 border-gray-500">
                                  Draft
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-gray-300">
                              {planUsageStats[plan._id] ? (
                                <div className="text-xs">
                                  <div className="flex items-center gap-1">
                                    <Users className="h-3 w-3 text-blue-400" />
                                    <span>{planUsageStats[plan._id].usersCount + planUsageStats[plan._id].orgsCount}</span>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-gray-500 text-xs">-</span>
                              )}
                            </TableCell>

                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => togglePlanPublish(plan)}
                                  className="h-8 w-8 bg-gray-700 hover:bg-gray-600 border-gray-600"
                                  disabled={loading}
                                  title={plan.isPublished ? "Unpublish" : "Publish"}
                                >
                                  {plan.isPublished ? (
                                    <EyeOff className="h-4 w-4 text-gray-300" />
                                  ) : (
                                    <Eye className="h-4 w-4 text-blue-400" />
                                  )}
                                </Button>
                                
                                <Button
                                  variant="outline"
                                  size="icon"
                                  onClick={() => handleOpenPlanForm(plan)}
                                  className="h-8 w-8 bg-gray-700 hover:bg-gray-600 border-gray-600"
                                  title="Edit"
                                >
                                  <Edit className="h-4 w-4 text-gray-300" />
                                </Button>
                                
                                {!plan.isDefault && (
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => handleOpenDeleteModal(plan)}
                                    className="h-8 w-8 bg-gray-700 hover:bg-red-800 border-gray-600"
                                    title="Delete"
                                  >
                                    <Trash2 className="h-4 w-4 text-red-400" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      {/* Plan Form Modal */}
      <PlanFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        plan={currentPlan}
        onSuccess={handlePlanChange}
      />

      {/* Plan Delete Modal */}
      {currentPlan && (
        <PlanDeleteModal
          isOpen={isDeleteModalOpen}
          onClose={() => setIsDeleteModalOpen(false)}
          plan={currentPlan}
          onSuccess={handlePlanChange}
        />
      )}
    </div>
  );
}

