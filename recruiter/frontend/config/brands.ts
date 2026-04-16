export interface BrandConfig {
  id: string;
  name: string;
  shortName: string;
  tagline: string;
  /** Sub-brand name displayed below/after the primary name (e.g. "Jetstone Education") */
  subBrandName?: string;
  /** Sub-brand tagline/descriptor */
  subBrandTagline?: string;
  colors: {
    from: string;
    to: string;
    pulse: string;
    primary: string;
    secondary: string;
  };
  gradient: string;
  patterns: string[];
  logo?: string;
  secondaryLogo?: string;
  useImageLogo?: boolean;
  footerText?: string;
  loginHeading?: string;
  loginSubheading?: string;
  /** Full Tailwind className for marketing homepage root (optional; default purple/slate) */
  landingRootClass?: string;
  /** Full-page gradient for login/signup shells — use without h-screen prefix in code */
  authShellClass?: string;
}

export const BRANDS: Record<string, BrandConfig> = {
  smarthr: {
    id: 'smarthr',
    name: 'SmartHR',
    shortName: 'HR',
    tagline: 'AI-Powered Recruitment',
    colors: {
      from: 'from-blue-400',
      to: 'to-purple-500',
      pulse: 'bg-green-400',
      primary: '#3b82f6',
      secondary: '#a855f7',
    },
    gradient: 'from-blue-400 to-purple-500',
    patterns: ['smarthr', 'localhost', '127.0.0.1', 'app.seemplifyai', 'app-dev.seemplifyai'],
    footerText: '© 2025 SmartHR. All rights reserved.',
    loginHeading: 'SmartHR',
    loginSubheading: 'AI-Powered Recruitment',
  },
  jetstone: {
    id: 'jetstone',
    name: 'Govt. of Akwa Ibom State',
    shortName: 'AKS',
    tagline: 'The Land of Promise · Nigeria',
    subBrandName: 'Jetstone Education',
    subBrandTagline: 'Recruitment Portal',
    colors: {
      from: 'from-green-700',
      to: 'to-amber-600',
      pulse: 'bg-amber-400',
      primary: '#15803d',
      secondary: '#d97706',
    },
    gradient: 'from-green-700 to-amber-600',
    patterns: ['jetstone', 'akwaibom'],
    logo: '/akwa-ibom-seal.png',
    secondaryLogo: '/jetstone-logo.png',
    useImageLogo: true,
    footerText: '© 2025 Jetstone Education. All rights reserved.',
    landingRootClass:
      'min-h-screen bg-gradient-to-br from-green-50 via-amber-50 to-white text-slate-900 overflow-x-hidden relative jetstone-light-theme',
    authShellClass: 'bg-gradient-to-br from-green-50 via-amber-50 to-white jetstone-light-theme',
  },
  producive: {
    id: 'producive',
    name: 'Producive',
    shortName: 'PV',
    tagline: 'Productivity Unleashed',
    colors: {
      from: 'from-orange-400',
      to: 'to-red-500',
      pulse: 'bg-amber-400',
      primary: '#f97316',
      secondary: '#ef4444',
    },
    gradient: 'from-orange-400 to-red-500',
    patterns: ['producive', 'productive'],
    footerText: '© 2025 Producive. All rights reserved.',
    loginHeading: 'Producive',
    loginSubheading: 'Productivity Unleashed',
  },
};

// Default brand
export const DEFAULT_BRAND = 'smarthr';

// Get brand by ID
export const getBrandById = (id: string): BrandConfig => {
  return BRANDS[id] || BRANDS[DEFAULT_BRAND];
};

// Detect brand from hostname
export const detectBrandFromHostname = (hostname: string): BrandConfig => {
  const lowerHostname = hostname.toLowerCase();
  
  // Check environment variable override first
  if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_BRAND) {
    const envBrand = BRANDS[process.env.NEXT_PUBLIC_BRAND];
    if (envBrand) return envBrand;
  }
  
  // Match against brand patterns
  for (const brand of Object.values(BRANDS)) {
    for (const pattern of brand.patterns) {
      if (lowerHostname.includes(pattern.toLowerCase())) {
        return brand;
      }
    }
  }
  
  // Return default brand if no match
  return BRANDS[DEFAULT_BRAND];
};

// Export all brands for iteration
export const getAllBrands = (): BrandConfig[] => {
  return Object.values(BRANDS);
};
