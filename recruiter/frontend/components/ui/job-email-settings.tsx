"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import {
  ArrowRight,
  CheckCircle,
  Inbox,
  Loader2,
  Mail,
  Save,
  Sparkles,
  Star,
  TestTube,
  Trash2,
  UserCheck,
  UserX,
  Wand2,
} from 'lucide-react';
import candidateEmailService, { EmailSettings } from '../../services/candidateEmailService';
import { EmailTemplateDesigner } from '@/components/ui/email-template-designer';
import { useUser } from '@/context/UserContext';
import { useOrganization } from '@/context/OrganizationContext';
import { resolveEmailPreviewOrganizationName } from '@/lib/emailOrganizationContext';
import {
  DEFAULT_CANDIDATE_EMAIL_TEMPLATE_PRESET_BY_TYPE,
  getDefaultCandidateEmailTemplatePreset,
  getCandidateEmailTemplatePresets,
  getCandidateEmailTemplateVariables,
  getLegacyCandidateEmailTemplateReplacement,
} from '@/lib/candidateEmailTemplatePresets';
import type { CandidateEmailTemplateType } from '@/lib/candidateEmailTemplatePresets';

interface JobEmailSettingsProps {
  jobId: string;
  jobTitle: string;
  initialTemplate?: CandidateEmailTemplateType;
  onSettingsChange?: (settings: EmailSettings) => void;
}

interface SavedTemplateEntry {
  id: string;
  name: string;
  templateType: CandidateEmailTemplateType;
  content: string;
  isDefaultForType: boolean;
  createdAt: string;
}

const TEMPLATE_FILE_NAME_MAP: Record<CandidateEmailTemplateType, string> = {
  rejection: 'rejection-notice',
  shortlistRejection: 'shortlist-rejection',
  shortlist: 'shortlist-congratulations',
  advancement: 'advancement-congratulations',
  applicationConfirmation: 'application-confirmation',
};

const TEMPLATE_LABEL_MAP: Record<CandidateEmailTemplateType, string> = {
  rejection: 'Pipeline Rejection',
  shortlistRejection: 'Shortlist Rejection',
  shortlist: 'Shortlist Congratulations',
  advancement: 'Stage Advancement',
  applicationConfirmation: 'Application Confirmation',
};

const TEMPLATE_TEST_MAP: Record<CandidateEmailTemplateType, 'advancement' | 'shortlist' | 'rejection' | 'shortlist-rejection' | 'application-confirmation'> = {
  rejection: 'rejection',
  shortlistRejection: 'shortlist-rejection',
  shortlist: 'shortlist',
  advancement: 'advancement',
  applicationConfirmation: 'application-confirmation',
};

const TEMPLATE_OPTIONS: Array<{
  type: CandidateEmailTemplateType;
  label: string;
  trigger: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { type: 'rejection', label: 'Pipeline rejection', trigger: 'Candidate rejected from a pipeline stage', icon: UserX },
  { type: 'shortlistRejection', label: 'Shortlist rejection', trigger: 'Candidate rejected from the shortlist', icon: UserX },
  { type: 'advancement', label: 'Stage advancement', trigger: 'Candidate moved to another pipeline stage', icon: ArrowRight },
  { type: 'shortlist', label: 'Shortlist success', trigger: 'Candidate added to the shortlist', icon: UserCheck },
  { type: 'applicationConfirmation', label: 'Application received', trigger: 'Candidate submits an application', icon: Inbox },
];

const TEMPLATE_LIBRARY_STORAGE_KEY = 'smarthr.candidate.email.template.library.v1';

const BUNDLED_DEFAULT_TEMPLATES = TEMPLATE_OPTIONS.reduce<Record<string, string>>(
  (templates, option) => {
    const defaultPreset = getDefaultCandidateEmailTemplatePreset(option.type);
    templates[TEMPLATE_FILE_NAME_MAP[option.type]] = defaultPreset?.content || '';
    return templates;
  },
  {}
);

const replaceLegacyCandidateTemplates = (emailSettings: EmailSettings) => {
  const customTemplates = { ...(emailSettings.customTemplates || {}) };
  const migratedTypes: CandidateEmailTemplateType[] = [];

  TEMPLATE_OPTIONS.forEach(({ type }) => {
    const replacement = getLegacyCandidateEmailTemplateReplacement(type, customTemplates[type]);
    if (!replacement) {
      return;
    }
    customTemplates[type] = replacement.content;
    migratedTypes.push(type);
  });

  return {
    emailSettings: migratedTypes.length > 0
      ? { ...emailSettings, customTemplates }
      : emailSettings,
    migratedTypes,
  };
};

export function JobEmailSettings({ jobId, jobTitle, initialTemplate = 'rejection', onSettingsChange }: JobEmailSettingsProps) {
  const { toast } = useToast();
  const { state } = useUser();
  const { currentOrganization } = useOrganization();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [settings, setSettings] = useState<EmailSettings>({});
  const [testEmail, setTestEmail] = useState('');
  const [defaultTemplates, setDefaultTemplates] = useState<Record<string, string>>(
    BUNDLED_DEFAULT_TEMPLATES
  );
  const [activeTemplate, setActiveTemplate] = useState<CandidateEmailTemplateType>(initialTemplate);
  const [persistedTemplates, setPersistedTemplates] = useState<EmailSettings['customTemplates']>({});
  const [saveConfirmation, setSaveConfirmation] = useState<{
    templateType: CandidateEmailTemplateType;
    savedAt: Date;
  } | null>(null);
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
    setActiveTemplate(initialTemplate);
  }, [initialTemplate]);

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
    const organizationName = resolveEmailPreviewOrganizationName(currentOrganization);
    const senderName =
      [userProfile.firstName, userProfile.lastName].filter(Boolean).join(' ') ||
      (state.user as any)?.fullName ||
      state.user?.email ||
      organizationName;

    return {
      candidateName: 'Alex Candidate',
      candidateFirstName: 'Alex',
      candidateLastName: 'Candidate',
      candidateEmail: 'alex.candidate@example.com',
      jobTitle: jobTitle || 'Open Position',
      organizationName,
      previousStageName: 'Phone Screen',
      nextStageName: 'Technical Interview',
      stageDescription: '45-minute session with the engineering team.',
      feedback: 'Strong communication. Add more detail on large-scale project impact.',
      stage: 'Technical Interview',
      notes: 'Please monitor your inbox for scheduling instructions.',
      applicationDate: new Date().toLocaleDateString(),
      jobLocation: 'London or remote',
      contactEmail: state.user?.email || 'hiring@example.com',
      interviewerName: senderName,
      companyLogo: currentOrganization?.logo || ''
    };
  }, [currentOrganization?.logo, currentOrganization?.name, jobTitle, state.user]);

  const activeLibraryTemplates = useMemo(
    () => templateLibrary.filter((item) => item.templateType === activeTemplate),
    [activeTemplate, templateLibrary]
  );

  const activeTemplateContent = useMemo(() => {
    const customTemplate = settings.customTemplates?.[activeTemplate];
    if (customTemplate && customTemplate.trim()) {
      return customTemplate;
    }

    const fileName = TEMPLATE_FILE_NAME_MAP[activeTemplate];
    return defaultTemplates[fileName] || '';
  }, [activeTemplate, defaultTemplates, settings.customTemplates]);

  const activePresets = useMemo(
    () => getCandidateEmailTemplatePresets(activeTemplate),
    [activeTemplate]
  );

  const activeVariables = useMemo(
    () => getCandidateEmailTemplateVariables(activeTemplate),
    [activeTemplate]
  );

  const persistedActiveContent = useMemo(() => {
    const custom = persistedTemplates?.[activeTemplate];
    if (custom?.trim()) {
      return custom;
    }
    return defaultTemplates[TEMPLATE_FILE_NAME_MAP[activeTemplate]] || '';
  }, [activeTemplate, defaultTemplates, persistedTemplates]);

  const hasUnsavedChanges = activeTemplateContent.trim() !== persistedActiveContent.trim();
  const isActiveTemplateCustomized = !!persistedTemplates?.[activeTemplate]?.trim();

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

          if (!['rejection', 'shortlistRejection', 'shortlist', 'advancement', 'applicationConfirmation'].includes(item.templateType)) {
            return null;
          }

          return {
            id: item.id,
            name: item.name,
            content: item.content,
            templateType: item.templateType as CandidateEmailTemplateType,
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
            const response = await fetch(`/api/candidate-emails/templates/${name}`, {
              cache: 'no-store',
            });
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

      setDefaultTemplates((currentTemplates) => ({ ...currentTemplates, ...templates }));
    } catch (error) {
      console.error('Error loading default candidate email templates:', error);
    }
  };

  const loadEmailSettings = async () => {
    try {
      setLoading(true);
      const response = await candidateEmailService.getEmailSettings(jobId);
      const loadedSettings = response.emailSettings || {};
      const migration = replaceLegacyCandidateTemplates(loadedSettings);
      let currentSettings = migration.emailSettings;
      let persistedTemplates = loadedSettings.customTemplates || {};

      if (migration.migratedTypes.length > 0) {
        try {
          const migratedResponse = await candidateEmailService.updateEmailSettings(
            jobId,
            migration.emailSettings
          );
          currentSettings = migratedResponse.emailSettings || migration.emailSettings;
          persistedTemplates = currentSettings.customTemplates || {};
          onSettingsChange?.(currentSettings);
          toast({
            title: 'Email templates updated',
            description: 'Older stock templates were replaced with the correct candidate-specific versions.',
          });
        } catch (migrationError) {
          console.error('Failed to persist candidate email template migration:', migrationError);
          toast({
            title: 'Review updated email templates',
            description: 'The corrected content is shown, but it still needs to be saved for this job.',
            variant: 'destructive',
          });
        }
      }

      setSettings(currentSettings);
      setPersistedTemplates(persistedTemplates);
      setSaveConfirmation(null);
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

  const handleCustomTemplateChange = (templateType: CandidateEmailTemplateType, value: string) => {
    const newSettings: EmailSettings = {
      ...settings,
      customTemplates: {
        ...settings.customTemplates,
        [templateType]: value
      }
    };
    setSettings(newSettings);
    setSaveConfirmation(null);
    onSettingsChange?.(newSettings);
  };

  const resetCurrentTemplateToSystemDefault = async () => {
    const systemDefault = defaultTemplates[TEMPLATE_FILE_NAME_MAP[activeTemplate]];
    if (!systemDefault) {
      toast({
        title: 'Default not available yet',
        description: 'System template is still loading. Try again in a moment.',
        variant: 'destructive'
      });
      return;
    }

    try {
      setSaving(true);
      const updatedSettings: EmailSettings = {
        ...settings,
        customTemplates: {
          ...settings.customTemplates,
          [activeTemplate]: ''
        }
      };
      const response = await candidateEmailService.updateEmailSettings(jobId, updatedSettings);
      const savedSettings = response.emailSettings || updatedSettings;
      setSettings(savedSettings);
      setPersistedTemplates(savedSettings.customTemplates || updatedSettings.customTemplates || {});
      setSaveConfirmation({ templateType: activeTemplate, savedAt: new Date() });
      onSettingsChange?.(savedSettings);
      toast({
        title: 'System default restored',
        description: `${TEMPLATE_LABEL_MAP[activeTemplate]} now uses the plain system email.`
      });
    } catch (error: any) {
      toast({
        title: 'Failed to restore default',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
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
      const savedSettings = response.emailSettings || updatedSettings;
      setSettings(savedSettings);
      setPersistedTemplates(savedSettings.customTemplates || updatedSettings.customTemplates || {});
      setSaveConfirmation({ templateType: activeTemplate, savedAt: new Date() });
      onSettingsChange?.(savedSettings);

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

  const sendTestEmail = async (templateType: CandidateEmailTemplateType) => {
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
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading candidate email templates...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Mail className="h-5 w-5" />
          Candidate email templates
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{jobTitle}</p>
      </div>

      <Tabs defaultValue="templates" className="space-y-5">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="templates">Customize emails</TabsTrigger>
          <TabsTrigger value="test">Send a test</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="space-y-5">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5" role="list" aria-label="Candidate email template types">
            {TEMPLATE_OPTIONS.map(option => {
              const Icon = option.icon;
              const isActive = activeTemplate === option.type;
              const isCustomized = !!persistedTemplates?.[option.type]?.trim();
              return (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => setActiveTemplate(option.type)}
                  aria-pressed={isActive}
                  data-template-type={option.type}
                  className={`min-h-24 rounded-md border p-3 text-left transition-colors ${
                    isActive
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border bg-background hover:bg-muted/40'
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <Badge variant={isCustomized ? 'default' : 'secondary'} className="rounded-md text-[10px]">
                      {isCustomized ? 'Customized' : 'Default'}
                    </Badge>
                  </span>
                  <span className="mt-2 block text-sm font-medium">{option.label}</span>
                  <span className="mt-1 block text-xs leading-4 text-muted-foreground">{option.trigger}</span>
                </button>
              );
            })}
          </div>

          <div className="border-t pt-5">
            <EmailTemplateDesigner
              key={activeTemplate}
              value={activeTemplateContent}
              onChange={(nextTemplate) => handleCustomTemplateChange(activeTemplate, nextTemplate)}
              previewData={previewTemplateData}
              presets={activePresets}
              variables={activeVariables}
              defaultPresetId={DEFAULT_CANDIDATE_EMAIL_TEMPLATE_PRESET_BY_TYPE[activeTemplate]}
              contentPresetId={
                settings.customTemplates?.[activeTemplate]?.trim()
                  ? undefined
                  : DEFAULT_CANDIDATE_EMAIL_TEMPLATE_PRESET_BY_TYPE[activeTemplate]
              }
              label={`${TEMPLATE_LABEL_MAP[activeTemplate]} email`}
              helperText="Candidate placeholders below are matched to this email and filled automatically when it is sent."
            />
          </div>

          <div className="flex flex-col gap-3 border-y py-4 sm:flex-row sm:items-center sm:justify-between">
            <div aria-live="polite" role="status" className="min-h-5 text-sm">
              {hasUnsavedChanges ? (
                <span className="font-medium text-amber-700 dark:text-amber-300">Unsaved changes</span>
              ) : saveConfirmation?.templateType === activeTemplate ? (
                <span className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCircle className="h-4 w-4" />
                  Saved for this job at {saveConfirmation.savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              ) : (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle className="h-4 w-4" />
                  {isActiveTemplateCustomized ? 'Customized template is saved' : 'Plain system default is active'}
                </span>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={resetCurrentTemplateToSystemDefault}
                disabled={saving || (!isActiveTemplateCustomized && !hasUnsavedChanges)}
              >
                <Wand2 className="mr-2 h-4 w-4" />
                Restore plain default
              </Button>
              <Button
                type="button"
                onClick={saveCurrentTemplateToJob}
                disabled={saving || !hasUnsavedChanges || !activeTemplateContent.trim()}
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {saving ? 'Saving...' : 'Save email template'}
              </Button>
            </div>
          </div>

          <details className="border-b pb-4">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4" />
              Reusable templates
            </summary>
            <div className="mt-3 space-y-3">
              <div className="flex flex-col gap-2 lg:flex-row">
                <Input
                  value={savedTemplateName}
                  onChange={(event) => setSavedTemplateName(event.target.value)}
                  placeholder="Reusable template name"
                  className="lg:flex-1"
                />
                <Button type="button" variant="outline" onClick={() => saveCurrentTemplateToLibrary(false)}>
                  Save to library
                </Button>
                <Button type="button" variant="outline" onClick={() => saveCurrentTemplateToLibrary(true)}>
                  <Star className="mr-2 h-4 w-4" />
                  Mark preferred
                </Button>
              </div>

              {activeLibraryTemplates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No reusable {TEMPLATE_LABEL_MAP[activeTemplate].toLowerCase()} templates yet.</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {activeLibraryTemplates.map(template => (
                    <div key={template.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{template.name}</p>
                          {template.isDefaultForType && <Badge variant="secondary">Preferred</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground">Saved {new Date(template.createdAt).toLocaleString()}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => applyLibraryTemplate(template.id)}>Apply</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setLibraryTemplateAsDefault(template.id)}>
                          <Star className="mr-1 h-3.5 w-3.5" />
                          Prefer
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => deleteLibraryTemplate(template.id)}
                          aria-label={`Delete ${template.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
        </TabsContent>

        <TabsContent value="test" className="space-y-4">
          <div className="max-w-xl space-y-2">
            <Label htmlFor="test-email">Test email address</Label>
            <Input
              id="test-email"
              type="email"
              placeholder="name@example.com"
              value={testEmail}
              onChange={(event) => setTestEmail(event.target.value)}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATE_OPTIONS.map(option => (
              <Button
                key={option.type}
                onClick={() => sendTestEmail(option.type)}
                disabled={testingEmail || !testEmail.trim()}
                variant="outline"
                className="h-11 justify-start"
              >
                {testingEmail ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TestTube className="mr-2 h-4 w-4" />}
                {option.label}
              </Button>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
