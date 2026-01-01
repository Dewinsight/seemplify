'use client';

import { useEffect } from 'react';

const useSmoothScroll = () => {
  useEffect(() => {
    // This function handles smooth scrolling when clicking anchor links
    const handleSmoothScroll = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // Check if the click was on an anchor link with a hash
      if (target.tagName === 'A' && target.getAttribute('href')?.startsWith('#')) {
        const href = target.getAttribute('href') as string;
        const targetId = href.replace('#', '');
        const targetElement = document.getElementById(targetId);
        
        if (targetElement) {
          e.preventDefault();
          
          // Get the header height to offset the scroll position
          const header = document.querySelector('header');
          const headerHeight = header ? header.offsetHeight : 0;
          const offsetTop = targetElement.getBoundingClientRect().top + window.scrollY - headerHeight - 20;
          
          // Smooth scroll to the target element
          window.scrollTo({
            top: offsetTop,
            behavior: 'smooth',
          });
          
          // Update the URL without causing a page reload
          history.pushState(null, '', href);
        }
      }
    };
    
    // Add event listener to the document
    document.addEventListener('click', handleSmoothScroll);
    
    // Handle initial URL hash on page load
    const handleInitialHash = () => {
      if (window.location.hash) {
        const targetId = window.location.hash.replace('#', '');
        const targetElement = document.getElementById(targetId);
        
        if (targetElement) {
          setTimeout(() => {
            const header = document.querySelector('header');
            const headerHeight = header ? header.offsetHeight : 0;
            const offsetTop = targetElement.getBoundingClientRect().top + window.scrollY - headerHeight - 20;
            
            window.scrollTo({
              top: offsetTop,
              behavior: 'smooth',
            });
          }, 100);
        }
      }
    };
    
    // Run initial hash handler after a small delay to ensure DOM is ready
    setTimeout(handleInitialHash, 300);
    
    // Clean up event listeners on component unmount
    return () => {
      document.removeEventListener('click', handleSmoothScroll);
    };
  }, []);
};

export default useSmoothScroll;
