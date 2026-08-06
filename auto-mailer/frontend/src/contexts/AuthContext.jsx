import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo } from 'react';
import { getUserData, getAuthToken, isAuthenticated, logout as utilsLogout, login as utilsLogin } from '../utils/auth';
import apiClient from '../api/client';

// Initial state
const initialState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
};

// Action types
const actionTypes = {
  SET_LOADING: 'SET_LOADING',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGOUT: 'LOGOUT',
  SET_ERROR: 'SET_ERROR',
  CLEAR_ERROR: 'CLEAR_ERROR',
  UPDATE_USER: 'UPDATE_USER',
};

// Reducer
const authReducer = (state, action) => {
  switch (action.type) {
    case actionTypes.SET_LOADING:
      return {
        ...state,
        isLoading: action.payload,
        error: null,
      };
    
    case actionTypes.LOGIN_SUCCESS:
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      };
    
    case actionTypes.LOGOUT:
      return {
        ...initialState,
        isLoading: false,
      };
    
    case actionTypes.SET_ERROR:
      return {
        ...state,
        error: action.payload,
        isLoading: false,
      };
    
    case actionTypes.CLEAR_ERROR:
      return {
        ...state,
        error: null,
      };
    
    case actionTypes.UPDATE_USER:
      return {
        ...state,
        user: action.payload,
      };
    
    default:
      return state;
  }
};

// Create context
const AuthContext = createContext();

// AuthProvider component
export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Check authentication status on mount
  useEffect(() => {
    const checkAuthStatus = () => {
      try {
        if (isAuthenticated()) {
          const userData = getUserData();
          const token = getAuthToken();
          
          dispatch({
            type: actionTypes.LOGIN_SUCCESS,
            payload: {
              user: userData,
              token: token,
            },
          });
        } else {
          dispatch({ type: actionTypes.SET_LOADING, payload: false });
        }
      } catch (error) {
        console.error('Error checking auth status:', error);
        dispatch({ type: actionTypes.SET_LOADING, payload: false });
      }
    };

    checkAuthStatus();
  }, []);

  // Login function
  const login = useCallback(async (credentials) => {
    try {
      dispatch({ type: actionTypes.SET_LOADING, payload: true });
      dispatch({ type: actionTypes.CLEAR_ERROR });

      const response = await apiClient.post('/api/auth/login', credentials);
      
      if (response.data.success) {
        const { user, token } = response.data.data;
        
        // Save to localStorage
        utilsLogin(token, user);
        
        // Update state
        dispatch({
          type: actionTypes.LOGIN_SUCCESS,
          payload: { user, token },
        });
        
        return { success: true, data: response.data.data };
      } else {
        throw new Error(response.data.message || 'Login failed');
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Login failed';
      dispatch({ type: actionTypes.SET_ERROR, payload: errorMessage });
      return { success: false, error: errorMessage };
    }
  }, []);

  // Register function
  const register = useCallback(async (userData) => {
    try {
      dispatch({ type: actionTypes.SET_LOADING, payload: true });
      dispatch({ type: actionTypes.CLEAR_ERROR });

      const response = await apiClient.post('/api/auth/register', userData);
      
      if (response.data.success) {
        const { user, token } = response.data.data;
        
        // Save to localStorage
        utilsLogin(token, user);
        
        // Update state
        dispatch({
          type: actionTypes.LOGIN_SUCCESS,
          payload: { user, token },
        });
        
        return { success: true, data: response.data.data };
      } else {
        throw new Error(response.data.message || 'Registration failed');
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Registration failed';
      dispatch({ type: actionTypes.SET_ERROR, payload: errorMessage });
      return { success: false, error: errorMessage };
    }
  }, []);

  // Logout function
  const logout = useCallback(() => {
    utilsLogout();
    dispatch({ type: actionTypes.LOGOUT });
  }, []);

  // Update user profile
  const updateUser = useCallback(async (userData) => {
    try {
      const response = await apiClient.put('/api/auth/profile', userData);
      
      if (response.data.success) {
        const updatedUser = response.data.data.user;
        
        // Update localStorage
        utilsLogin(state.token, updatedUser);
        
        // Update state
        dispatch({ type: actionTypes.UPDATE_USER, payload: updatedUser });
        
        return { success: true, data: updatedUser };
      } else {
        throw new Error(response.data.message || 'Update failed');
      }
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Update failed';
      return { success: false, error: errorMessage };
    }
  }, [state.token]);

  // Clear error function
  const clearError = useCallback(() => {
    dispatch({ type: actionTypes.CLEAR_ERROR });
  }, []);

  // Context value
  const contextValue = useMemo(() => ({
    ...state,
    login,
    register,
    logout,
    updateUser,
    clearError,
  }), [state, login, register, logout, updateUser, clearError]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to use auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  
  return context;
};
