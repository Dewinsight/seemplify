/**
 * OIDC/SSO Login Configuration
 * 
 * Control the visibility and appearance of the OIDC login button on the login page.
 * This allows SmartHR to integrate with external identity providers.
 */

const isProduction = process.env.NODE_ENV === 'production';

export const oidcConfig = {
  /**
   * Enable or disable OIDC login button
   * Set to false to hide the button and use only email/password login
   */
  enabled: true,

  /**
   * Customize the OIDC login button text
   * Examples:
   * - "Login with aiin"
   * - "Login with SSO"
   * - "Login with Company Account"
   * - "Sign in with Azure AD"
   * - "Enterprise Login"
   */
  buttonText: 'Login with aiin',

  /**
   * Identity Provider name for display purposes
   */
  providerName: 'AIIN Identity',

  /**
   * Show divider between standard login and OIDC login
   */
  showDivider: true,

  /**
   * Identity Provider URL
   * Automatically uses production URL in production environment
   */
  identityProviderUrl: isProduction 
    ? 'https://smarthr-identity.azurewebsites.net'
    : 'http://localhost:4000',
} as const;

export type OIDCConfig = typeof oidcConfig;
