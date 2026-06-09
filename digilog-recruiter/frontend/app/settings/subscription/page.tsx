"use client";

import { useState, useEffect } from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SubscriptionUpgradeModal } from '@/components/subscription-upgrade-modal';
import { SubscriptionRequestsStatus } from '@/components/subscription-requests-status';
import { getPublishedPlans, getPlanByCode, Plan } from '@/services/planService';
import { 
  Building2,
  Users,
  Check,
  User,
  Building,
  AlertCircle,
  CreditCard,
  FileText,
  Settings,
  Briefcase
} from 'lucide-react';

// Organization subscription interface
interface ExtendedOrganization {
  subscription?: {
    plan: string;
    memberLimit?: number | 'unlimited';
    currentJobs?: number;
    currentCandidates?: number;
  };
}

export default function SubscriptionPage() {
  const { currentOrganization } = useOrganization();
  const typedOrg = currentOrganization as unknown as ExtendedOrganization;
  
  const orgPlan = currentOrganization?.subscription?.plan || 'none';
  const currentMembers = currentOrganization?.members?.length || 0;
  
  // State for current plan details
  const [currentOrgPlan, setCurrentOrgPlan] = useState<Plan | null>(null);
  const [loadingCurrentOrgPlan, setLoadingCurrentOrgPlan] = useState(false);
  const [orgPlanOptions, setOrgPlanOptions] = useState<Plan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  
  // Upgrade modal state
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [targetPlan, setTargetPlan] = useState('');
  
  // Request refresh state
  const [refreshKey, setRefreshKey] = useState(0);
  
  // Handle refresh requests
  const handleRefreshNeeded = () => {
    setRefreshKey(prev => prev + 1);
  };
  
  // Load plans from the API
  useEffect(() => {
    async function fetchPlans() {
      setLoadingPlans(true);
      try {
        // Get all published plans (only organization plans exist now)
        const response = await getPublishedPlans();
        if (response.success && response.plans) {
          // Filter out Basic, Professional and Enterprise plans
          const filteredPlans = response.plans.filter(plan => 
            !['basic', 'professional', 'enterprise', 'pro'].includes(plan.code.toLowerCase())
          );
          
          // Sort plans with Free plan first, then by display order or price
          const sortedPlans = filteredPlans.sort((a, b) => {
            // Free plan always comes first
            if (a.code.toLowerCase() === 'free') return -1;
            if (b.code.toLowerCase() === 'free') return 1;
            
            // Then sort by display order if available, otherwise by price
            if (a.displayOrder && b.displayOrder) {
              return a.displayOrder - b.displayOrder;
            }
            return a.price - b.price;
          });
          
          console.log('📋 Available plans after filtering and sorting:', sortedPlans.map(p => p.code));
          setOrgPlanOptions(sortedPlans);
        } else {
          console.error('Error fetching plans:', response.message);
        }
      } catch (error) {
        console.error('Error fetching plans:', error);
      } finally {
        setLoadingPlans(false);
      }
    }
    
    fetchPlans();
  }, []);
  
  // Fetch current organization plan details when organization or plan changes
  useEffect(() => {
    async function fetchCurrentOrgPlanDetails() {
      if (!currentOrganization?.subscription?.plan) {
        setCurrentOrgPlan(null);
        return;
      }
      
      setLoadingCurrentOrgPlan(true);
      try {
        const response = await getPlanByCode(currentOrganization.subscription.plan);
        if (response.success && response.plan) {
          setCurrentOrgPlan(response.plan);
          console.log('📋 Fetched current org plan details:', response.plan.name, response.plan.limits);
        } else {
          console.error('Failed to fetch org plan details:', response.message);
          setCurrentOrgPlan(null);
        }
      } catch (error) {
        console.error('Error fetching current org plan details:', error);
        setCurrentOrgPlan(null);
      } finally {
        setLoadingCurrentOrgPlan(false);
      }
    }
    
    fetchCurrentOrgPlanDetails();
  }, [currentOrganization?.subscription?.plan]);
  
  // Get limits from actual plan details, not hardcoded values
  const orgMemberLimit = currentOrgPlan?.limits?.memberLimit || 0;

  return (
    <div className="container mx-auto py-4 sm:py-6 px-3 sm:px-4 md:px-6 space-y-4 sm:space-y-6">
      {/* Header - Mobile Responsive */}
      <div className="flex flex-col space-y-1 sm:space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Subscription Management</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Manage your organization subscription plan
        </p>
      </div>
      
      {/* Personal Account Info - Mobile Responsive */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-3">
          <div className="bg-white p-2 rounded-full shadow-sm mb-1 sm:mb-0">
            <User className="h-6 w-6 sm:h-7 sm:w-7 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg sm:text-xl font-semibold text-blue-900">Personal Account</h3>
            <div className="flex items-center justify-center sm:justify-start mt-1">
              <div className="bg-green-100 rounded-full p-0.5 mr-1.5">
                <Check className="h-3.5 w-3.5 text-green-600" />
              </div>
              <p className="text-sm sm:text-base text-blue-700">
                <strong>Unlimited Organization Creation</strong>
              </p>
            </div>
            <p className="text-xs sm:text-sm text-blue-600 mt-1">
              Create as many organizations as you need at no cost
            </p>
          </div>
        </div>
      </div>

      {/* Tabbed Content */}
      {currentOrganization ? (
        <Tabs defaultValue="current" className="space-y-4 sm:space-y-6">
          <div className="overflow-x-auto pb-1 -mx-3 px-3">
            <TabsList className="flex sm:grid w-full sm:grid-cols-3 lg:w-[600px] mx-auto h-auto">
              <TabsTrigger value="current" className="flex items-center gap-1 sm:gap-2 py-2.5 px-3 sm:px-4 h-auto flex-1 sm:flex-none rounded-md min-w-[120px] whitespace-nowrap">
                <Settings className="flex-shrink-0 w-4 h-4" />
                <span className="text-xs sm:text-sm">Current Plan</span>
              </TabsTrigger>
              <TabsTrigger value="plans" className="flex items-center gap-1 sm:gap-2 py-2.5 px-3 sm:px-4 h-auto flex-1 sm:flex-none rounded-md min-w-[120px] whitespace-nowrap">
                <CreditCard className="flex-shrink-0 w-4 h-4" />
                <span className="text-xs sm:text-sm">Available Plans</span>
              </TabsTrigger>
              <TabsTrigger value="requests" className="flex items-center gap-1 sm:gap-2 py-2.5 px-3 sm:px-4 h-auto flex-1 sm:flex-none rounded-md min-w-[120px] whitespace-nowrap">
                <FileText className="flex-shrink-0 w-4 h-4" />
                <span className="text-xs sm:text-sm">Requests</span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Current Plan Tab */}
          <TabsContent value="current" className="space-y-4 sm:space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-0">
              <div className="text-center sm:text-left">
                <h2 className="text-xl sm:text-2xl font-bold">Current Plan</h2>
                <p className="text-sm sm:text-base text-muted-foreground mt-1 line-clamp-1">
                  <span className="hidden sm:inline">Subscription details for: </span>
                  <strong>{currentOrganization.name}</strong>
                </p>
              </div>
              <div className="flex justify-center">
                <Badge 
                  className="px-4 py-1.5 sm:py-2 text-base sm:text-lg bg-green-600 text-white font-medium"
                >
                  {orgPlan.toUpperCase()}
                </Badge>
              </div>
            </div>
          
          {/* Organization Plan Details */}
          <Card className="border-green-200 bg-green-50 dark:bg-green-900/20 overflow-hidden">
            <CardHeader className="p-4 sm:p-6">
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <Building className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                <span>Organization Plan Usage</span>
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm mt-1">
                Your subscription determines team size. Jobs and candidates are managed by credits.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
              {loadingCurrentOrgPlan ? (
                <div className="flex justify-center items-center py-6 sm:py-8">
                  <div className="text-gray-400 animate-pulse text-sm">Loading plan details...</div>
                </div>
              ) : !currentOrgPlan ? (
                <div className="text-center py-6 sm:py-8">
                  <div className="text-yellow-600 mb-2 text-sm">⚠️ No plan details available</div>
                  <p className="text-xs text-gray-600">Plan: {currentOrganization?.subscription?.plan || 'None'}</p>
                </div>
              ) : (
                <div className="mt-2">
                  {/* Mobile-friendly usage cards */}
                  <div className="grid grid-cols-1 max-w-md mx-auto gap-3 sm:gap-6">
                    {/* Members */}
                    <div className="bg-white dark:bg-gray-800 p-3 sm:p-4 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
                      <div className="flex items-center justify-between mb-1.5 sm:mb-2">
                        <div className="flex items-center gap-1.5">
                          <Users className="h-4 w-4 text-blue-500" />
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">Members</span>
                        </div>
                        <span className="text-sm font-semibold text-blue-700 dark:text-blue-400">
                          {currentMembers} / {orgMemberLimit === 0 || orgMemberLimit === 'unlimited' ? '∞' : orgMemberLimit}
                        </span>
                      </div>
                      {orgMemberLimit !== 0 && orgMemberLimit !== 'unlimited' && (
                        <Progress value={(currentMembers / (orgMemberLimit as number)) * 100} className="h-1.5 sm:h-2" />
                      )}
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 text-center">
                        {orgMemberLimit === 0 || orgMemberLimit === 'unlimited' ? 'Unlimited members' : 
                         `${(orgMemberLimit as number) - currentMembers} slots available`}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="bg-green-100/50 dark:bg-green-900/30 border-t border-green-200 dark:border-green-800/30 p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full text-xs sm:text-sm text-green-700 dark:text-green-300">
                <AlertCircle className="h-4 w-4 hidden sm:block" />
                <span>Organization plans control team member limits. Jobs and candidates are managed through the credits system.</span>
              </div>
            </CardFooter>
          </Card>
          </TabsContent>

          {/* Available Plans Tab */}
          <TabsContent value="plans" className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-4">Available Organization Plans</h2>
              <p className="text-muted-foreground mb-6">
                Choose a plan that fits your organization's needs. Upgrade or downgrade at any time.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
              {loadingPlans ? (
                <>
                  {[...Array(3)].map((_, i) => (
                    <Card key={i} className="h-96 animate-pulse">
                      <CardContent className="p-6">
                        <div className="space-y-4">
                          <div className="w-3/4 h-6 bg-gray-200 rounded"></div>
                          <div className="w-1/2 h-8 bg-gray-200 rounded"></div>
                          <div className="space-y-2">
                            {[...Array(4)].map((_, j) => (
                              <div key={j} className="w-full h-4 bg-gray-200 rounded"></div>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </>
              ) : orgPlanOptions.length > 0 ? (
                orgPlanOptions.map((plan) => (
                  <Card 
                    key={plan.code}
                    className={`relative group overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1 ${
                      orgPlan === plan.code
                        ? 'ring-2 ring-blue-500 shadow-lg bg-gradient-to-br from-[#F1ECFF] to-[#E9E2FB]' 
                        : 'hover:ring-1 hover:ring-gray-300 bg-white'
                    }`}
                  >
                    {orgPlan === plan.code && (
                      <>
                        <div className="absolute top-0 right-0 w-0 h-0 border-l-[60px] border-l-transparent border-t-[60px] border-t-blue-500"></div>
                        <div className="absolute top-2 right-2">
                          <Check className="w-5 h-5 text-white" />
                        </div>
                      </>
                    )}
                    
                    {/* Plan Header */}
                    <CardHeader className="text-center pb-4 bg-gradient-to-r from-gray-50 to-gray-100">
                      <div className="space-y-2">
                        <CardTitle className="text-2xl font-bold text-gray-900">{plan.name}</CardTitle>
                        <div className="flex items-baseline justify-center gap-1">
                          <span className="text-4xl font-black text-gray-900">${plan.price}</span>
                          <span className="text-sm font-medium text-gray-600">/{plan.billingCycle}</span>
                        </div>
                        <CardDescription className="text-base font-medium text-blue-700">
                          {plan.limits?.memberLimit === 0 || plan.limits?.memberLimit === 'unlimited' 
                            ? '∞ Unlimited Members' 
                            : `${plan.limits?.memberLimit} Member${plan.limits?.memberLimit !== 1 ? 's' : ''} Max`}
                        </CardDescription>
                      </div>
                    </CardHeader>
                    
                    {/* Plan Features */}
                    <CardContent className="px-6 pb-6">
                      <div className="space-y-4">
                        {/* Plan Limits */}
                        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                          <h4 className="font-semibold text-sm text-gray-800">Plan Limits</h4>
                          <div className="grid grid-cols-1 gap-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-gray-600">Members:</span>
                              <span className="font-semibold">
                                {plan.limits?.memberLimit === 0 || plan.limits?.memberLimit === 'unlimited' 
                                  ? '∞' : plan.limits?.memberLimit}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 mt-2">Jobs and candidates managed by credits</p>
                        </div>
                        
                        {/* Plan Features */}
                        {Array.isArray(plan.features) && plan.features.length > 0 && (
                          <div className="space-y-3">
                            <h4 className="font-semibold text-sm text-gray-800">Features</h4>
                            <ul className="space-y-2">
                              {plan.features.slice(0, 4).map((feature, index) => (
                                <li key={index} className="flex items-start gap-2 text-sm">
                                  <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                                  <span className="text-gray-700">
                                    {typeof feature === 'string' ? feature : feature.name}
                                  </span>
                                </li>
                              ))}
                              {plan.features.length > 4 && (
                                <li className="text-xs text-gray-500 pl-6">
                                  +{plan.features.length - 4} more features
                                </li>
                              )}
                            </ul>
                          </div>
                        )}
                      </div>
                      
                      {/* Action Button */}
                      <div className="mt-6 pt-4 border-t border-gray-200">
                        <Button 
                          className={`w-full h-12 font-semibold transition-all duration-200 ${
                            orgPlan === plan.code
                              ? 'bg-gradient-to-r from-[#754BE5] to-[#6935CF] text-white cursor-default ring-2 ring-blue-200' 
                              : 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white shadow-lg hover:shadow-xl'
                          }`}
                          disabled={orgPlan === plan.code}
                          onClick={() => {
                            if (orgPlan !== plan.code && currentOrganization) {
                              setTargetPlan(plan.code);
                              setUpgradeModalOpen(true);
                            }
                          }}
                        >
                          {orgPlan === plan.code ? (
                            <div className="flex items-center gap-2">
                              <Check className="w-4 h-4" />
                              Current Plan
                            </div>
                          ) : (
                            'Upgrade to This Plan'
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <div className="col-span-full">
                  <Card className="bg-gradient-to-br from-gray-50 to-gray-100 border-2 border-dashed border-gray-300">
                    <CardContent className="flex flex-col justify-center items-center py-12">
                      <CreditCard className="w-16 h-16 text-gray-400 mb-4" />
                      <h3 className="text-lg font-semibold text-gray-700 mb-2">No Plans Available</h3>
                      <p className="text-gray-500 text-center max-w-md">
                        No organization plans are currently available for upgrade. Check back later or contact support.
                      </p>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Subscription Requests Tab */}
          <TabsContent value="requests" className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-4">Subscription Requests</h2>
              <p className="text-muted-foreground mb-6">
                Track your subscription upgrade requests and their approval status.
              </p>
            </div>
            
            <SubscriptionRequestsStatus key={refreshKey} onRefreshNeeded={handleRefreshNeeded} />
          </TabsContent>
        </Tabs>
      ) : (
        /* No Organization Selected */
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              No Organization Selected
            </CardTitle>
            <CardDescription>
              Create or select an organization to manage its subscription plan
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">
              Go to your organization settings to create a new organization or switch to an existing one.
            </p>
          </CardContent>
        </Card>
      )}
      
      {/* Upgrade Request Modal */}
      <SubscriptionUpgradeModal 
        isOpen={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
        requestType="organization"
        organizationId={currentOrganization?._id}
        currentPlan={orgPlan}
        targetPlan={targetPlan}
      />
    </div>
  );
}