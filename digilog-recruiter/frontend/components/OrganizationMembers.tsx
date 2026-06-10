'use client';

import React, { useState, useEffect } from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import organizationService from '@/services/organizationService';
import { getAllJobs } from '@/services/jobService';
import { getAllCandidates } from '@/services/candidateService';
import { RemoveMemberDialog } from './remove-member-dialog';
import { ChangeRoleDialog } from './change-role-dialog';
import { TransferOwnershipDialog } from './transfer-ownership-dialog';
import { Button } from '@/components/ui/button';
import PendingInvitations from '@/components/PendingInvitations';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { 
  Users, 
  UserPlus, 
  Mail, 
  MoreVertical, 
  Crown, 
  Shield, 
  UserCheck, 
  User, 
  Eye,
  Copy,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  UserCog,
  UserMinus
} from 'lucide-react';

interface OrganizationMembersProps {
  className?: string;
  onInviteSuccess?: () => void;
}

const OrganizationMembers: React.FC<OrganizationMembersProps> = ({ className = "", onInviteSuccess }) => {
  const { currentOrganization, inviteUser, removeMember, updateMemberRole, transferOwnership, loadOrganizations, forceRefresh } = useOrganization();

  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isRemoveMemberDialogOpen, setIsRemoveMemberDialogOpen] = useState(false);
  const [isChangeRoleDialogOpen, setIsChangeRoleDialogOpen] = useState(false);
  const [isTransferOwnershipDialogOpen, setIsTransferOwnershipDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [inviteData, setInviteData] = useState({
    emails: '',
    role: 'recruiter'
  });
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [formKey, setFormKey] = useState(Date.now());
  const [organizationUsage, setOrganizationUsage] = useState({
    jobCount: 0,
    candidateCount: 0
  });
  const [memberSource, setMemberSource] = useState<'idp' | 'local'>('local');
  
  // Member detail modal states
  const [selectedMemberForActions, setSelectedMemberForActions] = useState<any>(null);
  const [showMemberDetailModal, setShowMemberDetailModal] = useState(false);
  
  // Member limit error modal states
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorModalMessage, setErrorModalMessage] = useState('');
  const [errorModalDetails, setErrorModalDetails] = useState<{limit?: number, current?: number}>({});

  // Load organization usage data
  const loadOrganizationUsage = async () => {
    if (!currentOrganization) return;
    
    try {
      // Fetch all jobs and candidates for the organization
      const [jobs, candidates] = await Promise.all([
        getAllJobs({}), // Get all jobs
        getAllCandidates(1000) // Get candidates with high limit
      ]);
      
      setOrganizationUsage({
        jobCount: jobs.length,
        candidateCount: candidates.length
      });
    } catch (error) {
      console.error('Failed to load organization usage:', error);
      // Just use 0 as fallback
      setOrganizationUsage({
        jobCount: 0,
        candidateCount: 0
      });
    }
  };

  // Load organization members
  useEffect(() => {
    const loadMembers = async () => {
      if (!currentOrganization) return;
      
      try {
        setIsLoading(true);
        const response = await organizationService.getOrganizationMembers();
        console.log('Loaded members:', response.members, 'source:', response.source);
        
        // Track member source (idp, local, local_fallback)
        if (response.source) {
          setMemberSource(response.source);
        }
        
        // Filter out any invalid members to prevent rendering errors
        // Handle both IdP format (user object) and local format
        const validMembers = (response.members || []).filter(member => {
          // IdP format: member has user property with _id
          // or member directly has id from IdP response
          return member && (member.user || member.id);
        }).map(member => {
          // Normalize IdP response to match local format if needed
          if (!member.user && member.id) {
            return {
              ...member,
              _id: member.id,
              user: {
                _id: member.id,
                email: member.email,
                profile: {
                  firstName: member.name?.split(' ')[0] || '',
                  lastName: member.name?.split(' ').slice(1).join(' ') || ''
                }
              }
            };
          }
          return member;
        });
        
        setMembers(validMembers);
      } catch (error: any) {
        console.error('Failed to load members:', error);
        toast.error('Failed to load organization members');
        setMembers([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadMembers();
    loadOrganizationUsage();
  }, [currentOrganization]);

  // Reset form and errors when modal opens
  useEffect(() => {
    if (isInviteModalOpen) {
      console.log('🔄 Resetting invite modal form');
      setInviteData({ emails: '', role: 'recruiter' });
      setInviteError(null);
      setEmailError(null);
    }
  }, [isInviteModalOpen]);

  // Member click handler - opens detail modal
  const handleMemberClick = (member: any) => {
    setSelectedMemberForActions(member);
    setShowMemberDetailModal(true);
    // Haptic feedback if available
    if (navigator.vibrate) {
      navigator.vibrate(30);
    }
  };

  // Email validation function for multiple emails
  const validateEmails = (emailsString: string): { isValid: boolean; error: string | null; emails: string[] } => {
    if (!emailsString.trim()) {
      return { isValid: false, error: 'At least one email is required', emails: [] };
    }
    
    // Split by comma, semicolon, or newline and clean up
    const emails = emailsString
      .split(/[,;\n]/)
      .map(email => email.trim())
      .filter(email => email.length > 0);
    
    if (emails.length === 0) {
      return { isValid: false, error: 'At least one email is required', emails: [] };
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails: string[] = [];
    const duplicateEmails: string[] = [];
    const memberEmails: string[] = [];
    
    // Get current user email
    const currentUserEmail = currentOrganization?.members?.find(m => m.role === currentOrganization.userRole)?.user?.email;
    
    emails.forEach(email => {
      const cleanEmail = email.toLowerCase();
      
      // Check format
      if (!emailRegex.test(email)) {
        invalidEmails.push(email);
        return;
      }
      
      // Check if trying to invite themselves
      if (cleanEmail === currentUserEmail?.toLowerCase()) {
        duplicateEmails.push(`${email} (cannot invite yourself)`);
        return;
      }
      
      // Check if already a member
      const existingMember = members.find(m => m.user?.email?.toLowerCase() === cleanEmail);
      if (existingMember) {
        memberEmails.push(email);
        return;
      }
    });
    
    // Build error message
    let errors: string[] = [];
    if (invalidEmails.length > 0) {
      errors.push(`Invalid format: ${invalidEmails.join(', ')}`);
    }
    if (duplicateEmails.length > 0) {
      errors.push(duplicateEmails.join(', '));
    }
    if (memberEmails.length > 0) {
      errors.push(`Already members: ${memberEmails.join(', ')}`);
    }
    
    if (errors.length > 0) {
      return { isValid: false, error: errors.join('; '), emails: [] };
    }
    
    return { isValid: true, error: null, emails };
  };

  const handleEmailsChange = (emails: string) => {
    setInviteData(prev => ({ ...prev, emails }));
    setEmailError(null);
    setInviteError(null);
    
    // Real-time validation for multiple emails
    if (emails.trim()) {
      const validation = validateEmails(emails);
      if (!validation.isValid) {
        setEmailError(validation.error);
      }
    }
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Clear previous errors
    setInviteError(null);
    setEmailError(null);
    
    // Check capacity AGAIN before submitting (prevents race conditions)
    const memberLimit = currentOrganization?.subscription?.memberLimit || 5;
    const activeMembers = members.filter(m => m.status === 'active').length;
    const isAtCapacity = typeof memberLimit === 'number' && activeMembers >= memberLimit;
    
    if (isAtCapacity) {
      setShowErrorModal(true);
      setErrorModalMessage(`Member limit reached. Your plan allows ${memberLimit} members and you currently have ${activeMembers} active members.`);
      setErrorModalDetails({ limit: memberLimit, current: activeMembers });
      setIsInviteModalOpen(false); // Close invite modal
      return;
    }
    
    // Validate emails
    const validation = validateEmails(inviteData.emails);
    if (!validation.isValid) {
      setEmailError(validation.error);
      return;
    }

    try {
      setIsInviting(true);
      
      // Send invitations for all valid emails
      const invitePromises = validation.emails.map(email => 
        inviteUser(email.trim(), inviteData.role)
      );
      
      const results = await Promise.allSettled(invitePromises);
      
      // Check for member limit errors specifically
      const memberLimitErrors = results.filter(r => 
        r.status === 'rejected' && 
        (r as PromiseRejectedResult).reason?.message?.includes('Member limit reached')
      );
      
      if (memberLimitErrors.length > 0) {
        // Extract error details from first error
        const errorMsg = (memberLimitErrors[0] as PromiseRejectedResult).reason?.message || 'Member limit reached';
        const limitMatch = errorMsg.match(/allows (\d+) members/);
        const currentMatch = errorMsg.match(/have (\d+) active members/);
        
        setShowErrorModal(true);
        setErrorModalMessage(errorMsg);
        setErrorModalDetails({
          limit: limitMatch ? parseInt(limitMatch[1]) : undefined,
          current: currentMatch ? parseInt(currentMatch[1]) : undefined
        });
        setIsInviteModalOpen(false);
        setIsInviting(false);
        return;
      }
      
      // Count successes and failures
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      if (successful > 0) {
        const message = validation.emails.length === 1 
          ? 'Invitation sent successfully!' 
          : `${successful} invitation${successful > 1 ? 's' : ''} sent successfully!`;
        toast.success(message);
      }
      
      if (failed > 0) {
        const failedResults = results
          .filter(r => r.status === 'rejected')
          .map((r, i) => `${validation.emails[i]}: ${(r as PromiseRejectedResult).reason?.message || 'Failed'}`);
        toast.error(`Failed to send ${failed} invitation${failed > 1 ? 's' : ''}: ${failedResults.join(', ')}`);
      }
      
      console.log('✅ Bulk invitation completed, resetting form and closing modal');
      setInviteData({ emails: '', role: 'recruiter' });
      setInviteError(null);
      setEmailError(null);
      setFormKey(Date.now()); // Generate new form key for next use
      setIsInviteModalOpen(false);
      
      // Reload organization to get updated member list
      await loadOrganizations();
      
      // Also reload members from the dedicated endpoint
      try {
        const response = await organizationService.getOrganizationMembers();
        setMembers(response.members || []);
      } catch (error) {
        console.error('Failed to reload members after invite:', error);
      }
      
      // Reload usage data
      await loadOrganizationUsage();
      
      // Call the success callback to keep us on the team tab
      onInviteSuccess?.();
    } catch (error: any) {
      console.error('Invite error:', error);
      
      // Check if this is a member limit error
      if (error.message?.includes('Member limit reached')) {
        const limitMatch = error.message.match(/allows (\d+) members/);
        const currentMatch = error.message.match(/have (\d+) active members/);
        
        setShowErrorModal(true);
        setErrorModalMessage(error.message);
        setErrorModalDetails({
          limit: limitMatch ? parseInt(limitMatch[1]) : undefined,
          current: currentMatch ? parseInt(currentMatch[1]) : undefined
        });
        setIsInviteModalOpen(false);
        return;
      }
      
      // Set inline error instead of just toast
      let errorMessage = 'Failed to send invitation';
      
      if (error.message) {
        if (error.message.includes('already invited') || error.message.includes('already exists')) {
          errorMessage = 'This user has already been invited or is already a member';
        } else if (error.message.includes('invalid email')) {
          errorMessage = 'Please enter a valid email address';
        } else if (error.message.includes('limit')) {
          errorMessage = 'You have reached your organization member limit';
        } else if (error.message.includes('permission')) {
          errorMessage = 'You do not have permission to invite members';
        } else {
          errorMessage = error.message;
        }
      }
      
      setInviteError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsInviting(false);
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'owner': return <Crown className="w-4 h-4 text-purple-600" />;
      case 'admin': return <Shield className="w-4 h-4 text-blue-600" />;
      case 'hr_manager': return <UserCheck className="w-4 h-4 text-green-600" />;
      case 'recruiter': return <User className="w-4 h-4 text-orange-600" />;
      case 'interviewer': return <Eye className="w-4 h-4 text-gray-600" />;
      default: return <User className="w-4 h-4 text-gray-600" />;
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

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (!currentOrganization) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500">No organization selected</p>
        </div>
      </div>
    );
  }

  const canManageMembers = ['owner', 'admin'].includes(currentOrganization.userRole);

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Team Members</h1>
          <p className="text-gray-600">
            Manage your organization&apos;s team members and their roles
          </p>
        </div>
        <div className="flex items-center gap-2">
        {canManageMembers && (() => {
          const memberLimit = currentOrganization?.subscription?.memberLimit || 5;
          const activeMembers = members.filter(m => m.status === 'active').length;
          const isAtCapacity = typeof memberLimit === 'number' && activeMembers >= memberLimit;

          return (
            <Dialog open={isInviteModalOpen} onOpenChange={setIsInviteModalOpen}>
              <DialogTrigger asChild>
                <div className="relative group">
                  <Button
                    className="flex items-center space-x-2"
                    disabled={isAtCapacity}
                    onClick={() => {
                      if (!isAtCapacity) {
                        console.log('🎯 Opening invite modal - pre-clearing form');
                        setInviteData({ emails: '', role: 'recruiter' });
                        setInviteError(null);
                        setEmailError(null);
                        setFormKey(Date.now()); // Force form re-render
                      }
                    }}
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Invite Member</span>
                  </Button>
                  {isAtCapacity && (
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      Member limit reached ({activeMembers}/{memberLimit})
                    </div>
                  )}
                </div>
              </DialogTrigger>
              <DialogContent key={isInviteModalOpen ? 'open' : 'closed'} className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Invite Team Members</DialogTitle>
                  <DialogDescription>
                    Send invitations to join your organization. You can invite multiple people at once.
                  </DialogDescription>
                </DialogHeader>
              <form key={`invite-form-${formKey}`} onSubmit={handleInviteSubmit} className="space-y-4">
                {/* General error message */}
                {inviteError && (
                  <div className="flex items-center space-x-2 p-3 bg-red-50 border border-red-200 rounded-md">
                    <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                    <span className="text-sm text-red-700">{inviteError}</span>
                  </div>
                )}
                
                <div>
                  <Label htmlFor="emails" className="text-sm font-medium">
                    Email Addresses
                  </Label>
                  <div className="mt-1 relative">
                    <textarea
                      id="emails"
                      value={inviteData.emails}
                      onChange={(e) => handleEmailsChange(e.target.value)}
                      placeholder="colleague@company.com, friend@example.com&#10;Or enter one email per line"
                      rows={3}
                      className={`${
                        emailError 
                          ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
                          : inviteData.emails && !emailError 
                            ? 'border-green-300 focus:border-green-500 focus:ring-green-500'
                            : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500'
                      } w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-1 transition-colors resize-none`}
                      disabled={isInviting}
                      required
                    />
                    {/* Success indicator */}
                    {inviteData.emails && !emailError && (
                      <div className="absolute top-2 right-2 pointer-events-none">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Separate multiple emails with commas, semicolons, or line breaks
                  </p>
                  {/* Email-specific error */}
                  {emailError && (
                    <div className="flex items-start space-x-1 mt-1">
                      <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0 mt-0.5" />
                      <span className="text-xs text-red-600">{emailError}</span>
                    </div>
                  )}
                </div>
                
                <div>
                  <Label htmlFor="role" className="text-sm font-medium">
                    Role
                  </Label>
                  <Select 
                    value={inviteData.role} 
                    onValueChange={(value) => setInviteData(prev => ({ ...prev, role: value }))}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">
                        <div className="flex items-center space-x-2">
                          <Shield className="w-4 h-4 text-blue-600" />
                          <div>
                            <div className="font-medium">Admin</div>
                            <div className="text-xs text-gray-500">Full access to manage users, jobs, and candidates</div>
                          </div>
                        </div>
                      </SelectItem>
                      <SelectItem value="hr_manager">
                        <div className="flex items-center space-x-2">
                          <UserCheck className="w-4 h-4 text-green-600" />
                          <div>
                            <div className="font-medium">HR Manager</div>
                            <div className="text-xs text-gray-500">Can manage jobs, candidates, and view analytics</div>
                          </div>
                        </div>
                      </SelectItem>
                      <SelectItem value="recruiter">
                        <div className="flex items-center space-x-2">
                          <User className="w-4 h-4 text-purple-600" />
                          <div>
                            <div className="font-medium">Recruiter</div>
                            <div className="text-xs text-gray-500">Can manage candidates and view jobs</div>
                          </div>
                        </div>
                      </SelectItem>
                      <SelectItem value="interviewer">
                        <div className="flex items-center space-x-2">
                          <Eye className="w-4 h-4 text-orange-600" />
                          <div>
                            <div className="font-medium">Interviewer</div>
                            <div className="text-xs text-gray-500">Can view candidates and jobs for interviews</div>
                          </div>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="flex justify-end space-x-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsInviteModalOpen(false);
                      // Clear errors when closing
                      setInviteError(null);
                      setEmailError(null);
                      setInviteData({ emails: '', role: 'recruiter' });
                      setFormKey(Date.now()); // Generate new form key for next use
                    }}
                    disabled={isInviting}
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={isInviting || !!emailError || !inviteData.emails.trim()}
                    className="min-w-[120px]"
                  >
                    {isInviting ? (
                      <div className="flex items-center space-x-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Sending...</span>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-2">
                        <Mail className="w-4 h-4" />
                        <span>Send Invites</span>
                      </div>
                    )}
                  </Button>
                </div>
              </form>
              </DialogContent>
            </Dialog>
          );
        })()}
        </div>
        
        {/* Member Limit Error Modal */}
        <Dialog open={showErrorModal} onOpenChange={setShowErrorModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertCircle className="w-5 h-5" />
                Member Limit Reached
              </DialogTitle>
              <DialogDescription>
                Your organization has reached its member capacity
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-800">{errorModalMessage}</p>
              </div>
              
              {errorModalDetails.limit && errorModalDetails.current && (
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="text-sm">
                    <div className="font-medium text-gray-700">Current Members</div>
                    <div className="text-2xl font-bold text-gray-900">{errorModalDetails.current}</div>
                  </div>
                  <div className="text-gray-400">/</div>
                  <div className="text-sm text-right">
                    <div className="font-medium text-gray-700">Plan Limit</div>
                    <div className="text-2xl font-bold text-gray-900">{errorModalDetails.limit}</div>
                  </div>
                </div>
              )}
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  <strong>Need more members?</strong> Upgrade your plan or remove inactive members to free up space.
                </p>
              </div>
              
              <div className="flex gap-2">
                <Button 
                  onClick={() => setShowErrorModal(false)}
                  variant="outline"
                  className="flex-1"
                >
                  Close
                </Button>
                <Button 
                  onClick={() => {
                    setShowErrorModal(false);
                    window.location.href = '/settings/subscription';
                  }}
                  className="flex-1"
                >
                  Upgrade Plan
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Users className="w-5 h-5" />
            <span>Members ({members.length})</span>
          </CardTitle>
          <CardDescription>
            View and manage organization members
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-gray-200 rounded-full animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="w-1/3 h-4 bg-gray-200 rounded animate-pulse" />
                    <div className="w-1/4 h-3 bg-gray-200 rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-8">
              <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No members found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.filter(member => member?.user).map((member) => (
                  <TableRow 
                    key={member._id}
                    onClick={() => handleMemberClick(member)}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group"
                  >
                    <TableCell>
                      <div className="flex items-center space-x-3">
                        <Avatar className="w-10 h-10 border-2 border-gray-100">
                          <AvatarImage 
                            src={member.user?.profile?.avatar} 
                            alt={`${member.user?.profile?.firstName || ''} ${member.user?.profile?.lastName || ''}`}
                          />
                          <AvatarFallback className="text-sm font-medium bg-gradient-to-br from-[#754BE5] to-[#6935CF] text-white">
                            {(member.user?.profile?.firstName?.charAt(0)?.toUpperCase()) || 
                             (member.user?.email?.charAt(0)?.toUpperCase()) || 'U'}
                            {(member.user?.profile?.lastName?.charAt(0)?.toUpperCase()) || ''}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-gray-900 truncate">
                            {member.user?.profile?.firstName && member.user?.profile?.lastName ? 
                              `${member.user?.profile?.firstName} ${member.user?.profile?.lastName}` :
                              member.user?.profile?.firstName || 
                              member.user?.profile?.lastName ||
                              member.user?.email?.split('@')[0] || 
                              'Unknown User'
                            }
                          </p>
                          <p className="text-sm text-gray-600 truncate" title={member.user?.email}>
                            {member.user?.email || 'No email available'}
                          </p>
                          {member.user?.profile?.title && (
                            <p className="text-xs text-gray-500 truncate">
                              {member.user?.profile?.title}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    
                    <TableCell>
                      <Badge 
                        variant="secondary" 
                        className={`flex items-center space-x-1 w-fit ${getRoleColor(member.role)}`}
                      >
                        {getRoleIcon(member.role)}
                        <span>{getRoleLabel(member.role)}</span>
                      </Badge>
                    </TableCell>
                    
                    <TableCell className="text-sm text-gray-600">
                      {formatDate(member.joinedAt)}
                    </TableCell>
                    
                    <TableCell>
                      <div className="flex items-center justify-between">
                      <Badge 
                        variant={member.status === 'active' ? 'default' : 'secondary'}
                        className={
                          member.status === 'active' 
                            ? 'bg-green-100 text-green-800' 
                            : member.status === 'pending'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                        }
                      >
                        {member.status === 'active' ? 'Active' : 
                         member.status === 'pending' ? 'Pending' : 'Suspended'}
                      </Badge>
                        <MoreVertical className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </TableCell>
                    
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <RemoveMemberDialog
        open={isRemoveMemberDialogOpen}
        onOpenChange={setIsRemoveMemberDialogOpen}
        member={selectedMember}
        onRemove={async () => {
          if (selectedMember?.user?._id) {
            try {
              await removeMember(selectedMember.user._id);
              toast.success('Member removed successfully');
              setIsRemoveMemberDialogOpen(false);
              
              // Reload members from the dedicated endpoint
              try {
                const response = await organizationService.getOrganizationMembers();
                setMembers(response.members || []);
              } catch (error) {
                console.error('Failed to reload members after removal:', error);
                // Refresh organization context as fallback
                await loadOrganizations();
              }
              
              // Reload usage data
              await loadOrganizationUsage();
            } catch (error: any) {
              console.error('Error removing member:', error);
              toast.error(error.message || 'Failed to remove member');
            }
          } else {
            console.error('Cannot remove member: invalid member data');
            toast.error('Cannot remove member: invalid member data');
          }
        }}
      />

      <ChangeRoleDialog
        open={isChangeRoleDialogOpen}
        onOpenChange={setIsChangeRoleDialogOpen}
        member={selectedMember ? {
          id: selectedMember.user?._id,
          name: selectedMember.user?.profile?.displayName || 
                selectedMember.user?.profile?.firstName || 
                selectedMember.user?.email,
          role: selectedMember.role
        } : null}
        onRoleChange={async (newRole: string) => {
          if (selectedMember?.user?._id) {
            try {
              await updateMemberRole(selectedMember.user._id, newRole);
              toast.success('Member role updated successfully');
              setIsChangeRoleDialogOpen(false);
              
              // Reload members from the dedicated endpoint
              try {
                const response = await organizationService.getOrganizationMembers();
                setMembers(response.members || []);
              } catch (error) {
                console.error('Failed to reload members after role update:', error);
                // Refresh organization context as fallback
                await loadOrganizations();
              }
              
              // Reload organization to update current user's permissions if needed
              await loadOrganizations();
            } catch (error: any) {
              console.error('Error updating member role:', error);
              toast.error(error.message || 'Failed to update member role');
            }
          } else {
            console.error('Cannot update member role: invalid member data');
            toast.error('Cannot update member role: invalid member data');
          }
        }}
      />

      <TransferOwnershipDialog
        open={isTransferOwnershipDialogOpen}
        onOpenChange={setIsTransferOwnershipDialogOpen}
        members={members}
        currentOwnerId={members.find(m => m.role === 'owner')?.user?._id || ''}
        organizationName={currentOrganization?.name || ''}
        onTransfer={async (newOwnerId: string) => {
          try {
            await transferOwnership(newOwnerId);
            toast.success('Ownership transferred successfully');
            setIsTransferOwnershipDialogOpen(false);
            
            // Reload members from the dedicated endpoint
            try {
              const response = await organizationService.getOrganizationMembers();
              setMembers(response.members || []);
            } catch (error) {
              console.error('Failed to reload members after ownership transfer:', error);
              // Refresh organization context as fallback
              await loadOrganizations();
            }
            
            // Reload organization to update ownership and current user's role
            await loadOrganizations();
          } catch (error: any) {
            console.error('Error transferring ownership:', error);
            throw error; // Re-throw so the dialog can show the error
          }
        }}
      />

      {/* Member Detail Modal */}
      <Dialog open={showMemberDetailModal} onOpenChange={setShowMemberDetailModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Member Details</DialogTitle>
          </DialogHeader>
          
          {/* Member Info Section */}
          <div className="flex items-center gap-4 py-4 border-b">
            <Avatar className="w-16 h-16">
                <AvatarImage src={selectedMemberForActions?.user?.profile?.avatar} />
              <AvatarFallback className="bg-gradient-to-br from-[#754BE5] to-[#6935CF] text-white text-lg">
                  {selectedMemberForActions?.user?.profile?.firstName?.charAt(0) || 
                   selectedMemberForActions?.user?.email?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
              <div className="font-semibold text-lg">
                  {selectedMemberForActions?.user?.profile?.firstName} {selectedMemberForActions?.user?.profile?.lastName}
                </div>
              <div className="text-sm text-gray-500">{selectedMemberForActions?.user?.email}</div>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={selectedMemberForActions?.role === 'owner' ? 'default' : 'secondary'}>
                  {selectedMemberForActions?.role === 'owner' && <Crown className="w-3 h-3 mr-1" />}
                  {selectedMemberForActions?.role === 'admin' && <Shield className="w-3 h-3 mr-1" />}
                  {selectedMemberForActions?.role === 'recruiter' && <UserCheck className="w-3 h-3 mr-1" />}
                  {selectedMemberForActions?.role === 'viewer' && <Eye className="w-3 h-3 mr-1" />}
                  {selectedMemberForActions?.role?.charAt(0).toUpperCase() + selectedMemberForActions?.role?.slice(1)}
                </Badge>
                <Badge 
                  variant={
                    selectedMemberForActions?.status === 'active' 
                      ? 'default' 
                      : selectedMemberForActions?.status === 'pending'
                      ? 'secondary'
                      : 'destructive'
                  }
                >
                  {selectedMemberForActions?.status === 'active' ? 'Active' : 
                   selectedMemberForActions?.status === 'pending' ? 'Pending' : 'Suspended'}
                </Badge>
              </div>
            </div>
          </div>
          
          {/* Member Details */}
          <div className="space-y-3 py-4 border-b">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Joined</span>
              <span>{selectedMemberForActions?.joinedAt ? new Date(selectedMemberForActions.joinedAt).toLocaleDateString() : 'N/A'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Last Active</span>
              <span>{selectedMemberForActions?.user?.lastActive ? new Date(selectedMemberForActions.user.lastActive).toLocaleDateString() : 'N/A'}</span>
            </div>
            {canManageMembers && (
              <Button 
                variant="outline" 
                size="sm"
                className="w-full"
                onClick={() => {
                  navigator.clipboard.writeText(selectedMemberForActions?.user?.email);
                  toast.success('Email copied to clipboard');
                }}
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy Email
              </Button>
            )}
          </div>
          
          {/* Actions Section */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-gray-500 mb-3">Actions</h4>

            {/* Member management actions */}
            {canManageMembers && (
              <>
                {/* Change Role Button */}
                {selectedMemberForActions?.role !== 'owner' && canManageMembers && (
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left h-12"
                    onClick={() => {
                      setSelectedMember(selectedMemberForActions);
                      setIsChangeRoleDialogOpen(true);
                      setShowMemberDetailModal(false);
                    }}
                  >
                    <UserCog className="h-4 w-4 mr-3" />
                    <div className="flex-1">
                      <div className="font-medium">Change Role</div>
                      <div className="text-xs text-gray-500">Update member permissions</div>
                    </div>
                  </Button>
                )}

                {/* Remove Member Button */}
                {selectedMemberForActions?.role !== 'owner' && canManageMembers && (
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left h-12 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border-red-200 dark:border-red-800"
                    onClick={() => {
                      setSelectedMember(selectedMemberForActions);
                      setIsRemoveMemberDialogOpen(true);
                      setShowMemberDetailModal(false);
                    }}
                  >
                    <UserMinus className="h-4 w-4 mr-3" />
                    <div className="flex-1">
                      <div className="font-medium">Remove Member</div>
                      <div className="text-xs text-red-500">Remove from organization</div>
                    </div>
                  </Button>
                )}

                {/* Transfer Ownership Button */}
                {currentOrganization?.userRole === 'owner' && selectedMemberForActions?.role !== 'owner' && (
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left h-12 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 border-purple-200 dark:border-purple-800"
                    onClick={() => {
                      setSelectedMember(selectedMemberForActions);
                      setIsTransferOwnershipDialogOpen(true);
                      setShowMemberDetailModal(false);
                    }}
                  >
                    <Crown className="h-4 w-4 mr-3" />
                    <div className="flex-1">
                      <div className="font-medium">Transfer Ownership</div>
                      <div className="text-xs text-purple-500">Make this member the owner</div>
                    </div>
                  </Button>
                )}
              </>
            )}

            {/* Cancel Button */}
            <Button
              variant="ghost"
              className="w-full mt-2"
              onClick={() => setShowMemberDetailModal(false)}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pending Invitations */}
      {canManageMembers && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Mail className="w-5 h-5" />
              <span>Pending Invitations</span>
            </CardTitle>
            <CardDescription>
              View and manage pending team invitations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PendingInvitations />
          </CardContent>
        </Card>
      )}

      {/* Subscription Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Subscription Limits</CardTitle>
              <CardDescription>
                Current plan limits and usage
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                console.log('🔄 Manual refresh triggered - reloading data without forceRefresh');
                // Use targeted refresh instead of forceRefresh to avoid modal flashing
                await loadOrganizations();
                
                // Reload members from the dedicated endpoint
                try {
                  const response = await organizationService.getOrganizationMembers();
                  setMembers(response.members || []);
                } catch (error) {
                  console.error('Failed to reload members:', error);
                }
                // Reload usage data
                await loadOrganizationUsage();
              }}
              className="flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Members</span>
                <Badge variant="outline">
                  {members.length} / {currentOrganization.subscription?.memberLimit || '?'}
                </Badge>
              </div>
              <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full" 
                  style={{ 
                    width: `${currentOrganization.subscription?.memberLimit ? Math.min((members.length / currentOrganization.subscription.memberLimit) * 100, 100) : 0}%`
                  }}
                />
              </div>
            </div>
            
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Plan</span>
                <Badge className="capitalize">
                  {currentOrganization.subscription?.planName || currentOrganization.subscription?.plan || 'Free'}
                </Badge>
              </div>
              <p className="text-xs text-gray-600 mt-1">
                Current subscription plan
              </p>
            </div>
            
          </div>
          
          {/* Plan Details */}
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-blue-900">
                  {currentOrganization.subscription?.planName || currentOrganization.subscription?.plan?.toUpperCase() || 'FREE'} Plan
                </h4>
                <p className="text-xs text-blue-700 mt-1">
                  License Status: Active
                </p>
              </div>
              <Badge className={`${
                currentOrganization.subscription?.plan === 'free' ? 'bg-gray-500' :
                currentOrganization.subscription?.plan === 'basic' ? 'bg-blue-500' :
                currentOrganization.subscription?.plan === 'pro' ? 'bg-purple-500' :
                'bg-gradient-to-r from-yellow-500 to-orange-500'
              } text-white`}>
                {currentOrganization.subscription?.planName || currentOrganization.subscription?.plan || 'Free'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default OrganizationMembers;
