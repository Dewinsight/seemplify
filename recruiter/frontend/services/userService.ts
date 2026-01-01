import { apiRequest } from './apiConfig';

export interface UserProfile {
  _id: string;
  email: string;
  currentOrganization?: string;
  profile: {
    firstName?: string;
    lastName?: string;
    displayName?: string;
    avatar?: string;
    title?: string;
    bio?: string;
    phone?: string;
    timezone: string;
    language: string;
  };
  company: {
    name?: string;
    industry?: string;
    size?: string;
    website?: string;
    logo?: string;
  };
  preferences: {
    emailNotifications: {
      newApplications: boolean;
      interviews: boolean;
      deadlines: boolean;
      systemUpdates: boolean;
    };
    dashboardConfig: {
      defaultView: string;
      showQuickStats: boolean;
      preferredChartType: string;
    };
    privacy: {
      profileVisibility: string;
      showEmail: boolean;
      showPhone: boolean;
    };
  };
  profileCompletion: {
    percentage: number;
    missingFields: string[];
    lastUpdated: string;
  };
  role: string;
  permissions: string[];
  features: {
    aiAssistant: boolean;
    advancedAnalytics: boolean;
    bulkOperations: boolean;
    apiAccess: boolean;
  };
  subscription: {
    plan: string;
    isActive: boolean;
  };
  fullName: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardAnalytics {
  overview: {
    totalCandidates: {
      value: number;
      trend: { value: number; direction: 'up' | 'down' | 'neutral' };
      label: string;
    };
    totalJobs: {
      value: number;
      trend: { value: number; direction: 'up' | 'down' | 'neutral' };
      label: string;
    };
    activeJobs: {
      value: number;
      trend: { value: number; direction: 'up' | 'down' | 'neutral' };
      label: string;
    };
    candidatesInReview: {
      value: number;
      trend: { value: number; direction: 'up' | 'down' | 'neutral' };
      label: string;
    };
  };
  distributions: {
    candidatesByStatus: Array<{ name: string; value: number }>;
    jobsByStatus: Array<{ name: string; value: number }>;
    candidatesBySource: Array<{ name: string; value: number }>;
    topSkills: Array<{ name: string; count: number }>;
  };
  timeline: {
    candidates: Array<{ date: string; count: number }>;
    jobs: Array<{ date: string; count: number }>;
  };
  topPerformingJobs: Array<{
    title: string;
    department: string;
    applicantCount: number;
    status: string;
  }>;
  recentActivity: Array<{
    type: 'candidate' | 'job';
    title: string;
    subtitle: string;
    timestamp: string;
    status: string;
  }>;
  meta: {
    generatedAt: string;
    range: string;
    dataPoints: {
      candidates: number;
      jobs: number;
    };
  };
}

export interface ProfileSuggestion {
  id: string;
  type: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  action?: string;
}

interface ApiError {
  msg: string;
  error?: any;
  requiresOrganizationSetup?: boolean;
}

// Helper function to handle organization-related errors
const handleOrganizationError = (error: ApiError) => {
  if (error.requiresOrganizationSetup) {
    // Don't redirect - let the AppShell handle showing the organization setup modal
    // This prevents infinite redirect loops
    const orgError = new Error('Organization setup required. Please set up your organization to continue.');
    (orgError as any).requiresOrganizationSetup = true;
    throw orgError;
  }
  throw error;
};

// Get dashboard analytics
export const getDashboardAnalytics = async (): Promise<DashboardAnalytics> => {
  const response = await apiRequest(`/api/users/analytics`, {
    method: "GET",
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Get user profile
export const getUserProfile = async () => {
  const response = await apiRequest(`/api/users/profile`, {
    method: "GET",
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Update user profile
export const updateUserProfile = async (profileData: any) => {
  const response = await apiRequest(`/api/users/profile`, {
    method: "PUT",
    body: JSON.stringify(profileData),
  });

  if (!response.ok) {
    const errorResult: any = await response.json();
    // If it's a validation error, throw the specific error details
    if (response.status === 400 && errorResult.errors) {
      errorResult.validationErrors = errorResult.errors;
      throw errorResult;
    }
    handleOrganizationError(errorResult as ApiError);
  }
  return response.json();
};

// Get profile suggestions
export const getProfileSuggestions = async () => {
  const response = await apiRequest(`/api/users/profile-suggestions`, {
    method: "GET",
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Upload avatar
export const uploadAvatar = async (file: File) => {
  const formData = new FormData();
  formData.append('avatar', file);

  const token = localStorage.getItem('jwt');
  const response = await apiRequest(`/api/users/upload-avatar`, {
    method: 'POST',
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: formData,
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Change password
export const changePassword = async (currentPassword: string, newPassword: string) => {
  const response = await apiRequest(`/api/users/change-password`, {
    method: "PUT",
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    throw errorResult;
  }
  return response.json();
};

// Update preferences
export const updatePreferences = async (preferences: any) => {
  const response = await apiRequest(`/api/users/preferences`, {
    method: "PUT",
    body: JSON.stringify(preferences),
  });

  if (!response.ok) {
    const errorResult: ApiError = await response.json();
    handleOrganizationError(errorResult);
  }
  return response.json();
};

// Helper methods
export const isProfileComplete = (user: any): boolean => {
  return (user?.profileCompletion?.percentage || 0) >= 80;
};

export const getUserDisplayName = (user: any): string => {
  if (!user) return 'User';
  
  if (user.profile?.firstName && user.profile?.lastName) {
    return `${user.profile.firstName} ${user.profile.lastName}`;
  }
  
  if (user.profile?.displayName) {
    return user.profile.displayName;
  }
  
  return user.email?.split('@')[0] || 'User';
};

export const getUserAvatar = (user: any): string | null => {
  return user?.profile?.avatar || null;
};

export default {
  getDashboardAnalytics,
  getUserProfile,
  updateUserProfile,
  getProfileSuggestions,
  uploadAvatar,
  changePassword,
  updatePreferences,
  isProfileComplete,
  getUserDisplayName,
  getUserAvatar,
  // Aliases for backward compatibility
  getProfile: getUserProfile,
  updateProfile: updateUserProfile,
}; 