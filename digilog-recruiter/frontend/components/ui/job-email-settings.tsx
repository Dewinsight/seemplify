"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { CheckCircle, Loader2, Mail, Save, Sparkles, Star, TestTube, Trash2, Wand2 } from 'lucide-react';
import candidateEmailService, { EmailSettings } from '../../services/candidateEmailService';
import { EmailTemplateDesigner } from '@/components/ui/email-template-designer';
import { useUser } from '@/context/UserContext';
import {
  CANDIDATE_EMAIL_TEMPLATE_PRESETS,
  CANDIDATE_EMAIL_TEMPLATE_VARIABLES,
  DEFAULT_CANDIDATE_EMAIL_TEMPLATE_PRESET_ID
} from '@/lib/candidateEmailTemplatePresets';

interface JobEmailSettingsProps {
  jobId: string;
  jobTitle: string;
  onSettingsChange?: (settings: EmailSettings) => void;
}

type TemplateType = 'rejection' | 'shortlistRejection' | 'shortlist' | 'advancement';

interface SavedTemplateEntry {
  id: string;
  name: string;
  templateType: TemplateType;
  content: string;
  isDefaultForType: boolean;
  createdAt: string;
}

const TEMPLATE_FILE_NAME_MAP: Record<TemplateType, string> = {
  rejection: 'rejection-notice',
  shortlistRejection: 'shortlist-rejection',
  shortlist: 'shortlist-congratulations',
  advancement: 'advancement-congratulations'
};

const TEMPLATE_LABEL_MAP: Record<TemplateType, string> = {
  rejection: 'Pipeline Rejection',
  shortlistRejection: 'Shortlist Rejection',
  shortlist: 'Shortlist Congratulations',
  advancement: 'Advancement Congratulations'
};

const TEMPLATE_TEST_MAP: Record<TemplateType, 'advancement' | 'shortlist' | 'rejection' | 'shortlist-rejection'> = {
  rejection: 'rejection',
  shortlistRejection: 'shortlist-rejection',
  shortlist: 'shortlist',
  advancement: 'advancement'
};

const TEMPLATE_LIBRARY_STORAGE_KEY = 'smarthr.candidate.email.template.library.v1';

export function JobEmailSettings({ jobId, jobTitle, onSettingsChange }: JobEmailSettingsProps) {
  const { toast } = useToast();
  const { state } = useUser();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [settings, setSettings] = useState<EmailSettings>({});
  const [testEmail, setTestEmail] = useState('');
  const [defaultTemplates, setDefaultTemplates] = useState<Record<string, string>>({});
  const [activeTemplate, setActiveTemplate] = useState<TemplateType>('shortlistRejection');
  const [savedTemplateName, setSavedTemplateName] = useState('');
  const [templateLibrary, setTemplateLibrary] = useState<SavedTemplateEntry[]>([]);
  const [templateLibraryLoaded, setTemplateLibraryLoaded] = useState(false);

  useEffect(() => {
    loadDefaultTemplates();
    loadTemplateLibrary();
  }, []);

  useEffect(() => {
    loadEmailSettings();
  }, [jobId]);

  useEffect(() => {
    if (!templateLibraryLoaded) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(TEMPLATE_LIBRARY_STORAGE_KEY, JSON.stringify(templateLibrary));
  }, [templateLibrary, templateLibraryLoaded]);

  const previewTemplateData = useMemo(() => {
    const userProfile: any = state.user?.profile || {};
    const organizationName =
      (state.user as any)?.organization?.name ||
      (state.user as any)?.currentOrganizationName ||
      state.user?.company?.name ||
      'Organization';
    const senderName =
      [userProfile.firstName, userProfile.lastName].filter(Boolean).join(' ') ||
      (state.user as any)?.fullName ||
      state.user?.email ||
      organizationName;

    return {
      candidateName: 'Alex Candidate',
      jobTitle: jobTitle || 'Open Position',
      organizationName,
      nextStageName: 'Technical Interview',
      stageDescription: '45-minute session with the engineering team.',
      feedback: 'Strong communication. Add more detail on large-scale project impact.',
      notes: 'Please monitor your inbox for scheduling instructions.',
      applicationDate: new Date().toLocaleDateString(),
      interviewerName: senderName,
      companyLogo: ''
    };
  }, [jobTitle, state.user]);

  const activeLibraryTemplates = useMemo(
    () => templateLibrary.filter((item) => item.templateType === activeTemplate),
    [activeTemplate, templateLibrary]
  );

  const activeTemplateContent = useMemo(() => {
    const customTemplate = settings.customTemplates?.[activeTemplate];
    if (customTemplate && customTemplate.trim()) {
      return customTemplate;
    }

    const defaultLibraryTemplate = templateLibrary.find(
      (item) => item.templateType === activeTemplate && item.isDefaultForType
    );
    if (defaultLibraryTemplate?.content?.trim()) {
      return defaultLibraryTemplate.content;
    }

    const fileName = TEMPLATE_FILE_NAME_MAP[activeTemplate];
    return defaultTemplates[fileName] || '';
  }, [activeTemplate, defaultTemplates, settings.customTemplates, templateLibrary]);

  const loadTemplateLibrary = () => {
    if (typeof window === 'undefined') {
      setTemplateLibraryLoaded(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(TEMPLATE_LIBRARY_STORAGE_KEY);
      if (!raw) {
        setTemplateLibrary([]);
        setTemplateLibraryLoaded(true);
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setTemplateLibrary([]);
        setTemplateLibraryLoaded(true);
        return;
      }

      const normalized = parsed
        .map((item: any): SavedTemplateEntry | null => {
          if (
            !item ||
            typeof item.id !== 'string' ||
            typeof item.name !== 'string' ||
            typeof item.content !== 'string' ||
            !item.templateType
          ) {
            return null;
          }

          if (!['rejection', 'shortlistRejection', 'shortlist', 'advancement'].includes(item.templateType)) {
            return null;
          }

          return {
            id: item.id,
            name: item.name,
            content: item.content,
            templateType: item.templateType as TemplateType,
            isDefaultForType: !!item.isDefaultForType,
            createdAt: item.createdAt || new Date().toISOString()
          };
        })
        .filter(Boolean) as SavedTemplateEntry[];

      setTemplateLibrary(normalized);
      setTemplateLibraryLoaded(true);
    } catch (error) {
      console.error('Failed to load template library from local storage:', error);
      setTemplateLibrary([]);
      setTemplateLibraryLoaded(true);
    }
  };

  const loadDefaultTemplates = async () => {
    try {
      const templateNames = Object.values(TEMPLATE_FILE_NAME_MAP);
      const templates: Record<string, string> = {};

      await Promise.all(
        templateNames.map(async (name) => {
          try {
            const response = await fetch(`/api/candidate-emails/templates/${name}`);
            if (!response.ok) {
              return;
            }
            const html = await response.text();
            templates[name] = html;
          } catch (error) {
            console.error(`Failed to load default template ${name}:`, error);
          }
        })
      );

      setDefaultTemplates(templates);
    } catch (error) {
      console.error('Error loading default candidate email templates:', error);
    }
  };

  const loadEmailSettings = async () => {
    try {
      setLoading(true);
      const response = await candidateEmailService.getEmailSettings(jobId);
      setSettings(response.emailSettings || {});
    } catch (error: any) {
      toast({
        title: 'Error loading email settings',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCustomTemplateChange = (templateType: TemplateType, value: string) => {
    const newSettings: EmailSettings = {
      ...settings,
      customTemplates: {
        ...settings.customTemplates,
        [templateType]: value
      }
    };
    setSettings(newSettings);
    onSettingsChange?.(newSettings);
  };

  const resetCurrentTemplateToSystemDefault = () => {
    const systemDefault = defaultTemplates[TEMPLATE_FILE_NAME_MAP[activeTemplate]];
    if (!systemDefault) {
      toast({
        title: 'Default not available yet',
        description: 'System template is still loading. Try again in a moment.',
        variant: 'destructive'
      });
      return;
    }

    handleCustomTemplateChange(activeTemplate, systemDefault);
    toast({
      title: 'Template reset',
      description: `${TEMPLATE_LABEL_MAP[activeTemplate]} template reset to system default.`
    });
  };

  const saveCurrentTemplateToLibrary = (markAsDefault: boolean) => {
    const content = activeTemplateContent?.trim();
    if (!content) {
      toast({
        title: 'Nothing to save',
        description: 'Template content is empty.',
        variant: 'destructive'
      });
      return;
    }

    const fallbackName = `${TEMPLATE_LABEL_MAP[activeTemplate]} ${new Date().toLocaleDateString()}`;
    const nextName = savedTemplateName.trim() || fallbackName;
    const now = new Date().toISOString();
    const id = `${activeTemplate}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setTemplateLibrary((previous) => {
      const cleared = markAsDefault
        ? previous.map((item) =>
            item.templateType === activeTemplate ? { ...item, isDefaultForType: false } : item
          )
        : previous;

      return [
        ...cleared,
        {
          id,
          name: nextName,
          templateType: activeTemplate,
          content,
          isDefaultForType: markAsDefault,
          createdAt: now
        }
      ];
    });

    setSavedTemplateName('');
    toast({
      title: markAsDefault ? 'Template saved as default' : 'Template saved',
      description: `"${nextName}" saved to reusable templates.`
    });
  };

  const applyLibraryTemplate = (templateId: string) => {
    const selected = templateLibrary.find((item) => item.id === templateId);
    if (!selected) {
      return;
    }

    handleCustomTemplateChange(activeTemplate, selected.content);
    toast({
      title: 'Template applied',
      description: `"${selected.name}" applied to ${TEMPLATE_LABEL_MAP[activeTemplate]}.`
    });
  };

  const setLibraryTemplateAsDefault = (templateId: string) => {
    setTemplateLibrary((previous) =>
      previous.map((item) => {
        if (item.templateType !== activeTemplate) {
          return item;
        }
        return { ...item, isDefaultForType: item.id === templateId };
      })
    );
    toast({
      title: 'Default template updated',
      description: `Default reusable template updated for ${TEMPLATE_LABEL_MAP[activeTemplate]}.`
    });
  };

  const deleteLibraryTemplate = (templateId: string) => {
    setTemplateLibrary((previous) => previous.filter((item) => item.id !== templateId));
    toast({
      title: 'Template removed',
      description: 'Reusable template deleted.'
    });
  };

  const saveCurrentTemplateToJob = async () => {
    try {
      setSaving(true);
      const updatedSettings: EmailSettings = {
        ...settings,
        customTemplates: {
          ...settings.customTemplates,
          [activeTemplate]: activeTemplateContent
        }
      };

      const response = await candidateEmailService.updateEmailSettings(jobId, updatedSettings);
      setSettings(response.emailSettings || updatedSettings);
      onSettingsChange?.(response.emailSettings || updatedSettings);

      toast({
        title: 'Template saved',
        description: `${TEMPLATE_LABEL_MAP[activeTemplate]} template saved for this job.`
      });
    } catch (error: any) {
      toast({
        title: 'Failed to save template',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const saveAllSettings = async () => {
    try {
      setSaving(true);
      const response = await candidateEmailService.updateEmailSettings(jobId, settings);
      setSettings(response.emailSettings || settings);
      onSettingsChange?.(response.emailSettings || settings);
      toast({
        title: 'Settings saved',
        description: 'Email notification settings have been updated successfully.'
      });
    } catch (error: any) {
      toast({
        title: 'Error saving settings',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const sendTestEmail = async (templateType: TemplateType) => {
    if (!testEmail.trim()) {
      toast({
        title: 'Email required',
        description: 'Please enter an email address to send a test message.',
        variant: 'destructive'
      });
      return;
    }

    try {
      setTestingEmail(true);
      await candidateEmailService.sendTestEmail(jobId, testEmail.trim(), TEMPLATE_TEST_MAP[templateType]);
      toast({
        title: 'Test email sent',
        description: `${TEMPLATE_LABEL_MAP[templateType]} test email sent to ${testEmail.trim()}.`
      });
    } catch (error: any) {
      toast({
        title: 'Test email failed',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setTestingEmail(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Loading email settings...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Notification Settings
        </CardTitle>
        <CardDescription>
          Configure and save editable, live-preview email templates for the {jobTitle} pipeline.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="templates" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 gap-1">
            <TabsTrigger value="templates" className="text-xs sm:text-sm px-2 sm:px-4">
              <span className="hidden sm:inline">Email Templates</span>
              <span className="sm:hidden">Templates</span>
            </TabsTrigger>
            <TabsTrigger value="test" className="text-xs sm:text-sm px-2 sm:px-4">
              <span className="hidden sm:inline">Test Emails</span>
              <span className="sm:hidden">Test</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="templates" className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3 sm:p-4 space-y-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="w-full lg:max-w-sm space-y-1">
                  <Label className="text-sm">Template Type</Label>
                  <Select value={activeTemplate} onValueChange={(value) => setActiveTemplate(value as TemplateType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shortlistRejection">Shortlist Rejection</SelectItem>
                      <SelectItem value="rejection">Pipeline Rejection</SelectItem>
                      <SelectItem value="shortlist">Shortlist Congratulations</SelectItem>
                      <SelectItem value="advancement">Advancement Congratulations</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={resetCurrentTemplateToSystemDefault}>
                    <Wand2 className="h-4 w-4 mr-2" />
                    Use System Default
                  </Button>
                  <Button type="button" onClick={saveCurrentTemplateToJob} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Save This Template
                  </Button>
                </div>
              </div>

              <EmailTemplateDesigner
                value={activeTemplateContent}
                onChange={(nextTemplate) => handleCustomTemplateChange(activeTemplate, nextTemplate)}
                previewData={previewTemplateData}
                presets={CANDIDATE_EMAIL_TEMPLATE_PRESETS}
                variables={CANDIDATE_EMAIL_TEMPLATE_VARIABLES}
                defaultPresetId={DEFAULT_CANDIDATE_EMAIL_TEMPLATE_PRESET_ID}
                label={`${TEMPLATE_LABEL_MAP[activeTemplate]} Template`}
                helperText="Editable live preview is enabled. Pick a preset, edit directly in preview, then save."
              />
            </div>

            <div className="rounded-lg border p-3 sm:p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-500" />
                <h4 className="text-sm font-semibold">Reusable Template Library</h4>
              </div>

              <div className="flex flex-col gap-2 lg:flex-row">
                <Input
                  value={savedTemplateName}
                  onChange={(event) => setSavedTemplateName(event.target.value)}
                  placeholder="Template name (optional)"
                  className="lg:flex-1"
                />
                <Button type="button" variant="outline" onClick={() => saveCurrentTemplateToLibrary(false)}>
                  Save Template
                </Button>
                <Button type="button" variant="outline" onClick={() => saveCurrentTemplateToLibrary(true)}>
                  <Star className="h-4 w-4 mr-2" />
                  Save as Default
                </Button>
              </div>

              {activeLibraryTemplates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No reusable templates saved yet for {TEMPLATE_LABEL_MAP[activeTemplate]}.
                </p>
              ) : (
                <div className="space-y-2">
                  {activeLibraryTemplates.map((template) => (
                    <div
                      key={template.id}
                      className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium truncate">{template.name}</p>
                          {template.isDefaultForType && <Badge variant="secondary">Default</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Saved {new Date(template.createdAt).toLocaleString()}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => applyLibraryTemplate(template.id)}>
                          Apply
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setLibraryTemplateAsDefault(template.id)}
                        >
                          <Star className="h-3.5 w-3.5 mr-1" />
                          Default
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => deleteLibraryTemplate(template.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="test" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="test-email" className="text-sm font-medium">
                Test Email Address
              </Label>
              <Input
                id="test-email"
                type="email"
                placeholder="test@example.com"
                value={testEmail}
                onChange={(event) => setTestEmail(event.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Button
                onClick={() => sendTestEmail('advancement')}
                disabled={testingEmail || !testEmail}
                variant="outline"
                size="sm"
                className="h-10 justify-start"
              >
                {testingEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TestTube className="h-4 w-4 mr-2" />}
                Advancement
              </Button>

              <Button
                onClick={() => sendTestEmail('shortlist')}
                disabled={testingEmail || !testEmail}
                variant="outline"
                size="sm"
                className="h-10 justify-start"
              >
                {testingEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TestTube className="h-4 w-4 mr-2" />}
                Shortlist
              </Button>

              <Button
                onClick={() => sendTestEmail('rejection')}
                disabled={testingEmail || !testEmail}
                variant="outline"
                size="sm"
                className="h-10 justify-start"
              >
                {testingEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TestTube className="h-4 w-4 mr-2" />}
                Rejection
              </Button>

              <Button
                onClick={() => sendTestEmail('shortlistRejection')}
                disabled={testingEmail || !testEmail}
                variant="outline"
                size="sm"
                className="h-10 justify-start"
              >
                {testingEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <TestTube className="h-4 w-4 mr-2" />}
                Shortlist Rej.
              </Button>
            </div>

            <div className="p-4 bg-blue-50 rounded-lg">
              <h4 className="text-sm font-medium text-blue-900 mb-2">Test Email Information</h4>
              <p className="text-sm text-blue-700">
                Test emails use realistic sample candidate data and are sent to the address above, so you can validate
                your design and variables before sending to real candidates.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end pt-6 border-t mt-6">
          <Button onClick={saveAllSettings} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Save Settings
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
