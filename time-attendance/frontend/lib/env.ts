/**
 * Environment Detection and Configuration Utility
 * 
 * This utility ensures production URLs are always used in production,
 * preventing localhost fallbacks from being used accidentally.
 * 
 * Usage:
 *   import { getApiUrl, getIdpUrl, isProduction } from '@/lib/env';
 *   const apiUrl = getApiUrl();
 */

/**
 * Check if we're running in production environment
 */
export function isProduction(): boolean {
    if (typeof window === 'undefined') {
        // Server-side: check NODE_ENV
        return process.env.NODE_ENV === 'production';
    }
    
    // Client-side: check hostname
    const hostname = window.location.hostname;
    return hostname.includes('seemplifyai.com') && !hostname.includes('-dev');
}

/**
 * Check if we're running in local development
 */
export function isLocalDevelopment(): boolean {
    if (typeof window === 'undefined') {
        return process.env.NODE_ENV === 'development';
    }
    
    const hostname = window.location.hostname;
    return hostname === 'localhost' || 
           hostname === '127.0.0.1' || 
           hostname.startsWith('192.168.') ||
           hostname.startsWith('10.') ||
           hostname.endsWith('.local');
}

/**
 * Get API URL - always uses production in production, prevents localhost fallback
 */
export function getApiUrl(): string {
    // Production: always use production API
    if (isProduction()) {
        return 'https://api-time.seemplifyai.com/api';
    }
    
    // Local development: use env var or localhost
    if (isLocalDevelopment()) {
        return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5010/api';
    }
    
    // Dev environment or other: use env var with fallback
    return process.env.NEXT_PUBLIC_API_URL || 'https://api-time.seemplifyai.com/api';
}

/**
 * Get IDP URL - always uses production in production, prevents localhost fallback
 */
export function getIdpUrl(): string {
    // Production: always use production IDP
    if (isProduction()) {
        return 'https://auth.seemplifyai.com';
    }
    
    // Local development: use env var or localhost
    if (isLocalDevelopment()) {
        return process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000';
    }
    
    // Dev environment or other: use env var with fallback
    return process.env.NEXT_PUBLIC_IDP_URL || 'https://auth.seemplifyai.com';
}

/**
 * Validate that production URLs are being used in production
 * Throws error if localhost is detected in production
 */
export function validateProductionUrls(): void {
    if (typeof window === 'undefined') {
        return; // Skip on server-side
    }
    
    if (isProduction()) {
        const apiUrl = getApiUrl();
        const idpUrl = getIdpUrl();
        
        if (apiUrl.includes('localhost') || apiUrl.includes('127.0.0.1')) {
            console.error('❌ PRODUCTION ERROR: API URL contains localhost!', apiUrl);
            throw new Error('Production API URL cannot contain localhost');
        }
        
        if (idpUrl.includes('localhost') || idpUrl.includes('127.0.0.1')) {
            console.error('❌ PRODUCTION ERROR: IDP URL contains localhost!', idpUrl);
            throw new Error('Production IDP URL cannot contain localhost');
        }
        
        console.log('✅ Production URLs validated:', { apiUrl, idpUrl });
    }
}

// Auto-validate on module load (client-side only)
if (typeof window !== 'undefined') {
    // Run validation after a short delay to ensure window is fully initialized
    setTimeout(() => {
        try {
            validateProductionUrls();
        } catch (error) {
            console.error('Environment validation failed:', error);
            // In production, this will help catch issues early
        }
    }, 100);
}
