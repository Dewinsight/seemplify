/**
 * Performance Optimization Utilities for Dashboard
 * 
 * This file contains hooks and utilities to optimize dashboard performance
 * through lazy loading, intersection observers, and memoization.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Hook to detect if an element is visible in viewport
 * Used for lazy loading components
 */
export function useIntersectionObserver(
  options: IntersectionObserverInit = {}
): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(([entry]) => {
      // Once visible, stay visible (no flickering)
      if (entry.isIntersecting) {
        setIsVisible(true);
      }
    }, {
      threshold: 0.1,
      rootMargin: '50px',
      ...options,
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [options]);

  return [ref, isVisible];
}

/**
 * Hook to debounce a value
 * Useful for resize handlers and search inputs
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook to track if user prefers reduced motion
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = () => {
      setPrefersReducedMotion(mediaQuery.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return prefersReducedMotion;
}

/**
 * Hook for optimized window resize handling
 */
export function useWindowSize() {
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  });

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const handleResize = () => {
      // Debounce resize events
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setWindowSize({
          width: window.innerWidth,
          height: window.innerHeight,
        });
      }, 150);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return windowSize;
}

/**
 * Lazy load wrapper component with intersection observer
 */
interface LazyLoadProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  threshold?: number;
  rootMargin?: string;
}

export function LazyLoad({ 
  children, 
  fallback = null,
  threshold = 0.1,
  rootMargin = '50px'
}: LazyLoadProps) {
  const [ref, isVisible] = useIntersectionObserver({ threshold, rootMargin });

  return (
    <div ref={ref}>
      {isVisible ? children : fallback}
    </div>
  );
}

/**
 * Performance monitoring hook
 * Logs slow renders in development
 */
export function usePerformanceMonitor(componentName: string, threshold = 16) {
  const renderCount = useRef(0);
  const lastRenderTime = useRef(Date.now());

  useEffect(() => {
    renderCount.current += 1;
    const currentTime = Date.now();
    const renderTime = currentTime - lastRenderTime.current;

    if (renderTime > threshold && process.env.NODE_ENV === 'development') {
      console.warn(
        `[Performance] ${componentName} took ${renderTime}ms to render (render #${renderCount.current})`
      );
    }

    lastRenderTime.current = currentTime;
  });
}

/**
 * Memoized event handler creator
 */
export function useEventCallback<T extends (...args: any[]) => any>(
  fn: T
): T {
  const ref = useRef(fn);

  useEffect(() => {
    ref.current = fn;
  });

  return useCallback(((...args) => ref.current(...args)) as T, []);
}

