'use client';

import React, { useState, useEffect } from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Building2, Users, Settings, AlertTriangle } from 'lucide-react';

interface OrganizationSettingsProps {
  className?: string;
}

const OrganizationSettings: React.FC<OrganizationSettingsProps> = ({ className = "" }) => {
  const { currentOrganization, updateOrganization, deleteOrganization } = useOrganization();
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    industry: '',
    size: '',
    website: '',
    settings: {
      allowPublicJobApplications: true,
      requireApprovalForNewMembers: true,
      defaultCandidateStatus: 'New'
    }
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Initialize form data when organization loads
  useEffect(() => {
    if (currentOrganization) {
      setFormData({
        name: currentOrganization.name || '',
        description: currentOrganization.description || '',
        industry: currentOrganization.industry || '',
        size: currentOrganization.size || '',
        website: currentOrganization.website || '',
        settings: {
          allowPublicJobApplications: currentOrganization.settings?.allowPublicJobApplications ?? true,
          requireApprovalForNewMembers: currentOrganization.settings?.requireApprovalForNewMembers ?? true,
          defaultCandidateStatus: currentOrganization.settings?.defaultCandidateStatus || 'New'
        }
      });
    }
  }, [currentOrganization]);

  const handleInputChange = (field: string, value: string | boolean) => {
    if (field.startsWith('settings.')) {
      const settingField = field.split('.')[1];
      setFormData(prev => ({
        ...prev,
        settings: {
          ...prev.settings,
          [settingField]: value
        }
      }));
    } else {
      setFormData(prev => ({ ...prev, [field]: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast.error('Organization name is required');
      return;
    }

    try {
      setIsLoading(true);
      await updateOrganization(formData);
      toast.success('Organization settings updated successfully!');
    } catch (error: any) {
      toast.error(error.message || 'Failed to update organization settings');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteOrganization = async () => {
    if (!currentOrganization) return;
    
    try {
      setIsDeleting(true);
      await deleteOrganization(currentOrganization._id);
      toast.success('Organization deleted successfully');
      setShowDeleteConfirm(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete organization');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!currentOrganization) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500">No organization selected</p>
        </div>
      </div>
    );
  }

  const isOwner = currentOrganization.userRole === 'owner';
  const canManageSettings = ['owner', 'admin'].includes(currentOrganization.userRole);

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Organization Settings</h1>
          <p className="text-gray-600">Manage your organization's details and preferences</p>
        </div>
        <Badge variant="secondary" className="px-3 py-1">
          {currentOrganization.userRole === 'owner' ? 'Owner' : 
           currentOrganization.userRole === 'admin' ? 'Admin' : 
           currentOrganization.userRole === 'hr_manager' ? 'HR Manager' :
           currentOrganization.userRole === 'recruiter' ? 'Recruiter' : 'Interviewer'}
        </Badge>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Organization Details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Building2 className="w-5 h-5" />
              <span>Organization Details</span>
            </CardTitle>
            <CardDescription>
              Basic information about your organization
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Organization Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  placeholder="Enter organization name"
                  disabled={!canManageSettings}
                  required
                />
              </div>
              
              <div>
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  value={formData.website}
                  onChange={(e) => handleInputChange('website', e.target.value)}
                  placeholder="https://yourcompany.com"
                  type="url"
                  disabled={!canManageSettings}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                placeholder="Brief description of your organization"
                rows={3}
                disabled={!canManageSettings}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="industry">Industry</Label>
                <Input
                  id="industry"
                  value={formData.industry}
                  onChange={(e) => handleInputChange('industry', e.target.value)}
                  placeholder="e.g., Technology, Healthcare, Finance"
                  disabled={!canManageSettings}
                />
              </div>

              <div>
                <Label htmlFor="size">Organization Size</Label>
                <Select 
                  value={formData.size} 
                  onValueChange={(value) => handleInputChange('size', value)}
                  disabled={!canManageSettings}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select size" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1-10">1-10 employees</SelectItem>
                    <SelectItem value="11-50">11-50 employees</SelectItem>
                    <SelectItem value="51-200">51-200 employees</SelectItem>
                    <SelectItem value="201-500">201-500 employees</SelectItem>
                    <SelectItem value="501-1000">501-1000 employees</SelectItem>
                    <SelectItem value="1000+">1000+ employees</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Application Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Settings className="w-5 h-5" />
              <span>Application Settings</span>
            </CardTitle>
            <CardDescription>
              Configure how your organization handles applications and members
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Allow Public Job Applications</Label>
                <p className="text-sm text-gray-600">
                  Allow candidates to apply to jobs without invitation
                </p>
              </div>
              <Switch
                checked={formData.settings.allowPublicJobApplications}
                onCheckedChange={(checked) => handleInputChange('settings.allowPublicJobApplications', checked)}
                disabled={!canManageSettings}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Require Approval for New Members</Label>
                <p className="text-sm text-gray-600">
                  New team members need approval before joining
                </p>
              </div>
              <Switch
                checked={formData.settings.requireApprovalForNewMembers}
                onCheckedChange={(checked) => handleInputChange('settings.requireApprovalForNewMembers', checked)}
                disabled={!canManageSettings}
              />
            </div>

            <Separator />

            <div>
              <Label htmlFor="defaultStatus">Default Candidate Status</Label>
              <Select 
                value={formData.settings.defaultCandidateStatus} 
                onValueChange={(value) => handleInputChange('settings.defaultCandidateStatus', value)}
                disabled={!canManageSettings}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="New">New</SelectItem>
                  <SelectItem value="Applied">Applied</SelectItem>
                  <SelectItem value="Screening">Screening</SelectItem>
                  <SelectItem value="Interview">Interview</SelectItem>
                  <SelectItem value="Under Review">Under Review</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-gray-600 mt-1">
                Status automatically assigned to new candidates
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        {canManageSettings && (
          <div className="flex justify-between">
            <div>
              {isOwner && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center space-x-2"
                >
                  <AlertTriangle className="w-4 h-4" />
                  <span>Delete Organization</span>
                </Button>
              )}
            </div>
            
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        )}
      </form>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-red-600">
                <AlertTriangle className="w-5 h-5" />
                <span>Delete Organization</span>
              </CardTitle>
              <CardDescription>
                This action cannot be undone. All data including jobs, candidates, and member access will be permanently removed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex space-x-3">
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteOrganization}
                  disabled={isDeleting}
                  className="flex-1"
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default OrganizationSettings; 