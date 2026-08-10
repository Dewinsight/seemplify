'use client';

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useUserContext } from '@/lib/hooks';

export type PerformanceWorkspace = 'personal' | 'manager' | 'admin';

export interface PerformanceWorkspaceOption {
  value: PerformanceWorkspace;
  label: string;
  description: string;
}

interface PerformanceWorkspaceContextValue {
  workspace: PerformanceWorkspace;
  availableWorkspaces: PerformanceWorkspaceOption[];
  setWorkspace: (workspace: PerformanceWorkspace) => void;
  isReady: boolean;
}

const PERSONAL_WORKSPACE: PerformanceWorkspaceOption = {
  value: 'personal',
  label: 'Personal',
  description: 'Your goals, appraisals and growth',
};

const MANAGER_WORKSPACE: PerformanceWorkspaceOption = {
  value: 'manager',
  label: 'Manager',
  description: 'Direct reports, approvals and coaching',
};

const ADMIN_WORKSPACE: PerformanceWorkspaceOption = {
  value: 'admin',
  label: 'Admin',
  description: 'Cycles, calibration and organization reporting',
};

const PerformanceWorkspaceContext = createContext<PerformanceWorkspaceContextValue | null>(null);

function normalizedId(value: unknown) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return String(record.id || record._id || record.sub || '');
  }
  return String(value);
}

export function PerformanceWorkspaceProvider({ children }: { children: ReactNode }) {
  const { user: authUser, currentOrganization } = useAuth();
  const { user, isManager, isHRAdmin, teams, isLoading } = useUserContext();

  const hasManagerAssignment = useMemo(() => (
    teams.some((team: Record<string, unknown>) => (
      team.isManager === true
      || team.role === 'line_manager'
      || team.role === 'team_lead'
    ))
  ), [teams]);
  const canUseManagerWorkspace = isManager && (!isHRAdmin || hasManagerAssignment);

  const availableWorkspaces = useMemo(() => {
    const workspaces = [PERSONAL_WORKSPACE];
    if (canUseManagerWorkspace) workspaces.push(MANAGER_WORKSPACE);
    if (isHRAdmin) workspaces.push(ADMIN_WORKSPACE);
    return workspaces;
  }, [canUseManagerWorkspace, isHRAdmin]);

  const userId = normalizedId(user) || normalizedId(authUser);
  const organizationId = normalizedId(currentOrganization);
  const storageKey = userId && organizationId
    ? `performance-workspace:${organizationId}:${userId}`
    : '';

  const getWorkspaceSnapshot = useCallback((): PerformanceWorkspace => {
    if (!storageKey) return 'personal';
    const allowed = new Set(availableWorkspaces.map((option) => option.value));
    const saved = window.localStorage.getItem(storageKey) as PerformanceWorkspace | null;
    return saved && allowed.has(saved) ? saved : 'personal';
  }, [availableWorkspaces, storageKey]);

  const subscribe = useCallback((onStoreChange: () => void) => {
    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === storageKey) onStoreChange();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('performance-workspace-change', onStoreChange);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('performance-workspace-change', onStoreChange);
    };
  }, [storageKey]);

  const workspace = useSyncExternalStore(
    subscribe,
    getWorkspaceSnapshot,
    (): PerformanceWorkspace => 'personal',
  );

  const setWorkspace = useCallback((nextWorkspace: PerformanceWorkspace) => {
    const allowed = availableWorkspaces.some((option) => option.value === nextWorkspace);
    const safeWorkspace = allowed ? nextWorkspace : 'personal';
    if (storageKey) window.localStorage.setItem(storageKey, safeWorkspace);
    window.dispatchEvent(new Event('performance-workspace-change'));
  }, [availableWorkspaces, storageKey]);

  const value = useMemo(() => ({
    workspace,
    availableWorkspaces,
    setWorkspace,
    isReady: !isLoading,
  }), [availableWorkspaces, isLoading, setWorkspace, workspace]);

  return (
    <PerformanceWorkspaceContext.Provider value={value}>
      {children}
    </PerformanceWorkspaceContext.Provider>
  );
}

export function usePerformanceWorkspace() {
  const context = useContext(PerformanceWorkspaceContext);
  if (!context) throw new Error('usePerformanceWorkspace must be used within PerformanceWorkspaceProvider');
  return context;
}
