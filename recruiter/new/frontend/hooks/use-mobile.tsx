"use client"

import { useState, useEffect } from 'react';

const useMobile = (query: string = '(max-width: 768px)') => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    // Set the initial state
    setIsMobile(mediaQuery.matches);

    // Add the listener
    mediaQuery.addEventListener('change', handleChange);

    // Cleanup the listener on component unmount
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [query]);

  return isMobile;
};

export default useMobile;
