'use client';

import { useEffect } from 'react';
import { useBrandConfig } from '@/context/BrandContext';

export default function BrandTitle() {
  const brand = useBrandConfig();

  useEffect(() => {
    document.title = brand.name;
  }, [brand.name]);

  return null;
}
