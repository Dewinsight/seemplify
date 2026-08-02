'use client';

import { useEffect } from 'react';
import { useBrandConfig } from '@/context/BrandContext';

export default function BrandTitle() {
  const brand = useBrandConfig();

  useEffect(() => {
    document.title = brand.metaTitle ?? brand.name;
  }, [brand.metaTitle, brand.name]);

  return null;
}
