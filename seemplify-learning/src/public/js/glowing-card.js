/**
 * Glowing Card Effect - Plain JavaScript
 * Works with EJS templates
 */

(function() {
  'use strict';

  class GlowingCard {
    constructor(element, options = {}) {
      this.element = element;
      this.options = {
        proximity: 64,
        inactiveZone: 0.01,
        ...options
      };
      
      this.glowSpotlight = null;
      this.animationFrame = null;
      this.init();
    }

    init() {
      // Create glow spotlight element
      this.glowSpotlight = document.createElement('div');
      this.glowSpotlight.className = 'glow-spotlight';
      this.element.appendChild(this.glowSpotlight);
      
      // Bind methods
      this.handleMouseMove = this.handleMouseMove.bind(this);
      this.handleMouseLeave = this.handleMouseLeave.bind(this);
      
      // Add event listeners
      this.element.addEventListener('mousemove', this.handleMouseMove);
      this.element.addEventListener('mouseleave', this.handleMouseLeave);
    }

    handleMouseMove(e) {
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
      }

      this.animationFrame = requestAnimationFrame(() => {
        const rect = this.element.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        // Check if within proximity
        const distanceFromCenter = Math.hypot(
          e.clientX - (rect.left + rect.width / 2),
          e.clientY - (rect.top + rect.height / 2)
        );
        
        const inactiveRadius = 0.5 * Math.min(rect.width, rect.height) * this.options.inactiveZone;
        
        if (distanceFromCenter < inactiveRadius) {
          this.element.classList.remove('active');
          this.glowSpotlight.style.opacity = '0';
          return;
        }

        // Check proximity
        const isActive = 
          e.clientX > rect.left - this.options.proximity &&
          e.clientX < rect.right + this.options.proximity &&
          e.clientY > rect.top - this.options.proximity &&
          e.clientY < rect.bottom + this.options.proximity;

        if (isActive) {
          this.element.classList.add('active');
          this.glowSpotlight.style.setProperty('--glow-x', `${x}%`);
          this.glowSpotlight.style.setProperty('--glow-y', `${y}%`);
          this.glowSpotlight.style.opacity = '1';
        } else {
          this.element.classList.remove('active');
          this.glowSpotlight.style.opacity = '0';
        }
      });
    }

    handleMouseLeave() {
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
      }
      this.element.classList.remove('active');
      this.glowSpotlight.style.opacity = '0';
    }

    destroy() {
      this.element.removeEventListener('mousemove', this.handleMouseMove);
      this.element.removeEventListener('mouseleave', this.handleMouseLeave);
      if (this.glowSpotlight) {
        this.glowSpotlight.remove();
      }
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
      }
    }
  }

  // Auto-initialize on DOM ready
  function initGlowingCards() {
    const cards = document.querySelectorAll('.glowing-card[data-auto-init="true"]');
    cards.forEach(card => {
      if (!card._glowingCard) {
        const options = {
          proximity: parseInt(card.dataset.proximity) || 64,
          inactiveZone: parseFloat(card.dataset.inactiveZone) || 0.01
        };
        card._glowingCard = new GlowingCard(card, options);
      }
    });
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlowingCards);
  } else {
    initGlowingCards();
  }

  // Expose globally
  window.GlowingCard = GlowingCard;
})();
