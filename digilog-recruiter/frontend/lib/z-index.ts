export const Z_INDEX = {
  // Base layers
  dropdown: 40,
  tooltip: 50,
  
  // Modal layers
  modalBackdrop: 100,
  modalContent: 100,
  
  // Special high-priority modals
  schedulerBackdrop: 200,
  schedulerContent: 200,
  nestedModalBackdrop: 300,
  nestedModalContent: 300,
  
  // Tutorial/onboarding
  tutorialOverlay: 400,
  tutorialContent: 401,
  
  // Maximum (use sparingly)
  maximum: 9999
} as const;

export type ZIndexKey = keyof typeof Z_INDEX;
