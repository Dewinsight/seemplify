'use client';

import React, { useState, useEffect } from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Building2, ChevronDown, Check, Settings, Plus, Coins, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { getCreditStatus, CreditStatus } from '@/services/creditsService';
import { useRouter } from 'next/navigation';

interface OrganizationSwitcherProps {
  className?: string;
  showCreateOption?: boolean;
}

const OrganizationSwitcher: React.FC<OrganizationSwitcherProps> = ({ 
  className = "",
  showCreateOption = false 
}) => {
  const { 
    currentOrganization, 
    organizations, 
    switchOrganization, 
    isLoading,
    organizationLimits,
    error
  } = useOrganization();
  
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchingToId, setSwitchingToId] = useState<string | null>(null);
  const [credits, setCredits] = useState<CreditStatus | null>(null);
  const [loadingCredits, setLoadingCredits] = useState(false);
  const router = useRouter();

  // IDP URL for organization management
  const idpUrl = process.env.NEXT_PUBLIC_IDP_URL || process.env.NEXT_PUBLIC_OIDC_ISSUER || '';

  // Load credits when organization changes
  useEffect(() => {
    if (currentOrganization) {
      loadCredits();
    }
  }, [currentOrganization?._id]);

  const loadCredits = async () => {
    try {
      setLoadingCredits(true);
      const response = await getCreditStatus();
      if (response.success) {
        setCredits(response.credits);
      }
    } catch (error) {
      console.error('Error loading credits:', error);
    } finally {
      setLoadingCredits(false);
    }
  };

  const getCreditsColor = () => {
    if (!credits) return 'text-gray-500';
    if (credits.percentageUsed >= 80) return 'text-red-500';
    if (credits.percentageUsed >= 50) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getCreditsProgressColor = () => {
    if (!credits) return 'bg-gray-300';
    if (credits.percentageUsed >= 80) return 'bg-red-500';
    if (credits.percentageUsed >= 50) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const handleSwitchOrganization = async (organizationId: string) => {
    if (organizationId === currentOrganization?._id) return;
    if (isSwitching) return; // Prevent multiple simultaneous switches
    
    const orgName = organizations.find(org => org._id === organizationId)?.name || 'Unknown Organization';
    
    try {
      setIsSwitching(true);
      setSwitchingToId(organizationId);
      
      console.log(`🔄 Switching to organization: ${orgName} (${organizationId})`);
      
      await switchOrganization(organizationId);
      
      toast.success(`Successfully switched to ${orgName}`);
      console.log(`✅ Successfully switched to: ${orgName}`);
    } catch (error: any) {
      console.error(`❌ Failed to switch to ${orgName}:`, error);
      toast.error(`Failed to switch to ${orgName}: ${error.message || 'Unknown error'}`);
    } finally {
      setIsSwitching(false);
      setSwitchingToId(null);
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'owner': return 'bg-purple-100 text-purple-800';
      case 'admin': return 'bg-blue-100 text-blue-800';
      case 'hr_manager': return 'bg-green-100 text-green-800';
      case 'recruiter': return 'bg-orange-100 text-orange-800';
      case 'interviewer': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'owner': return 'Owner';
      case 'admin': return 'Admin';
      case 'hr_manager': return 'HR Manager';
      case 'recruiter': return 'Recruiter';
      case 'interviewer': return 'Interviewer';
      default: return role;
    }
  };

  const getOrgInitial = (name: string | undefined): string => {
    if (!name || typeof name !== 'string') return 'O';
    return name.charAt(0).toUpperCase() || 'O';
  };

  if (isLoading) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <div className="w-8 h-8 bg-gray-200 rounded animate-pulse" />
        <div className="w-32 h-4 bg-gray-200 rounded animate-pulse" />
      </div>
    );
  }

  if (!currentOrganization) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <Building2 className="w-5 h-5 text-gray-400" />
        <span className="text-sm text-gray-500">No organization</span>
      </div>
    );
  }

  return (
    <>
      <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="outline" 
          className={`flex items-center space-x-2 h-auto p-2 ${className}`}
          disabled={isSwitching || isLoading}
        >
          <Avatar className="w-6 h-6">
            <AvatarImage src={currentOrganization.logo} />
            <AvatarFallback className="text-xs">
              {getOrgInitial(currentOrganization.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col items-start">
            <span className="text-sm font-medium truncate max-w-[120px]">
              {currentOrganization.name || 'Unnamed Organization'}
            </span>
            <Badge 
              variant="secondary" 
              className={`text-xs h-4 px-1 ${getRoleColor(currentOrganization.userRole)}`}
            >
              {getRoleLabel(currentOrganization.userRole)}
            </Badge>
          </div>
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </Button>
      </DropdownMenuTrigger>
      
      <DropdownMenuContent className="w-80" align="start">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {/* Credits Display */}
        {currentOrganization && (
          <>
            <div className="px-2 py-3 bg-slate-50 rounded-md mx-2 mb-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Coins className={`w-4 h-4 ${getCreditsColor()}`} />
                  <span className="text-sm font-medium text-slate-700">Credits</span>
                </div>
                <button
                  onClick={() => router.push('/settings/organization')}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  View Details
                </button>
              </div>
              
              {loadingCredits ? (
                <div className="text-xs text-slate-500">Loading...</div>
              ) : credits ? (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-lg font-bold ${getCreditsColor()}`}>
                      {credits.remainingCredits}
                    </span>
                    <span className="text-xs text-slate-500">
                      of {credits.totalCredits}
                    </span>
                  </div>
                  
                  <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden mb-1">
                    <div
                      className={`h-full transition-all duration-300 ${getCreditsProgressColor()}`}
                      style={{ width: `${Math.min(credits.percentageUsed, 100)}%` }}
                    />
                  </div>
                  
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">
                      {credits.percentageUsed.toFixed(0)}% used
                    </span>
                    <span className="text-slate-500">
                      Resets in {credits.daysUntilReset}d
                    </span>
                  </div>
                  
                  {credits.warnings.lowCredit && (
                    <div className="mt-2 text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
                      ⚠️ Low credits remaining
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-slate-500">Credits not available</div>
              )}
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        
        {organizations.map((org) => (
          <DropdownMenuItem
            key={org._id}
            onClick={() => handleSwitchOrganization(org._id)}
            className="flex items-center space-x-3 p-3 cursor-pointer"
            disabled={isSwitching || isLoading}
          >
            <Avatar className="w-8 h-8">
              <AvatarImage src={org.logo} />
              <AvatarFallback className="text-xs">
                {getOrgInitial(org.name)}
              </AvatarFallback>
            </Avatar>
            
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <span className="font-medium">{org.name || 'Unnamed Organization'}</span>
                {org._id === currentOrganization?._id && (
                  <Check className="w-4 h-4 text-green-600" />
                )}
                {switchingToId === org._id && (
                  <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
              <div className="flex items-center space-x-2 mt-1">
                <Badge 
                  variant="secondary" 
                  className={`text-xs h-4 px-2 ${getRoleColor(org.userRole)}`}
                >
                  {getRoleLabel(org.userRole)}
                </Badge>
                {org.memberCount && (
                  <span className="text-xs text-gray-500">
                    {org.memberCount} member{org.memberCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          </DropdownMenuItem>
        ))}
        
        {organizations.length === 0 && (
          <DropdownMenuItem disabled>
            <span className="text-gray-500">No organizations found</span>
          </DropdownMenuItem>
        )}
        
        <DropdownMenuSeparator />
        
        <DropdownMenuItem asChild>
          <a href="/settings/organization" className="flex items-center space-x-2 cursor-pointer">
            <Settings className="w-4 h-4" />
            <span>Organization Settings</span>
          </a>
        </DropdownMenuItem>
        
        {showCreateOption && (
          <DropdownMenuItem
            onClick={() => {
              if (idpUrl) {
                // Redirect to IDP hub for organization creation
                window.open(`${idpUrl.replace(/\/$/, '')}/organizations`, '_blank');
                toast.info('Opening Identity Provider to create organization...');
              } else {
                toast.error('Identity Provider URL not configured');
              }
            }}
            className="flex items-center space-x-2 cursor-pointer"
            disabled={organizationLimits ? !organizationLimits.canCreateMore : false}
          >
            <Plus className="w-4 h-4" />
            <span>Create Organization</span>
            {organizationLimits && !organizationLimits.canCreateMore && (
              <Badge variant="secondary" className="ml-auto">
                Limit Reached
              </Badge>
            )}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};

export default OrganizationSwitcher; 