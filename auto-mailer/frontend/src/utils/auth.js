// Token management
export const getAuthToken = () => {
  return localStorage.getItem('auth_token');
};

export const setAuthToken = (token) => {
  localStorage.setItem('auth_token', token);
};

export const removeAuthToken = () => {
  localStorage.removeItem('auth_token');
};

// User data management
export const getUserData = () => {
  const userData = localStorage.getItem('user_data');
  try {
    return userData ? JSON.parse(userData) : null;
  } catch (error) {
    console.error('Error parsing user data:', error);
    return null;
  }
};

export const setUserData = (userData) => {
  localStorage.setItem('user_data', JSON.stringify(userData));
};

export const removeUserData = () => {
  localStorage.removeItem('user_data');
};

// Check if user is authenticated
export const isAuthenticated = () => {
  const token = getAuthToken();
  const userData = getUserData();
  
  if (!token || !userData) {
    return false;
  }
  
  // Check if token is expired (basic check)
  try {
    const tokenPayload = JSON.parse(atob(token.split('.')[1]));
    const currentTime = Date.now() / 1000;
    
    if (tokenPayload.exp < currentTime) {
      // Token is expired, clean up
      logout();
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Error checking token expiration:', error);
    return false;
  }
};

// Logout function
export const logout = () => {
  removeAuthToken();
  removeUserData();
  
  // Redirect to login page
  window.location.href = '/login';
};

// Login function
export const login = (token, userData) => {
  setAuthToken(token);
  setUserData(userData);
};

// Format error messages
export const formatErrorMessage = (error) => {
  if (error.response?.data?.message) {
    return error.response.data.message;
  }
  
  if (error.message) {
    return error.message;
  }
  
  return 'An unexpected error occurred. Please try again.';
};

// Validate email format
export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Validate password strength
export const validatePassword = (password) => {
  const minLength = 6;
  const errors = [];
  
  if (!password) {
    errors.push('Password is required');
  } else {
    if (password.length < minLength) {
      errors.push(`Password must be at least ${minLength} characters long`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

// Format user name
export const formatUserName = (user) => {
  if (!user) return 'User';
  
  if (user.name) {
    return user.name;
  }
  
  if (user.email) {
    return user.email.split('@')[0];
  }
  
  return 'User';
};

// Get user initials for avatar
export const getUserInitials = (user) => {
  if (!user) return 'U';
  
  if (user.name) {
    return user.name
      .split(' ')
      .map(name => name.charAt(0))
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }
  
  if (user.email) {
    return user.email.charAt(0).toUpperCase();
  }
  
  return 'U';
};
