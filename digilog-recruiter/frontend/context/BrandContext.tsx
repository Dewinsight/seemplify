'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { BrandConfig, detectBrandFromHostname, DEFAULT_BRAND, BRANDS } from '@/config/brands';

interface BrandContextType {
  brand: BrandConfig;
  isLoading: boolean;
}

const BrandContext = createContext<BrandContextType | undefined>(undefined);

export const BrandProvider = ({ children }: { children: ReactNode }) => {
  const [brand, setBrand] = useState<BrandConfig>(BRANDS[DEFAULT_BRAND]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Detect brand on client side
    const detectBrand = () => {
      try {
        const hostname = window.location.hostname;
        const detectedBrand = detectBrandFromHostname(hostname);
        setBrand(detectedBrand);
        
        // Store in sessionStorage for consistency
        sessionStorage.setItem('app_brand', detectedBrand.id);
        
        console.log(`🎨 Brand detected: ${detectedBrand.name} (${hostname})`);
      } catch (error) {
        console.error('Brand detection error:', error);
        // Fallback to default
        setBrand(BRANDS[DEFAULT_BRAND]);
      } finally {
        setIsLoading(false);
      }
    };

    // Check if brand was already detected in this session
    const cachedBrandId = sessionStorage.getItem('app_brand');
    if (cachedBrandId && BRANDS[cachedBrandId]) {
      setBrand(BRANDS[cachedBrandId]);
      setIsLoading(false);
    } else {
      detectBrand();
    }
  }, []);

  return (
    <BrandContext.Provider value={{ brand, isLoading }}>
      {children}
    </BrandContext.Provider>
  );
};

// Custom hook to use brand context
export const useBrand = (): BrandContextType => {
  const context = useContext(BrandContext);
  if (context === undefined) {
    throw new Error('useBrand must be used within a BrandProvider');
  }
  return context;
};

// Convenience hook to get just the brand config
export const useBrandConfig = (): BrandConfig => {
  const { brand } = useBrand();
  return brand;
};
