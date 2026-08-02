"use client";

import { useEffect, useState } from 'react';
import { useAdmin } from '@/context/AdminContext';
import AdminSidebar from '@/components/AdminSidebar';
import AdminHeader from '@/components/AdminHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from '@/hooks/use-toast';
import { apiRequest } from '@/services/apiConfig';
import { useFeatureFlags } from '@/context/FeatureFlagsContext';
import { 
  Settings, 
  Palette, 
  Sun, 
  Moon, 
  Monitor, 
  AlertCircle,
  Info,
  Code,
  Bot,
  Loader2,
  Sparkles,
  Upload,
  Wand2,
  Workflow
} from 'lucide-react';
import { getThemeConfig } from '@/utils/themeConfig';

interface PlatformFeatureDefinition {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

const FEATURE_ICONS = {
  aiInterviews: Bot,
  aiAssistant: Sparkles,
  candidateEnrichment: Wand2,
  bulkCvUpload: Upload,
  peopleTransitions: Workflow,
} as const;

export default function AdminSettingsPage() {
  const { checkPermission } = useAdmin();
  const { refreshFeatures } = useFeatureFlags();
  const [currentConfig] = useState(getThemeConfig());
  const [featureDefinitions, setFeatureDefinitions] = useState<PlatformFeatureDefinition[]>([]);
  const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({});
  const [featuresLoading, setFeaturesLoading] = useState(true);
  const [featureError, setFeatureError] = useState<string | null>(null);
  const [savingFeature, setSavingFeature] = useState<string | null>(null);
  const [featuresUpdatedAt, setFeaturesUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    if (checkPermission('systemSettings')) {
      loadPlatformFeatures();
    }
  }, []);

  const loadPlatformFeatures = async () => {
    try {
      setFeaturesLoading(true);
      setFeatureError(null);
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest('/api/admin/system/features', {
        cache: 'no-store',
        headers: { 'x-admin-auth-token': token || '' }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.msg || 'Failed to load platform features');
      }

      setFeatureDefinitions(data.definitions || []);
      setFeatureFlags(data.features || {});
      setFeaturesUpdatedAt(data.updatedAt || null);
    } catch (error: any) {
      setFeatureError(error.message || 'Failed to load platform features');
    } finally {
      setFeaturesLoading(false);
    }
  };

  const handleFeatureToggle = async (featureKey: string, enabled: boolean) => {
    try {
      setSavingFeature(featureKey);
      setFeatureError(null);
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest('/api/admin/system/features', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth-token': token || ''
        },
        body: JSON.stringify({ features: { [featureKey]: enabled } })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.msg || 'Failed to update platform feature');
      }

      setFeatureFlags(data.features || {});
      setFeaturesUpdatedAt(data.updatedAt || new Date().toISOString());
      void refreshFeatures();
      const feature = featureDefinitions.find((item) => item.key === featureKey);
      toast({
        title: `${feature?.label || 'Feature'} ${enabled ? 'enabled' : 'disabled'}`,
        description: 'The platform setting was saved successfully.'
      });
    } catch (error: any) {
      setFeatureError(error.message || 'Failed to update platform feature');
      toast({
        title: 'Feature update failed',
        description: error.message || 'The platform setting could not be saved.',
        variant: 'destructive'
      });
    } finally {
      setSavingFeature(null);
    }
  };

  if (!checkPermission('systemSettings')) {
    return (
      <div className="flex h-screen bg-gray-900">
        <AdminSidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <AdminHeader />
          <main className="flex-1 overflow-y-auto bg-gray-900 p-6">
            <Card className="bg-gray-800 border-gray-700 max-w-2xl mx-auto mt-8">
              <CardContent className="p-6 text-center">
                <Settings className="h-12 w-12 text-gray-500 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-white mb-2">Access Denied</h2>
                <p className="text-gray-400">You don't have permission to view system settings.</p>
              </CardContent>
            </Card>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-900">
      <AdminSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AdminHeader />
        <main className="flex-1 overflow-y-auto bg-gray-900 p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div>
              <h1 className="text-2xl font-bold text-white">System Settings</h1>
              <p className="text-gray-400 mt-1">Configure platform-wide settings via environment variables</p>
            </div>

            {/* Theme Configuration Card */}
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Palette className="h-5 w-5" />
                  Theme Configuration
                </CardTitle>
                <CardDescription className="text-gray-400">
                  Current theme settings from environment variables
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Current Configuration Display */}
                <div>
                  <Label className="text-base font-semibold text-white mb-4 block">Current Theme Settings</Label>
                  <div className="grid gap-4">
                    {/* Light Theme */}
                    <div className="flex items-center justify-between p-4 bg-gray-700 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Sun className="h-5 w-5 text-yellow-400" />
                        <div>
                          <div className="font-medium text-white">Light Theme</div>
                          <div className="text-sm text-gray-400">Clean, bright interface</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {currentConfig.defaultTheme === 'light' && (
                          <Badge variant="secondary">Default</Badge>
                        )}
                        <Badge variant={currentConfig.availableThemes.light ? "default" : "destructive"}>
                          {currentConfig.availableThemes.light ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                    </div>

                    {/* Dark Theme */}
                    <div className="flex items-center justify-between p-4 bg-gray-700 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Moon className="h-5 w-5 text-blue-400" />
                        <div>
                          <div className="font-medium text-white">Dark Theme</div>
                          <div className="text-sm text-gray-400">Easy on the eyes interface</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {currentConfig.defaultTheme === 'dark' && (
                          <Badge variant="secondary">Default</Badge>
                        )}
                        <Badge variant={currentConfig.availableThemes.dark ? "default" : "destructive"}>
                          {currentConfig.availableThemes.dark ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                    </div>

                    {/* System Theme */}
                    <div className="flex items-center justify-between p-4 bg-gray-700 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Monitor className="h-5 w-5 text-gray-400" />
                        <div>
                          <div className="font-medium text-white">System Theme</div>
                          <div className="text-sm text-gray-400">Follows device preference</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {currentConfig.defaultTheme === 'system' && (
                          <Badge variant="secondary">Default</Badge>
                        )}
                        <Badge variant={currentConfig.availableThemes.system ? "default" : "destructive"}>
                          {currentConfig.availableThemes.system ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Configuration Instructions */}
                <Alert>
                  <Code className="h-4 w-4" />
                  <AlertDescription>
                    <div className="space-y-3">
                      <p><strong>To modify theme settings:</strong></p>
                      <div className="bg-gray-900 p-3 rounded text-sm font-mono">
                        <div>Edit <strong>frontend/config/theme.config.ts</strong>:</div>
                        <div className="mt-2 space-y-1 text-gray-300">
                          <div>lightEnabled: true/false</div>
                          <div>darkEnabled: true/false</div>
                          <div>systemEnabled: true/false</div>
                          <div>defaultTheme: 'light'/'dark'/'system'</div>
                        </div>
                      </div>
                      <p className="text-sm text-gray-400">
                        After changing these values, restart the development server for changes to take effect.
                      </p>
                    </div>
                  </AlertDescription>
                </Alert>

                {/* Status */}
                <div className="pt-4 border-t border-gray-600">
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Info className="h-4 w-4 text-blue-500" />
                    <span>
                      {Object.values(currentConfig.availableThemes).filter(Boolean).length} theme(s) currently enabled
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Default theme: <span className="capitalize">{currentConfig.defaultTheme}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Platform Features */}
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Platform Features
                </CardTitle>
                <CardDescription className="text-gray-400">
                  Global availability for every organization
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {featureError && (
                  <Alert variant="destructive" className="border-red-800 bg-red-950/40 text-red-200">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="flex items-center justify-between gap-4">
                      <span>{featureError}</span>
                      <Button type="button" size="sm" variant="outline" onClick={loadPlatformFeatures}>
                        Retry
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}

                {featuresLoading ? (
                  <div className="flex items-center justify-center py-10 text-sm text-gray-400">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading platform features...
                  </div>
                ) : (
                  <div className="divide-y divide-gray-700 border-y border-gray-700">
                    {featureDefinitions.map((feature) => {
                      const FeatureIcon = FEATURE_ICONS[feature.key as keyof typeof FEATURE_ICONS] || Settings;
                      const isSaving = savingFeature === feature.key;
                      const enabled = featureFlags[feature.key] ?? feature.defaultEnabled;

                      return (
                        <div key={feature.key} className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                          <div className="flex min-w-0 items-start gap-3">
                            <FeatureIcon className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
                            <div>
                              <Label htmlFor={`feature-${feature.key}`} className="text-sm font-medium text-white">
                                {feature.label}
                              </Label>
                              <p className="mt-1 text-sm text-gray-400">{feature.description}</p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-3 self-end sm:self-auto">
                            <span className={`text-xs font-medium ${enabled ? 'text-emerald-400' : 'text-gray-500'}`}>
                              {isSaving ? 'Saving...' : enabled ? 'On' : 'Off'}
                            </span>
                            <Switch
                              id={`feature-${feature.key}`}
                              checked={enabled}
                              disabled={Boolean(savingFeature)}
                              onCheckedChange={(checked) => handleFeatureToggle(feature.key, checked)}
                              aria-label={`${enabled ? 'Disable' : 'Enable'} ${feature.label}`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {featuresUpdatedAt && !featuresLoading && (
                  <p className="text-xs text-gray-500" role="status" aria-live="polite">
                    Last saved {new Date(featuresUpdatedAt).toLocaleString()}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    </div>
  );
}
