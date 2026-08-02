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
  /** Dark-on-light logo variant, used on light surfaces (e.g. the light marketing header/footer) */
  logoDark?: string;
  /** Icon-only mark used in the top-nav Logo box (falls back to gradient shortName box) */
  iconLogo?: string;
  secondaryLogo?: string;
  useImageLogo?: boolean;
  footerText?: string;
  loginHeading?: string;
  loginSubheading?: string;
  /** Full Tailwind className for marketing homepage root (optional; default purple/slate) */
  landingRootClass?: string;
  /** Full-page gradient for login/signup shells — use without h-screen prefix in code */
  authShellClass?: string;
  /** `<title>` and default `og:title` for link previews (defaults to `name`) */
  metaTitle?: string;
  /** Meta / Open Graph description (defaults to `tagline`) */
  metaDescription?: string;
}

export const BRANDS: Record<string, BrandConfig> = {
  digilog: {
    id: 'digilog',
    name: 'diGiLog',
    shortName: 'DL',
    tagline: 'Smart HR & Recruitment',
    colors: {
      from: 'from-[#754BE5]',
      to: 'to-[#6935CF]',
      pulse: 'bg-[#5FCF62]',
      primary: '#754BE5',
      secondary: '#1E0059',
    },
    gradient: 'from-[#754BE5] to-[#6935CF]',
    patterns: ['digilog', 'digiteam', 'localhost', '127.0.0.1'],
    logo: '/digilog-logo.svg',
    logoDark: '/digilog-logo-dark.svg',
    iconLogo: '/digilog-icon.svg',
    useImageLogo: true,
    metaTitle: 'diGiLog',
    metaDescription: 'Smart HR & Recruitment Platform',
    footerText: '© 2026 diGiLog. All rights reserved.',
    loginHeading: 'diGiLog',
    loginSubheading: 'Smart HR & Recruitment',
    landingRootClass:
      'min-h-screen bg-gradient-to-b from-[#F1ECFF] via-[#FAF9FE] to-white text-[#1E0059] overflow-x-hidden relative digilog-light-theme',
    authShellClass: 'bg-gradient-to-br from-[#1E0059] via-[#3a1f8f] to-[#1E0059]',
  },
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
    patterns: ['smarthr', 'app.seemplifyai', 'app-dev.seemplifyai'],
    metaTitle: 'SmartHR',
    metaDescription: 'Intelligent HR Management System',
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
    subBrandTagline: 'Human Resource Management Portal',
    colors: {
      from: 'from-green-700',
      to: 'to-amber-600',
      pulse: 'bg-amber-400',
      primary: '#15803d',
      secondary: '#d97706',
    },
    gradient: 'from-green-700 to-amber-600',
    patterns: ['jetstone', 'akwaibom', 'aiinnigeria', 'ibom.aiinnigeria.com'],
    metaTitle: 'Akwa Ibom State — Human Resource Management Portal',
    metaDescription:
      'Official Akwa Ibom State government Human Resource Management Portal. Fair, transparent public-sector hiring.',
    logo: '/logoakwa.png',
    secondaryLogo: '/jetstone-logo.png',
    useImageLogo: true,
    footerText: '© 2025 Government of Akwa Ibom State. All rights reserved.',
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
export const DEFAULT_BRAND = 'digilog';

// Get brand by ID
export const getBrandById = (id: string): BrandConfig => {
  return BRANDS[id] || BRANDS[DEFAULT_BRAND];
};

// Detect brand from hostname
export const detectBrandFromHostname = (hostname: string): BrandConfig => {
  const lowerHostname = hostname.toLowerCase();
  
  // Env override (SSR + client): use on Akwa Ibom / Jetstone deploys
  if (process.env.NEXT_PUBLIC_BRAND) {
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
