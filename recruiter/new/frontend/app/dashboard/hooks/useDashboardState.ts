'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ViewMode = 'simple' | 'detailed';
export type TabId = 'overview' | 'pipeline' | 'performance' | 'activity';

interface DashboardSection {
  id: string;
  visible: boolean;
  expanded: boolean;
  order: number;
}

interface DashboardState {
  // View mode
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  
  // Active tab
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  
  // Section visibility
  sections: Record<string, DashboardSection>;
  toggleSectionVisibility: (sectionId: string) => void;
  toggleSectionExpanded: (sectionId: string) => void;
  updateSectionOrder: (sectionId: string, newOrder: number) => void;
  
  // Metric focus
  focusedMetric: string | null;
  setFocusedMetric: (metricId: string | null) => void;
  
  // Preferences
  showTrends: boolean;
  toggleShowTrends: () => void;
  animationsEnabled: boolean;
  toggleAnimations: () => void;
  
  // Reset to defaults
  resetToDefaults: () => void;
}

const defaultSections: Record<string, DashboardSection> = {
  keyMetrics: { id: 'keyMetrics', visible: true, expanded: true, order: 1 },
  analytics: { id: 'analytics', visible: true, expanded: true, order: 2 },
  quickActions: { id: 'quickActions', visible: true, expanded: false, order: 3 },
  activityFeed: { id: 'activityFeed', visible: true, expanded: false, order: 4 },
  topJobs: { id: 'topJobs', visible: true, expanded: false, order: 5 },
};

export const useDashboardState = create<DashboardState>()(
  persist(
    (set) => ({
      // Initial state
      viewMode: 'simple',
      activeTab: 'overview',
      sections: defaultSections,
      focusedMetric: null,
      showTrends: true,
      animationsEnabled: true,
      
      // Actions
      setViewMode: (mode) => set({ viewMode: mode }),
      
      setActiveTab: (tab) => set({ activeTab: tab }),
      
      toggleSectionVisibility: (sectionId) =>
        set((state) => ({
          sections: {
            ...state.sections,
            [sectionId]: {
              ...state.sections[sectionId],
              visible: !state.sections[sectionId]?.visible,
            },
          },
        })),
      
      toggleSectionExpanded: (sectionId) =>
        set((state) => ({
          sections: {
            ...state.sections,
            [sectionId]: {
              ...state.sections[sectionId],
              expanded: !state.sections[sectionId]?.expanded,
            },
          },
        })),
      
      updateSectionOrder: (sectionId, newOrder) =>
        set((state) => ({
          sections: {
            ...state.sections,
            [sectionId]: {
              ...state.sections[sectionId],
              order: newOrder,
            },
          },
        })),
      
      setFocusedMetric: (metricId) => set({ focusedMetric: metricId }),
      
      toggleShowTrends: () => set((state) => ({ showTrends: !state.showTrends })),
      
      toggleAnimations: () => set((state) => ({ animationsEnabled: !state.animationsEnabled })),
      
      resetToDefaults: () =>
        set({
          viewMode: 'simple',
          activeTab: 'overview',
          sections: defaultSections,
          focusedMetric: null,
          showTrends: true,
          animationsEnabled: true,
        }),
    }),
    {
      name: 'dashboard-preferences',
      partialize: (state) => ({
        viewMode: state.viewMode,
        activeTab: state.activeTab,
        sections: state.sections,
        showTrends: state.showTrends,
        animationsEnabled: state.animationsEnabled,
      }),
    }
  )
);
