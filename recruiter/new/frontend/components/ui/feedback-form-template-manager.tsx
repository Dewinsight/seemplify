"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  FileText, 
  Plus, 
  Edit, 
  Trash2, 
  Copy, 
  Star, 
  Loader2,
  MoreVertical,
  Settings
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import feedbackFormService, { 
  FeedbackFormTemplate, 
  FieldConfig,
  CustomField
} from '@/services/feedbackFormService';
import { CustomFieldBuilder } from './custom-field-builder';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

const SYSTEM_FIELDS: Array<{id: string, label: string, description: string}> = [
  { id: 'name', label: 'Name', description: 'Respondent name' },
  { id: 'email', label: 'Email', description: 'Respondent email' },
  { id: 'overallRating', label: 'Overall Rating', description: 'Overall candidate rating' },
  { id: 'technicalRating', label: 'Technical Skills', description: 'Technical proficiency rating' },
  { id: 'communicationRating', label: 'Communication Skills', description: 'Communication ability rating' },
  { id: 'culturalRating', label: 'Cultural Fit', description: 'Cultural fit rating' },
  { id: 'generalFeedback', label: 'General Feedback', description: 'General comments' }
];

interface FeedbackFormTemplateManagerProps {
  onTemplateSelected?: (template: FeedbackFormTemplate) => void;
}

export function FeedbackFormTemplateManager({ onTemplateSelected }: FeedbackFormTemplateManagerProps) {
  const [templates, setTemplates] = useState<FeedbackFormTemplate[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<FeedbackFormTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('templates');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    isDefault: false,
    systemFields: SYSTEM_FIELDS.map((field, index) => ({
      fieldId: field.id,
      fieldType: 'system' as const,
      isVisible: true,
      isRequired: ['name', 'email'].includes(field.id),
      order: index + 1,
      label: field.label
    })),
    customFields: [] as FieldConfig[]
  });

  const [selectedCustomFields, setSelectedCustomFields] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [templatesData, fieldsData] = await Promise.all([
        feedbackFormService.getTemplates(),
        feedbackFormService.getCustomFields()
      ]);
      setTemplates(templatesData);
      setCustomFields(fieldsData);
    } catch (error: any) {
      toast.error(error.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTemplate = () => {
    setEditingTemplate(null);
    setFormData({
      name: '',
      description: '',
      isDefault: false,
      systemFields: SYSTEM_FIELDS.map((field, index) => ({
        fieldId: field.id,
        fieldType: 'system',
        isVisible: true,
        isRequired: ['name', 'email'].includes(field.id),
        order: index + 1,
        label: field.label
      })),
      customFields: []
    });
    setSelectedCustomFields(new Set());
    setFieldErrors({});
    setShowDialog(true);
  };

  const handleEditTemplate = (template: FeedbackFormTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      description: template.description || '',
      isDefault: template.isDefault,
      systemFields: template.systemFields as any,
      customFields: template.customFields as any
    });
    
    // Extract field IDs - handle both string and populated object
    const selected = new Set(
      template.customFields
        .filter(f => f.customFieldRef)
        .map(f => {
          const ref = f.customFieldRef;
          // If it's a populated object, get the _id, otherwise use as-is
          return typeof ref === 'object' && ref !== null ? (ref as any)._id : ref as string;
        })
    );
    setSelectedCustomFields(selected);
    setFieldErrors({});
    setShowDialog(true);
  };

  const handleSaveTemplate = async () => {
    try {
      // Clear previous errors
      setFieldErrors({});

      if (!formData.name.trim()) {
        setFieldErrors({ name: 'Template name is required' });
        toast.error('Template name is required');
        return;
      }

      setSaving(true);

      // Build custom fields config from selected fields
      const customFieldsConfig: FieldConfig[] = Array.from(selectedCustomFields).map((fieldId, index) => {
        const field = customFields.find(f => f._id === fieldId);
        // Ensure fieldId is a string, not an object
        const cleanFieldId = typeof fieldId === 'string' ? fieldId : (fieldId as any)._id || fieldId;
        return {
          fieldId: cleanFieldId,
          fieldType: 'custom',
          customFieldRef: cleanFieldId, // Always send string ID, never populated object
          isVisible: true,
          isRequired: false,
          order: formData.systemFields.length + index + 1,
          label: field?.label || ''
        };
      });

      const payload = {
        name: formData.name,
        description: formData.description,
        isDefault: formData.isDefault,
        systemFields: formData.systemFields,
        customFields: customFieldsConfig
      };

      if (editingTemplate) {
        await feedbackFormService.updateTemplate(editingTemplate._id, payload);
        toast.success('Template updated successfully');
      } else {
        await feedbackFormService.createTemplate(payload);
        toast.success('Template created successfully');
      }

      await loadData();
      setShowDialog(false);
      setFieldErrors({});
    } catch (error: any) {
      // Extract error details from response
      let errorMessage = error.message || 'Failed to save template';
      const errorField = (error as any).field;
      
      // Set field-specific error if available
      if (errorField) {
        setFieldErrors({ [errorField]: errorMessage });
      } else {
        setFieldErrors({});
      }
      
      toast.error(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTemplate = async (template: FeedbackFormTemplate) => {
    if (!template.canDelete) {
      toast.error('Cannot delete default template or template in use');
      return;
    }

    if (!confirm(`Are you sure you want to delete "${template.name}"?`)) {
      return;
    }

    try {
      await feedbackFormService.deleteTemplate(template._id);
      toast.success('Template deleted successfully');
      await loadData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete template');
    }
  };

  const handleDuplicateTemplate = async (template: FeedbackFormTemplate) => {
    try {
      const newName = prompt('Enter name for duplicate template:', `${template.name} (Copy)`);
      if (!newName) return;

      await feedbackFormService.duplicateTemplate(template._id, newName);
      toast.success('Template duplicated successfully');
      await loadData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to duplicate template');
    }
  };

  const toggleSystemFieldVisibility = (fieldId: string) => {
    setFormData(prev => ({
      ...prev,
      systemFields: prev.systemFields.map(f => 
        f.fieldId === fieldId ? { ...f, isVisible: !f.isVisible } : f
      )
    }));
  };

  const toggleSystemFieldRequired = (fieldId: string) => {
    setFormData(prev => ({
      ...prev,
      systemFields: prev.systemFields.map(f => 
        f.fieldId === fieldId ? { ...f, isRequired: !f.isRequired } : f
      )
    }));
  };

  const toggleCustomField = (fieldId: string) => {
    setSelectedCustomFields(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fieldId)) {
        newSet.delete(fieldId);
      } else {
        newSet.add(fieldId);
      }
      return newSet;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="fields">Custom Fields</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold">Feedback Form Templates</h3>
              <p className="text-sm text-muted-foreground">
                Manage reusable feedback form templates
              </p>
            </div>
            <Button onClick={handleCreateTemplate}>
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          </div>

          {templates.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No templates yet</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Create your first feedback form template
                </p>
                <Button onClick={handleCreateTemplate}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Template
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {templates.map((template) => (
                <Card key={template._id} className={template.isDefault ? 'border-primary' : ''}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="font-semibold">{template.name}</h4>
                          {template.isDefault && (
                            <Badge variant="default">
                              <Star className="h-3 w-3 mr-1" />
                              Default
                            </Badge>
                          )}
                          <Badge variant="outline">
                            {template.systemFields.filter(f => f.isVisible).length + template.customFields.length} fields
                          </Badge>
                        </div>
                        {template.description && (
                          <p className="text-sm text-muted-foreground mb-2">{template.description}</p>
                        )}
                        <div className="text-xs text-muted-foreground">
                          Used in {template.usageCount} job{template.usageCount !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEditTemplate(template)}>
                            <Edit className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicateTemplate(template)}>
                            <Copy className="h-4 w-4 mr-2" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleDeleteTemplate(template)}
                            disabled={!template.canDelete}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="fields">
          <CustomFieldBuilder 
            onFieldCreated={() => loadData()}
            onFieldUpdated={() => loadData()}
            onFieldDeleted={() => loadData()}
          />
        </TabsContent>
      </Tabs>

      {/* Create/Edit Template Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? 'Edit Template' : 'Create Template'}
            </DialogTitle>
            <DialogDescription>
              Configure your feedback form template
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Template Info */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Template Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, name: e.target.value }));
                    // Clear error when user starts typing
                    if (fieldErrors.name) {
                      setFieldErrors(prev => {
                        const newErrors = { ...prev };
                        delete newErrors.name;
                        return newErrors;
                      });
                    }
                  }}
                  placeholder="e.g., Technical Interview Feedback"
                  className={fieldErrors.name ? 'border-destructive' : ''}
                />
                {fieldErrors.name && (
                  <p className="text-sm text-destructive">{fieldErrors.name}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, description: e.target.value }));
                    // Clear error when user starts typing
                    if (fieldErrors.description) {
                      setFieldErrors(prev => {
                        const newErrors = { ...prev };
                        delete newErrors.description;
                        return newErrors;
                      });
                    }
                  }}
                  placeholder="Optional description"
                  rows={2}
                  className={fieldErrors.description ? 'border-destructive' : ''}
                />
                {fieldErrors.description && (
                  <p className="text-sm text-destructive">{fieldErrors.description}</p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Set as Default Template</Label>
                  <p className="text-xs text-muted-foreground">Used for new jobs by default</p>
                </div>
                <Switch
                  checked={formData.isDefault}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isDefault: checked }))}
                />
              </div>
            </div>

            {/* System Fields */}
            <div className="space-y-2">
              <Label className="text-base">System Fields</Label>
              <p className="text-sm text-muted-foreground">Configure visibility and requirements for standard fields</p>
              <div className="space-y-2">
                {SYSTEM_FIELDS.map((sysField) => {
                  const fieldConfig = formData.systemFields.find(f => f.fieldId === sysField.id);
                  return (
                    <div key={sysField.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{sysField.label}</p>
                        <p className="text-xs text-muted-foreground">{sysField.description}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <Label className="text-xs">Visible</Label>
                          <Switch
                            checked={fieldConfig?.isVisible || false}
                            onCheckedChange={() => toggleSystemFieldVisibility(sysField.id)}
                          />
                        </div>
                        {fieldConfig?.isVisible && (
                          <div className="flex items-center gap-2">
                            <Label className="text-xs">Required</Label>
                            <Switch
                              checked={fieldConfig?.isRequired || false}
                              onCheckedChange={() => toggleSystemFieldRequired(sysField.id)}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Custom Fields */}
            <div className="space-y-2">
              <Label className="text-base">Custom Fields</Label>
              <p className="text-sm text-muted-foreground">Select custom fields to include in this template</p>
              {fieldErrors.customFields && (
                <p className="text-sm text-destructive">{fieldErrors.customFields}</p>
              )}
              {customFields.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No custom fields available. Create some in the Custom Fields tab.
                </p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {customFields.map((field) => (
                    <div key={field._id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{field.label}</p>
                        <p className="text-xs text-muted-foreground">{field.description || field.type}</p>
                      </div>
                      <Switch
                        checked={selectedCustomFields.has(field._id)}
                        onCheckedChange={() => toggleCustomField(field._id)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveTemplate} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Settings className="h-4 w-4 mr-2" />
                  {editingTemplate ? 'Update' : 'Create'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

