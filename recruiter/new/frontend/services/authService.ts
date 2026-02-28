/**
 * Authentication service for handling tokens and user authentication
 */

// Get the auth token from local storage
export const getAuthToken = (): string | null => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('jwt') || localStorage.getItem('adminToken') || null;
  }
  return null;
};

// Set the auth token in local storage
export const setAuthToken = (token: string): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('jwt', token);
  }
};

// Remove the auth token from local storage
export const removeAuthToken = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('jwt');
  }
};

// Get the admin token from local storage
export const getAdminToken = (): string | null => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('adminToken') || null;
  }
  return null;
};

// Set the admin token in local storage
export const setAdminToken = (token: string): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('adminToken', token);
  }
};

// Check if the user is authenticated
export const isAuthenticated = (): boolean => {
  return getAuthToken() !== null;
};

// Check if the user is an admin
export const isAdmin = (): boolean => {
  return getAdminToken() !== null;
};
