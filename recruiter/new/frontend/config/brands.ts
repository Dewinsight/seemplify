export interface BrandConfig {
  id: string;
  name: string;
  shortName: string;
  tagline: string;
  colors: {
    from: string;
    to: string;
    pulse: string;
    primary: string;
    secondary: string;
  };
  gradient: string;
  patterns: string[]; // Domain patterns to match
}

export const BRANDS: Record<string, BrandConfig> = {
  smarthr: {
    id: 'smarthr',
    name: 'SmartHR',
    shortName: 'HR',
    tagline: '✨ AI-Powered Recruitment',
    colors: {
      from: 'from-blue-400',
      to: 'to-purple-500',
      pulse: 'bg-green-400',
      primary: '#3b82f6',
      secondary: '#a855f7',
    },
    gradient: 'from-blue-400 to-purple-500',
    patterns: ['smarthr', 'localhost', '127.0.0.1'],
  },
  producive: {
    id: 'producive',
    name: 'Producive',
    shortName: 'PV',
    tagline: '⚡ Productivity Unleashed',
    colors: {
      from: 'from-orange-400',
      to: 'to-red-500',
      pulse: 'bg-amber-400',
      primary: '#f97316',
      secondary: '#ef4444',
    },
    gradient: 'from-orange-400 to-red-500',
    patterns: ['producive', 'productive'],
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
