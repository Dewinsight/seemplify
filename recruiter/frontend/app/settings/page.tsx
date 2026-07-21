"use client";

import { useState, useRef, useEffect } from 'react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription, 
  CardFooter 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  User, 
  Settings as SettingsIcon, 
  Upload, 
  Save, 
  AlertCircle,
  Camera,
  Mail,
  Phone,
  Globe,
  Shield,
  Bell,
  Eye,
  Clock,
  Trash2,
  CheckCircle,
  Database,
  GraduationCap,
  PlayCircle,
  BookOpen,
  Briefcase,
  Users,
  Calendar,
  BarChart3,
  MessageSquare
} from "lucide-react";
import { useUser } from "@/context/UserContext";
import { toast } from "@/hooks/use-toast";
import { PageLoader, LoadingOverlay, LoadingButton } from "@/components/ui/loading";
import { InactivitySettings } from "@/components/InactivitySettings";
import UserPendingInvitationsSection from "@/components/UserPendingInvitationsSection";
import { TrustedDevices } from "@/components/settings/trusted-devices";
import { useFeatureFlags } from "@/context/FeatureFlagsContext";



const TIMEZONES = [
  'Africa/Lagos',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Australia/Sydney'
];

export default function SettingsPage() {
  const { state, updateProfile, uploadAvatar, changePassword, updatePreferences } = useUser();
  const { isFeatureEnabled } = useFeatureFlags();
  const aiAssistantEnabled = isFeatureEnabled('aiAssistant');
  const { user, isLoading } = state;
  
  const [activeTab, setActiveTab] = useState('profile');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState({
    profile: {
      firstName: '',
      lastName: '',
      displayName: '',
      title: '',
      bio: '',
      phone: '',
      timezone: 'Africa/Lagos',
      language: 'en',
    },
    preferences: {
      emailNotifications: {
        newApplications: true,
        interviews: true,
        deadlines: true,
        systemUpdates: false,
      },
      dashboardConfig: {
        defaultView: 'overview',
        showQuickStats: true,
        preferredChartType: 'line',
      },
      privacy: {
        profileVisibility: 'team',
        showEmail: false,
        showPhone: false,
      },
    },
  });
  
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize form data when user data loads
  useEffect(() => {
    if (user) {
      setFormData({
        profile: {
          firstName: user.profile?.firstName || '',
          lastName: user.profile?.lastName || '',
          displayName: user.profile?.displayName || '',
          title: user.profile?.title || '',
          bio: user.profile?.bio || '',
          phone: user.profile?.phone || '',
          timezone: user.profile?.timezone || 'Africa/Lagos',
          language: user.profile?.language || 'en',
        },
        preferences: {
          emailNotifications: user.preferences?.emailNotifications || {
            newApplications: true,
            interviews: true,
            deadlines: true,
            systemUpdates: false,
          },
          dashboardConfig: user.preferences?.dashboardConfig || {
            defaultView: 'overview',
            showQuickStats: true,
            preferredChartType: 'line',
          },
          privacy: user.preferences?.privacy || {
            profileVisibility: 'team',
            showEmail: false,
            showPhone: false,
          },
        },
      });
    }
  }, [user]);

  // Show loading while user data is being fetched
  if (isLoading || !user) {
    return <PageLoader variant="settings" message="Loading settings..." />
  }

  const handleInputChange = (section: string, field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [section]: {
        ...prev[section as keyof typeof prev],
        [field]: value,
      },
    }));
  };

  const handleNestedInputChange = (section: string, subsection: string, field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [section]: {
        ...prev[section as keyof typeof prev],
        [subsection]: {
          ...(prev[section as keyof typeof prev] as any)[subsection],
          [field]: value,
        },
      },
    }));
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    
    // Client-side validation
    const errors = [];
    
    if (!formData.profile.firstName || formData.profile.firstName.trim().length < 2) {
      errors.push("First name must be at least 2 characters");
    }
    
    if (!formData.profile.lastName || formData.profile.lastName.trim().length < 2) {
      errors.push("Last name must be at least 2 characters");
    }
    
    if (formData.profile.phone && formData.profile.phone.trim().length > 0 && formData.profile.phone.trim().length < 10) {
      errors.push("Phone number must be at least 10 characters");
    }
    
    if (errors.length > 0) {
      toast({
        title: "Validation Error",
        description: errors.join(", "),
        variant: "destructive",
      });
      return;
    }
    
    setSaving(true);
    try {
      await updateProfile({
        profile: {
          ...formData.profile,
          firstName: formData.profile.firstName.trim(),
          lastName: formData.profile.lastName.trim(),
          phone: formData.profile.phone?.trim() || '',
          language: formData.profile.language || 'en'
        }
      });
      
      toast({
        title: "Profile updated",
        description: "Your profile has been successfully updated.",
      });
    } catch (error: any) {
      console.error("Profile update error:", error);
      
      // Handle validation errors from backend
      if (error.errors && typeof error.errors === 'object') {
        const errorMessages = Object.values(error.errors).join(", ");
        toast({
          title: "Validation Error",
          description: errorMessages,
          variant: "destructive",
        });
      } else {
      toast({
        title: "Error",
          description: error.message || "Failed to update profile. Please try again.",
        variant: "destructive",
      });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSavePreferences = async () => {
    setSaving(true);
    try {
      await updatePreferences(formData.preferences);
      
      toast({
        title: "Preferences updated",
        description: "Your preferences have been successfully updated.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update preferences. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file.",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select an image smaller than 5MB.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      await uploadAvatar(file);
      
      toast({
        title: "Avatar updated",
        description: "Your profile picture has been successfully updated.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to upload avatar. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!passwordData.currentPassword || !passwordData.newPassword) {
      toast({
        title: "Missing information",
        description: "Please fill in all password fields.",
        variant: "destructive",
      });
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "New password and confirmation don't match.",
        variant: "destructive",
      });
      return;
    }

    if (passwordData.newPassword.length < 6) {
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters long.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      await changePassword(passwordData.currentPassword, passwordData.newPassword);
      
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      
      toast({
        title: "Password changed",
        description: "Your password has been successfully updated.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to change password. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-6">
        <div className="space-y-6">
          <div className="h-8 bg-gray-200 rounded animate-pulse"></div>
          <div className="h-96 bg-gray-200 rounded animate-pulse"></div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto py-6">
        <Card className="max-w-lg mx-auto">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Profile Loading</h3>
            <p className="text-muted-foreground">
              Your profile is being set up. Please wait a moment and refresh the page.
            </p>
            <Button 
              onClick={() => window.location.reload()} 
              className="mt-4"
            >
              Refresh Page
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header - Responsive Design */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Account Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your account and preferences</p>
        </div>
        
        {/* Profile Completion - Mobile Optimized */}
        <div className="w-full sm:w-auto">
          <Card className="bg-white dark:bg-gray-800 shadow-sm border">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <CheckCircle className={`h-4 w-4 ${user.profileCompletion?.percentage === 100 ? 'text-emerald-500' : 'text-blue-500'}`} />
                  <span className="text-sm font-medium">Profile Completion</span>
                </div>
                <span className={`text-sm font-bold ${user.profileCompletion?.percentage === 100 ? 'text-emerald-600' : 'text-blue-600'}`}>
                  {user.profileCompletion?.percentage || 0}%
                </span>
              </div>
              <Progress 
                value={user.profileCompletion?.percentage || 0} 
                className={`h-2 ${user.profileCompletion?.percentage === 100 ? 'bg-emerald-100' : 'bg-blue-100'}`}
              />
              <p className="text-xs text-muted-foreground mt-2">
                {user.profileCompletion?.percentage === 100 
                  ? "All features unlocked!" 
                  : "Complete your profile to unlock all features"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
          <div className="overflow-x-auto">
            <TabsList className="flex w-full overflow-x-auto pb-px mb-0 sm:grid sm:grid-cols-5 gap-0">
              <TabsTrigger 
                value="profile" 
                className="flex items-center justify-center gap-2 py-3 px-4 flex-shrink-0 whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600"
              >
                <User className="h-4 w-4" />
                <span>Profile</span>
              </TabsTrigger>
              
              <TabsTrigger 
                value="preferences" 
                className="flex items-center justify-center gap-2 py-3 px-4 flex-shrink-0 whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600"
              >
                <SettingsIcon className="h-4 w-4" />
                <span>Preferences</span>
              </TabsTrigger>
              
              <TabsTrigger 
                value="security" 
                className="flex items-center justify-center gap-2 py-3 px-4 flex-shrink-0 whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600"
              >
                <Shield className="h-4 w-4" />
                <span>Security</span>
              </TabsTrigger>

              <TabsTrigger 
                value="tutorial" 
                className="flex items-center justify-center gap-2 py-3 px-4 flex-shrink-0 whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600"
              >
                <GraduationCap className="h-4 w-4" />
                <span className="hidden xs:inline">Getting Started</span>
                <span className="xs:hidden">Tutorial</span>
              </TabsTrigger>
              
              <TabsTrigger 
                value="embeddings" 
                className="flex items-center justify-center gap-2 py-3 px-4 flex-shrink-0 whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600"
              >
                <Database className="h-4 w-4" />
                <span className="hidden xs:inline">AI Embeddings</span>
                <span className="xs:hidden">AI</span>
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-6">
          <Card className="border-gray-200 dark:border-gray-800 shadow-sm">
            <CardHeader className="p-4 sm:p-6 border-b bg-muted/30">
              <CardTitle className="text-lg">Personal Information</CardTitle>
              <CardDescription className="text-sm">
                Update your personal details and profile picture
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 space-y-5">
              {/* Avatar Section - Mobile Optimized */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                <div className="relative mx-auto sm:mx-0">
                  <Avatar className="h-20 w-20 sm:h-24 sm:w-24 border-2 border-muted">
                    <AvatarImage src={user.profile?.avatar} alt="Profile picture" />
                    <AvatarFallback className="text-lg">
                      {user.profile?.firstName?.[0]}{user.profile?.lastName?.[0]}
                    </AvatarFallback>
                  </Avatar>
                  <Button
                    size="sm"
                    variant="outline"
                    className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full p-0"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                    ) : (
                      <Camera className="h-4 w-4" />
                    )}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                </div>
                <div className="text-center sm:text-left">
                  <h3 className="font-semibold">Profile Picture</h3>
                  <p className="text-sm text-muted-foreground">
                    Upload a profile picture. Max size 5MB.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Supported formats: JPG, PNG, GIF
                  </p>
                </div>
              </div>

              {/* Form Groups with Better Mobile Spacing */}
              <div className="space-y-5">
                {/* Personal Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <Label htmlFor="firstName" className="text-sm font-medium">First Name</Label>
                    <Input
                      id="firstName"
                      value={formData.profile.firstName}
                      onChange={(e) => handleInputChange('profile', 'firstName', e.target.value)}
                      placeholder="Enter your first name"
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName" className="text-sm font-medium">Last Name</Label>
                    <Input
                      id="lastName"
                      value={formData.profile.lastName}
                      onChange={(e) => handleInputChange('profile', 'lastName', e.target.value)}
                      placeholder="Enter your last name"
                      className="h-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="displayName" className="text-sm font-medium">Display Name</Label>
                  <Input
                    id="displayName"
                    value={formData.profile.displayName}
                    onChange={(e) => handleInputChange('profile', 'displayName', e.target.value)}
                    placeholder="How you'd like to be addressed"
                    className="h-10"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="title" className="text-sm font-medium">Job Title</Label>
                  <Input
                    id="title"
                    value={formData.profile.title}
                    onChange={(e) => handleInputChange('profile', 'title', e.target.value)}
                    placeholder="e.g. HR Manager, Recruiter"
                    className="h-10"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone" className="text-sm font-medium">Phone Number</Label>
                    <Input
                      id="phone"
                      value={formData.profile.phone}
                      onChange={(e) => handleInputChange('profile', 'phone', e.target.value)}
                      placeholder="+1 (555) 123-4567"
                      className="h-10"
                    />
                </div>
                <div>
                  <Label htmlFor="timezone" className="text-sm font-medium">Timezone</Label>
                  <Select 
                    value={formData.profile.timezone}
                    onValueChange={(value) => handleInputChange('profile', 'timezone', value)}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz.replace('_', ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  </div>
                </div>

              <div>
                <Label htmlFor="bio">Bio</Label>
                <Textarea
                  id="bio"
                  value={formData.profile.bio}
                  onChange={(e) => handleInputChange('profile', 'bio', e.target.value)}
                  placeholder="Tell us about yourself..."
                  rows={3}
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {formData.profile.bio.length}/500 characters
                </p>
              </div>

              <div className="flex justify-end">
                <LoadingButton onClick={handleSaveProfile} loading={saving} className="w-full sm:w-auto">
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </LoadingButton>
              </div>
              </div> {/* Close space-y-5 div */}
            </CardContent>
            <CardFooter className="p-4 sm:p-6 border-t bg-muted/30 flex justify-end">
              <LoadingButton onClick={handleSaveProfile} loading={saving} className="w-full sm:w-auto">
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </LoadingButton>
            </CardFooter>
          </Card>
        </TabsContent>



        {/* Preferences Tab */}
        <TabsContent value="preferences" className="space-y-6">
          <div className="grid gap-6">
            {/* Notification Preferences */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  Notification Preferences
                </CardTitle>
                <CardDescription>
                  Choose what notifications you'd like to receive
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>New Applications</Label>
                    <p className="text-sm text-muted-foreground">Get notified when new candidates apply</p>
                  </div>
                  <Switch 
                    checked={formData.preferences.emailNotifications.newApplications}
                    onCheckedChange={(checked) => 
                      handleNestedInputChange('preferences', 'emailNotifications', 'newApplications', checked)
                    }
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Interview Reminders</Label>
                    <p className="text-sm text-muted-foreground">Reminders for upcoming interviews</p>
                  </div>
                  <Switch 
                    checked={formData.preferences.emailNotifications.interviews}
                    onCheckedChange={(checked) => 
                      handleNestedInputChange('preferences', 'emailNotifications', 'interviews', checked)
                    }
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Deadline Alerts</Label>
                    <p className="text-sm text-muted-foreground">Alerts for approaching deadlines</p>
                  </div>
                  <Switch 
                    checked={formData.preferences.emailNotifications.deadlines}
                    onCheckedChange={(checked) => 
                      handleNestedInputChange('preferences', 'emailNotifications', 'deadlines', checked)
                    }
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <Label>System Updates</Label>
                    <p className="text-sm text-muted-foreground">Updates about new features and changes</p>
                  </div>
                  <Switch 
                    checked={formData.preferences.emailNotifications.systemUpdates}
                    onCheckedChange={(checked) => 
                      handleNestedInputChange('preferences', 'emailNotifications', 'systemUpdates', checked)
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {/* Dashboard Preferences */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="h-5 w-5" />
                  Dashboard Preferences
                </CardTitle>
                <CardDescription>
                  Customize your dashboard experience
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Default View</Label>
                  <Select 
                    value={formData.preferences.dashboardConfig.defaultView}
                    onValueChange={(value) => 
                      handleNestedInputChange('preferences', 'dashboardConfig', 'defaultView', value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="overview">Overview</SelectItem>
                      <SelectItem value="analytics">Analytics</SelectItem>
                      <SelectItem value="candidates">Candidates</SelectItem>
                      <SelectItem value="jobs">Jobs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Preferred Chart Type</Label>
                  <Select 
                    value={formData.preferences.dashboardConfig.preferredChartType}
                    onValueChange={(value) => 
                      handleNestedInputChange('preferences', 'dashboardConfig', 'preferredChartType', value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="line">Line Chart</SelectItem>
                      <SelectItem value="bar">Bar Chart</SelectItem>
                      <SelectItem value="pie">Pie Chart</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Show Quick Stats</Label>
                    <p className="text-sm text-muted-foreground">Display overview statistics on dashboard</p>
                  </div>
                  <Switch 
                    checked={formData.preferences.dashboardConfig.showQuickStats}
                    onCheckedChange={(checked) => 
                      handleNestedInputChange('preferences', 'dashboardConfig', 'showQuickStats', checked)
                    }
                  />
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={handleSavePreferences} disabled={saving}>
                {saving ? (
                  <>
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Preferences
                  </>
                )}
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Change Password
              </CardTitle>
              <CardDescription>
                Update your password to keep your account secure
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="currentPassword">Current Password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={passwordData.currentPassword}
                  onChange={(e) => setPasswordData(prev => ({ ...prev, currentPassword: e.target.value }))}
                  placeholder="Enter your current password"
                />
              </div>

              <div>
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData(prev => ({ ...prev, newPassword: e.target.value }))}
                  placeholder="Enter your new password"
                />
              </div>

              <div>
                <Label htmlFor="confirmPassword">Confirm New Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                  placeholder="Confirm your new password"
                />
              </div>

              <div className="flex justify-end">
                <Button onClick={handlePasswordChange} disabled={saving}>
                  {saving ? (
                    <>
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Shield className="mr-2 h-4 w-4" />
                      Change Password
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Trusted Devices */}
          <TrustedDevices />

          {/* Account Information */}
          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
              <CardDescription>
                View your account details and activity
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Email Address</Label>
                  <p className="text-sm font-medium">{user.email || 'Not provided'}</p>
                </div>
                <div>
                  <Label>Account Created</Label>
                  <p className="text-sm font-medium">
                    {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'}
                  </p>
                </div>
                <div>
                  <Label>Role</Label>
                  <Badge variant="secondary">{user.role || 'user'}</Badge>
                </div>
                <div>
                  <Label>Subscription Plan</Label>
                  <Badge variant="outline">{user.subscription?.plan || 'free'}</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>


        {/* Getting Started Tab */}
        <TabsContent value="tutorial" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GraduationCap className="h-5 w-5" />
                Getting Started with Smart HR
              </CardTitle>
              <CardDescription>
                Welcome to Smart HR! This comprehensive tutorial will guide you through all the features 
                and help you get the most out of your HR management platform.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Video Section */}
              <div className="rounded-lg overflow-hidden border">
                <div className="relative w-full bg-gray-100" style={{ paddingBottom: '56.25%' /* 16:9 aspect ratio */ }}>
                  <iframe
                    src="https://www.youtube.com/embed/kBoKlgC2iF4?rel=0&modestbranding=1&showinfo=0&iv_load_policy=3&controls=1&fs=1"
                    title="Getting Started with Smart HR"
                    className="absolute top-0 left-0 w-full h-full"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>

              {/* Getting Started Steps */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    icon: <User className="w-6 h-6" />,
                    title: "Set Up Your Profile",
                    description: "Complete your organization and user profile to get started",
                    action: "Complete Profile",
                    href: "/settings?tab=profile"
                  },
                  {
                    icon: <Briefcase className="w-6 h-6" />,
                    title: "Create Your First Job",
                    description: "Add job postings to start attracting candidates",
                    action: "Create Job",
                    href: "/jobs"
                  },
                  {
                    icon: <Users className="w-6 h-6" />,
                    title: "Add Candidates",
                    description: "Import or add candidates to your talent pool",
                    action: "Add Candidates", 
                    href: "/candidates"
                  },
                  {
                    icon: <Calendar className="w-6 h-6" />,
                    title: "Schedule Interviews",
                    description: "Use our calendar integration to schedule interviews",
                    action: "Set Up Calendar",
                    href: "/calendar"
                  }
                ].map((step, index) => (
                  <Card key={index} className="p-4">
                    <div className="flex items-center justify-center w-12 h-12 mb-4 rounded-lg bg-blue-100 text-blue-600">
                      {step.icon}
                    </div>
                    <h3 className="font-semibold mb-2">{step.title}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{step.description}</p>
                    <Button asChild size="sm" className="w-full">
                      <a href={step.href}>{step.action}</a>
                    </Button>
                  </Card>
                ))}
              </div>

              {/* Feature Overview */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="p-4">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <PlayCircle className="h-5 w-5" />
                    Quick Tour Features
                  </h3>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      AI-powered candidate matching
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      Automated interview scheduling
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      Pipeline management
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      Real-time analytics
                    </li>
                  </ul>
                </Card>

                <Card className="p-4">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <BookOpen className="h-5 w-5" />
                    Learning Resources
                  </h3>
                  <div className="space-y-2">
                    <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                      <a href="/tutorial" target="_blank">
                        <PlayCircle className="h-4 w-4 mr-2" />
                        Full Tutorial Page
                      </a>
                    </Button>
                    <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                      <a href="/dashboard" target="_blank">
                        <BarChart3 className="h-4 w-4 mr-2" />
                        Dashboard Overview
                      </a>
                    </Button>
                    {aiAssistantEnabled && (
                      <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                        <a href="/assistant" target="_blank">
                          <MessageSquare className="h-4 w-4 mr-2" />
                          AI Assistant Help
                        </a>
                      </Button>
                    )}
                  </div>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Embeddings Tab */}
        <TabsContent value="embeddings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                AI Embedding Management
              </CardTitle>
              <CardDescription>
                Advanced embedding management and monitoring for the AI system. 
                This manages the vector embeddings used for candidate matching and search.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="border-blue-200 bg-blue-50">
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Skills Matching Fix Available:</strong> A critical fix has been implemented to resolve the "skills match 0%" issue. 
                  Use the full embedding management interface for detailed control and monitoring.
                </AlertDescription>
              </Alert>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <Button 
                  onClick={() => window.open('/settings/embeddings', '_blank')}
                  className="flex-1"
                >
                  <Database className="h-4 w-4 mr-2" />
                  Open Embedding Management
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => window.location.href = '/settings/embeddings'}
                  className="flex-1"
                >
                  Go to Embedding Dashboard
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <h4 className="font-medium mb-2">What are AI Embeddings?</h4>
                  <p className="text-sm text-muted-foreground">
                    Vector representations of job descriptions and candidate profiles that enable 
                    intelligent matching, semantic search, and AI-powered recommendations.
                  </p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <h4 className="font-medium mb-2">Why Manage Embeddings?</h4>
                  <p className="text-sm text-muted-foreground">
                    Regular maintenance ensures accurate matching results, fixes parsing issues, 
                    and improves overall system performance for candidate recommendations.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
