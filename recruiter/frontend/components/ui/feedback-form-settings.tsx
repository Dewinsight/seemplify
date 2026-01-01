"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Save, 
  Loader2, 
  Settings as SettingsIcon,
  FolderOpen
} from 'lucide-react';
import { toast } from 'sonner';
import feedbackFormService, { 
  FeedbackFormConfig,
  FeedbackFormTemplate
} from '@/services/feedbackFormService';
import { FeedbackFormTemplateManager } from './feedback-form-template-manager';

interface FeedbackFormSettingsProps {
  jobId: string;
}

export function FeedbackFormSettings({ jobId }: FeedbackFormSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<FeedbackFormConfig | null>(null);
  const [templates, setTemplates] = useState<FeedbackFormTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  useEffect(() => {
    loadData();
  }, [jobId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [configData, templatesData] = await Promise.all([
        feedbackFormService.getJobFeedbackConfig(jobId),
        feedbackFormService.getTemplates()
      ]);
      
      setConfig(configData);
      setTemplates(templatesData);
      
      // Extract template ID (handle both populated object and string)
      let templateId = '';
      let template = null;
      
      if (configData.templateId) {
        // templateId can be either a string or a populated object
        if (typeof configData.templateId === 'string') {
          templateId = configData.templateId;
          template = templatesData.find(t => t._id === templateId);
        } else if (typeof configData.templateId === 'object' && configData.templateId !== null) {
          // Populated template object
          const populatedTemplate = configData.templateId as any;
          templateId = populatedTemplate._id;
          template = populatedTemplate;
        }
      } else if (configData.template) {
        // Fallback to template field
        templateId = configData.template._id;
        template = configData.template;
      }
      
      if (templateId) {
        setSelectedTemplateId(templateId);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to load feedback form settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      
      await feedbackFormService.updateJobFeedbackConfig(jobId, {
        useTemplate: true,
        templateId: selectedTemplateId,
        overrides: null // Clear any existing overrides
      });
      
      toast.success('Feedback form settings saved successfully');
      await loadData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <Tabs defaultValue="job-settings" className="space-y-6">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="job-settings" className="flex items-center gap-2">
          <SettingsIcon className="h-4 w-4" />
          Job Settings
        </TabsTrigger>
        <TabsTrigger value="manage-templates" className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4" />
          Manage Templates & Fields
        </TabsTrigger>
      </TabsList>

      <TabsContent value="job-settings" className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Feedback Form Configuration</CardTitle>
            <CardDescription>
              Select a feedback form template for this job position
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
          {/* Template Selection */}
          <div className="space-y-2">
            <Label>Feedback Form Template</Label>
            <Select value={selectedTemplateId} onValueChange={handleTemplateChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select a template" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template._id} value={template._id}>
                    {template.name}
                    {template.isDefault && ' (Default)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Select a template to use for this job's feedback form. Configure templates in the "Manage Templates & Fields" tab.
            </p>
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => loadData()} disabled={saving}>
              Reset
            </Button>
            <Button onClick={handleSave} disabled={saving || !selectedTemplateId}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Settings
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
      </TabsContent>

      <TabsContent value="manage-templates" className="space-y-6">
        <FeedbackFormTemplateManager 
          onTemplateSelected={(template) => {
            // When a template is created/updated, refresh the job settings
            loadData();
          }}
        />
      </TabsContent>
    </Tabs>
  );
}

