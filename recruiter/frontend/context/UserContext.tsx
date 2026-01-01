'use client';

import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import userService, { UserProfile, DashboardAnalytics, ProfileSuggestion } from '@/services/userService';

interface UserState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  analytics: DashboardAnalytics | null;
  suggestions: ProfileSuggestion[];
  error: string | null;
}

type UserAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_USER'; payload: UserProfile | null }
  | { type: 'SET_ANALYTICS'; payload: DashboardAnalytics | null }
  | { type: 'SET_SUGGESTIONS'; payload: ProfileSuggestion[] }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'UPDATE_PROFILE'; payload: Partial<UserProfile> }
  | { type: 'LOGOUT' };

interface UserContextType {
  state: UserState;
  login: (token: string, isSignupFlow?: boolean) => Promise<void>;
  logout: () => void;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
  loadAnalytics: (range?: string) => Promise<void>;
  loadSuggestions: () => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  updatePreferences: (preferences: any) => Promise<void>;
  isProfileComplete: () => boolean;
  getUserDisplayName: () => string;
  getUserAvatar: () => string | null;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

const initialState: UserState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
  analytics: null,
  suggestions: [],
  error: null,
};

function userReducer(state: UserState, action: UserAction): UserState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    
    case 'SET_USER':
      return {
        ...state,
        user: action.payload,
        isAuthenticated: !!action.payload,
        isLoading: false,
        error: null,
      };
    
    case 'SET_ANALYTICS':
      return { ...state, analytics: action.payload };
    
    case 'SET_SUGGESTIONS':
      return { ...state, suggestions: action.payload };
    
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };
    
    case 'UPDATE_PROFILE':
      if (!state.user) return state;
      return {
        ...state,
        user: { ...state.user, ...action.payload },
      };
    
    case 'LOGOUT':
      return {
        ...initialState,
        isLoading: false,
      };
    
    default:
      return state;
  }
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(userReducer, initialState);
  const pathname = usePathname();
  
  // Check if we're on an admin route (SSR-safe)
  const isAdminRoute = pathname?.startsWith('/admin') || false;
  const [jwt, setJwt] = React.useState<string | null>(null);

  // Helper functions defined first
  const loadAnalytics = async () => {
    try {
      const analytics = await userService.getDashboardAnalytics();
      dispatch({ type: 'SET_ANALYTICS', payload: analytics });
    } catch (error) {
      console.error('Failed to load analytics:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load analytics' });
    }
  };

  const loadSuggestions = async () => {
    try {
      const { suggestions } = await userService.getProfileSuggestions();
      dispatch({ type: 'SET_SUGGESTIONS', payload: suggestions });
    } catch (error) {
      console.error('Failed to load suggestions:', error);
    }
  };



  // Helper function to initialize user with token
  const initializeWithToken = async (token: string) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      const userProfile = await userService.getProfile();
      dispatch({ type: 'SET_USER', payload: userProfile });
      
      // Only load analytics and suggestions if user has organization access
      // This prevents infinite redirect loops for users without organizations
      try {
        await Promise.all([
          loadAnalytics(),
          loadSuggestions(),
        ]);
      } catch (error: any) {
        console.log('Analytics/suggestions loading failed - user may need organization setup:', error.message);
        // Don't dispatch error for organization setup requirements
        // The AppShell will handle showing the organization setup modal
        if (!error.message?.includes('Organization setup required')) {
          dispatch({ type: 'SET_ERROR', payload: 'Failed to load dashboard data' });
        }
      }
    } catch (error) {
      console.error('Failed to initialize user:', error);
      localStorage.removeItem('jwt');
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load user profile' });
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  // Listen for JWT changes in localStorage
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'jwt') {
        const token = e.newValue;
      setJwt(token);
        console.log('Storage event detected for JWT token:', !!token);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Initialize user on mount
  useEffect(() => {
    const initializeUser = async () => {
      // Skip initialization for admin routes
      if (isAdminRoute) {
        console.log('Admin route detected, skipping user initialization');
        dispatch({ type: 'SET_LOADING', payload: false });
        return;
      }
      
      const token = localStorage.getItem('jwt');
      console.log('Initializing user context with token:', !!token);
      if (token) {
        await initializeWithToken(token);
      } else {
        // Don't set mock user - let the app handle unauthenticated state
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    };
    initializeUser();
  }, [isAdminRoute]); // Only run on mount and when admin route changes

  // Re-initialize user when JWT changes from storage events
  useEffect(() => {
    // Skip for admin routes
    if (isAdminRoute) {
      return;
    }
    
    if (jwt !== null) { // Only react to actual changes, not initial null
      const reinitializeUser = async () => {
        console.log('JWT changed via storage event, reinitializing user');
        if (jwt) {
          await initializeWithToken(jwt);
        } else {
          logout();
        }
      };
      reinitializeUser();
    }
  }, [jwt, isAdminRoute]);

  const login = async (token: string, isSignupFlow = false) => {
    try {
      console.log('🔐 UserContext: Starting login process...');
      dispatch({ type: 'SET_LOADING', payload: true });
      localStorage.setItem('jwt', token); // Use 'jwt' to match AuthContext
      console.log('🔐 UserContext: JWT token stored in localStorage');
      
      // Skip profile API call during signup to prevent 401 errors
      if (isSignupFlow) {
        console.log('🔐 UserContext: Signup flow detected - bypassing profile API call');
        // Set minimal user data to satisfy the UI needs
        dispatch({ 
          type: 'SET_USER', 
          payload: { 
            email: localStorage.getItem('signupEmail') || 'new-user@example.com',
            profileCompletion: { 
              percentage: 0,
              missingFields: [],
              lastUpdated: new Date().toISOString()
            }
          } as any
        });
        return; // Exit early, skipping API calls
      }
      
      // Normal flow for existing users
      const userProfile = await userService.getProfile();
      console.log('🔐 UserContext: User profile loaded:', userProfile.email);
      dispatch({ type: 'SET_USER', payload: userProfile });
      
      // Only load analytics and suggestions if user has organization access
      // This prevents infinite redirect loops for users without organizations
      try {
        await Promise.all([
          loadAnalytics(),
          loadSuggestions(),
        ]);
        console.log('🔐 UserContext: Analytics and suggestions loaded successfully');
      } catch (error: any) {
        console.log('🔐 UserContext: Analytics/suggestions loading failed - user may need organization setup:', error.message);
        // Don't throw error for organization setup requirements
        // The AppShell will handle showing the organization setup modal
        if (!error.message?.includes('Organization setup required')) {
          dispatch({ type: 'SET_ERROR', payload: 'Failed to load dashboard data' });
        }
      }
      
      console.log('🔐 UserContext: Login process completed successfully');
    } catch (error) {
      console.error('❌ UserContext: Login failed:', error);
      localStorage.removeItem('jwt');
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load user profile' });
      throw error;
    }
  };

  const logout = () => {
    // No need to update localStorage here since AuthContext.logout handles it
    // But still dispatch the logout action to clear user state
    dispatch({ type: 'LOGOUT' });
  };

  const updateProfile = async (data: Partial<UserProfile>) => {
    try {
      const response = await userService.updateProfile(data);
      
      // Handle the new response structure that includes { user: ..., msg: ... }
      const updatedUser = response.user || response;
      dispatch({ type: 'SET_USER', payload: updatedUser });
      
      // Reload suggestions after profile update
      await loadSuggestions();
    } catch (error) {
      console.error('Failed to update profile:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to update profile' });
      throw error;
    }
  };

  const uploadAvatar = async (file: File) => {
    try {
      const result = await userService.uploadAvatar(file);
      
      // Update user profile with new avatar
      if (state.user) {
        const updatedUser = {
          ...state.user,
          profile: {
            ...state.user.profile,
            avatar: result.avatarUrl,
          },
        };
        dispatch({ type: 'SET_USER', payload: updatedUser });
      }
    } catch (error) {
      console.error('Failed to upload avatar:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to upload avatar' });
      throw error;
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    try {
      await userService.changePassword(currentPassword, newPassword);
    } catch (error) {
      console.error('Failed to change password:', error);
      throw error;
    }
  };

  const updatePreferences = async (preferences: any) => {
    try {
      const result = await userService.updatePreferences(preferences);
      
      // Update user profile with new preferences
      if (state.user) {
        const updatedUser = {
          ...state.user,
          preferences: result.preferences,
        };
        dispatch({ type: 'SET_USER', payload: updatedUser });
      }
    } catch (error) {
      console.error('Failed to update preferences:', error);
      throw error;
    }
  };

  const isProfileComplete = () => {
    if (!state.user) return false;
    return userService.isProfileComplete(state.user);
  };

  const getUserDisplayName = () => {
    if (!state.user) return 'Guest';
    return userService.getUserDisplayName(state.user);
  };

  const getUserAvatar = () => {
    return userService.getUserAvatar(state.user);
  };

  const contextValue: UserContextType = {
    state,
    login,
    logout,
    updateProfile,
    loadAnalytics,
    loadSuggestions,
    uploadAvatar,
    changePassword,
    updatePreferences,
    isProfileComplete,
    getUserDisplayName,
    getUserAvatar,
  };

  return (
    <UserContext.Provider value={contextValue}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
} 