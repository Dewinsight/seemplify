/**
 * OIDC/SSO Login Configuration
 * 
 * Control the visibility and appearance of the OIDC login button on the login page.
 * This allows SmartHR to integrate with external identity providers.
 */


export const oidcConfig = {
  // Digilog recruiter manages its own login/registration locally — no external IDP.
  enabled: false,
  buttonText: 'Login with aiin',
  providerName: 'AIIN Identity',
  showDivider: true,
  identityProviderUrl: '',
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
