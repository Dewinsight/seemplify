import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GovernedJourneyTemplateWorkspace } from '@/components/journeys/GovernedJourneyTemplateWorkspace';
import { usePlatformAdminAccess } from '@/components/platform-admin/PlatformAdminShell';
import { listPlatformJourneyTemplates, type JourneyTemplate } from '@/lib/journeyTemplates';
import { platformAdminErrorMessage } from '@/lib/platformAdminApi';
import { platformAdminHasPermission } from '@/pages/platform-admin/types';
import { AdminError, AdminLoading, AdminPageHeader } from '@/pages/platform-admin/shared';

export function PlatformAdminJourneyTemplatesPage() {
  const access = usePlatformAdminAccess();
  const canManage = platformAdminHasPermission(access, 'journey_templates.manage');
  const [templates, setTemplates] = useState<JourneyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true); setError('');
    try { setTemplates((await listPlatformJourneyTemplates()).templates); }
    catch (cause) { setError(platformAdminErrorMessage(cause, 'System journey templates could not be loaded.')); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return <div className="space-y-6" data-testid="platform-journey-templates">
    <AdminPageHeader title="Journey templates"
      description="Govern the system templates available to subscribed spaces. Published versions are immutable and remain pinned to maps created from them."
      actions={<Button size="sm" variant="outline" disabled={refreshing} onClick={() => void load()}>
        <RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh
      </Button>} />
    {error && <AdminError message={error} onRetry={() => void load()} />}
    {loading ? <AdminLoading label="Loading journey templates…" />
      : <GovernedJourneyTemplateWorkspace scope="system" templates={templates} canManage={canManage}
        currentUserId={access.user.id} onRefresh={load} />}
  </div>;
}
