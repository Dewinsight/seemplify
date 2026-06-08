/**
 * OIDC/SSO Login Configuration
 * 
 * Control the visibility and appearance of the OIDC login button on the login page.
 * This allows SmartHR to integrate with external identity providers.
 */

const isProduction = process.env.NODE_ENV === 'production';
const DEFAULT_IDP_URL = isProduction ? 'https://auth.seemplifyai.com' : 'http://localhost:4000';

export const oidcConfig = {
  // Digilog recruiter manages its own login/registration locally — no external IDP.
  enabled: false,
  buttonText: 'Login with aiin',
  providerName: 'AIIN Identity',
  showDivider: true,
  identityProviderUrl:
    process.env.NEXT_PUBLIC_IDP_URL ||
    process.env.NEXT_PUBLIC_OIDC_ISSUER ||
    DEFAULT_IDP_URL,
} as const;

export function getOidcDisplayConfig(brandId?: string) {
  const isAkwaIbom = brandId === 'jetstone';
  return {
    ...oidcConfig,
    buttonText: isAkwaIbom ? 'Login with Akwa Ibom' : 'Login with aiin',
    providerName: isAkwaIbom ? 'Akwa Ibom State Identity' : 'AIIN Identity',
  };
}

export type OIDCConfig = typeof oidcConfig;
