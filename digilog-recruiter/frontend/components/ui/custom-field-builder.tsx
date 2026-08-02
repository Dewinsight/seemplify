"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { 
  Plus, 
  Trash2, 
  Edit, 
  Star, 
  Type, 
  List, 
  CheckSquare, 
  Hash,
  FileText,
  X,
  Save,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import feedbackFormService, { 
  CustomField, 
  CustomFieldOption,
  CreateCustomFieldRequest 
} from '@/services/feedbackFormService';

interface CustomFieldBuilderProps {
  onFieldCreated?: (field: CustomField) => void;
  onFieldUpdated?: (field: CustomField) => void;
  onFieldDeleted?: (fieldId: string) => void;
}

export function CustomFieldBuilder({ 
  onFieldCreated, 
  onFieldUpdated,
  onFieldDeleted 
}: CustomFieldBuilderProps) {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState<CreateCustomFieldRequest>({
    name: '',
    label: '',
    description: '',
    type: 'text',
    options: [],
    validation: {
      required: false
    },
    ratingConfig: {
      scale: 5,
      minLabel: 'Poor',
      maxLabel: 'Excellent',
      displayStyle: 'stars'
    }
  });

  useEffect(() => {
    loadFields();
  }, []);

  const loadFields = async () => {
    try {
      setLoading(true);
      const data = await feedbackFormService.getCustomFields();
      setFields(data);
    } catch (error: any) {
      toast.error(error.message || 'Failed to load custom fields');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateField = () => {
    setEditingField(null);
    setFormData({
      name: '',
      label: '',
      description: '',
      type: 'text',
      options: [],
      validation: {
        required: false
      },
      ratingConfig: {
        scale: 5,
        minLabel: 'Poor',
        maxLabel: 'Excellent',
        displayStyle: 'stars'
      }
    });
    setShowDialog(true);
  };

  const handleEditField = (field: CustomField) => {
    setEditingField(field);
    setFormData({
      name: field.name,
      label: field.label,
      description: field.description || '',
      type: field.type,
      options: field.options || [],
      validation: field.validation || { required: false },
      ratingConfig: field.ratingConfig || {
        scale: 5,
        minLabel: 'Poor',
        maxLabel: 'Excellent',
        displayStyle: 'stars'
      },
      calculationFormula: field.calculationFormula
    });
    setShowDialog(true);
  };

  const handleSaveField = async () => {
    try {
      // Validation
      if (!formData.name.trim()) {
        toast.error('Field name is required');
        return;
      }
      if (!formData.label.trim()) {
        toast.error('Field label is required');
        return;
      }

      // Validate options for radio/checkbox
      if ((formData.type === 'radio' || formData.type === 'checkbox') && 
          (!formData.options || formData.options.length === 0)) {
        toast.error('At least one option is required for radio and checkbox fields');
        return;
      }

      setSaving(true);

      let savedField: CustomField;
      if (editingField) {
        savedField = await feedbackFormService.updateCustomField(editingField._id, formData);
        toast.success('Custom field updated successfully');
        onFieldUpdated?.(savedField);
      } else {
        savedField = await feedbackFormService.createCustomField(formData);
        toast.success('Custom field created successfully');
        onFieldCreated?.(savedField);
      }

      await loadFields();
      setShowDialog(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to save custom field');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteField = async (field: CustomField) => {
    if (!field.canDelete) {
      toast.error('This field is in use and cannot be deleted');
      return;
    }

    if (!confirm(`Are you sure you want to delete "${field.label}"?`)) {
      return;
    }

    try {
      await feedbackFormService.deleteCustomField(field._id);
      toast.success('Custom field deleted successfully');
      onFieldDeleted?.(field._id);
      await loadFields();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete custom field');
    }
  };

  const addOption = () => {
    setFormData(prev => ({
      ...prev,
      options: [...(prev.options || []), { label: '', value: '' }]
    }));
  };

  const updateOption = (index: number, field: 'label' | 'value', value: string) => {
    setFormData(prev => {
      const options = [...(prev.options || [])];
      options[index] = { ...options[index], [field]: value };
      return { ...prev, options };
    });
  };

  const removeOption = (index: number) => {
    setFormData(prev => ({
      ...prev,
      options: (prev.options || []).filter((_, i) => i !== index)
    }));
  };

  const getFieldTypeIcon = (type: string) => {
    switch (type) {
      case 'text': return <Type className="h-4 w-4" />;
      case 'textarea': return <FileText className="h-4 w-4" />;
      case 'rating': return <Star className="h-4 w-4" />;
      case 'radio': return <List className="h-4 w-4" />;
      case 'checkbox': return <CheckSquare className="h-4 w-4" />;
      case 'calculated': return <Hash className="h-4 w-4" />;
      default: return <Type className="h-4 w-4" />;
    }
  };

  const getFieldTypeName = (type: string) => {
    switch (type) {
      case 'text': return 'Text';
      case 'textarea': return 'Long Text';
      case 'rating': return 'Rating';
      case 'radio': return 'Single Choice';
      case 'checkbox': return 'Multiple Choice';
      case 'calculated': return 'Calculated';
      default: return type;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">Custom Fields Library</h3>
          <p className="text-sm text-muted-foreground">
            Create reusable custom fields for feedback forms
          </p>
        </div>
        <Button onClick={handleCreateField}>
          <Plus className="h-4 w-4 mr-2" />
          New Field
        </Button>
      </div>

      {fields.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No custom fields yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first custom field to get started
            </p>
            <Button onClick={handleCreateField}>
              <Plus className="h-4 w-4 mr-2" />
              Create Field
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {fields.map((field) => (
            <Card key={field._id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {getFieldTypeIcon(field.type)}
                      <h4 className="font-semibold">{field.label}</h4>
                      <Badge variant="outline">{getFieldTypeName(field.type)}</Badge>
                      {field.validation?.required && (
                        <Badge variant="secondary">Required</Badge>
                      )}
                    </div>
                    {field.description && (
                      <p className="text-sm text-muted-foreground mb-2">{field.description}</p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Field Name: {field.name}</span>
                      <span>Used in {field.usageCount} template{field.usageCount !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditField(field)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteField(field)}
                      disabled={!field.canDelete}
                      title={!field.canDelete ? 'This field is in use' : 'Delete field'}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingField ? 'Edit Custom Field' : 'Create Custom Field'}
            </DialogTitle>
            <DialogDescription>
              {editingField 
                ? 'Update the custom field details below'
                : 'Create a new custom field for your feedback forms'
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Field Type */}
            <div className="space-y-2">
              <Label>Field Type *</Label>
              <Select
                value={formData.type}
                onValueChange={(value: any) => setFormData(prev => ({ ...prev, type: value }))}
                disabled={!!editingField}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text (Single Line)</SelectItem>
                  <SelectItem value="textarea">Long Text (Multiple Lines)</SelectItem>
                  <SelectItem value="rating">Rating</SelectItem>
                  <SelectItem value="radio">Single Choice (Radio)</SelectItem>
                  <SelectItem value="checkbox">Multiple Choice (Checkbox)</SelectItem>
                  <SelectItem value="calculated">Calculated Field</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Field Name */}
            <div className="space-y-2">
              <Label>Field Name * (Internal identifier)</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., teamworkSkills"
                disabled={!!editingField}
              />
              <p className="text-xs text-muted-foreground">
                Used for identification. Cannot be changed after creation.
              </p>
            </div>

            {/* Field Label */}
            <div className="space-y-2">
              <Label>Field Label * (Shown to users)</Label>
              <Input
                value={formData.label}
                onChange={(e) => setFormData(prev => ({ ...prev, label: e.target.value }))}
                placeholder="e.g., Teamwork Skills"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label>Description (Optional)</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Help text for this field"
                rows={2}
              />
            </div>

            {/* Required Toggle */}
            <div className="flex items-center justify-between">
              <Label>Required Field</Label>
              <Switch
                checked={formData.validation?.required || false}
                onCheckedChange={(checked) => 
                  setFormData(prev => ({
                    ...prev,
                    validation: { ...prev.validation, required: checked }
                  }))
                }
              />
            </div>

            {/* Type-specific Configuration */}
            {(formData.type === 'radio' || formData.type === 'checkbox') && (
              <div className="space-y-2">
                <Label>Options *</Label>
                <div className="space-y-2">
                  {formData.options?.map((option, index) => (
                    <div key={index} className="flex gap-2">
                      <Input
                        placeholder="Label"
                        value={option.label}
                        onChange={(e) => updateOption(index, 'label', e.target.value)}
                        className="flex-1"
                      />
                      <Input
                        placeholder="Value"
                        value={option.value}
                        onChange={(e) => updateOption(index, 'value', e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeOption(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addOption}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Option
                </Button>
              </div>
            )}

            {formData.type === 'rating' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Rating Scale</Label>
                  <Select
                    value={String(formData.ratingConfig?.scale)}
                    onValueChange={(value) => 
                      setFormData(prev => ({
                        ...prev,
                        ratingConfig: { ...prev.ratingConfig!, scale: Number(value) as 3 | 5 | 10 }
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">3-point scale</SelectItem>
                      <SelectItem value="5">5-point scale</SelectItem>
                      <SelectItem value="10">10-point scale</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Min Label</Label>
                    <Input
                      value={formData.ratingConfig?.minLabel}
                      onChange={(e) => 
                        setFormData(prev => ({
                          ...prev,
                          ratingConfig: { ...prev.ratingConfig!, minLabel: e.target.value }
                        }))
                      }
                      placeholder="Poor"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Label</Label>
                    <Input
                      value={formData.ratingConfig?.maxLabel}
                      onChange={(e) => 
                        setFormData(prev => ({
                          ...prev,
                          ratingConfig: { ...prev.ratingConfig!, maxLabel: e.target.value }
                        }))
                      }
                      placeholder="Excellent"
                    />
                  </div>
                </div>
              </div>
            )}

            {formData.type === 'calculated' && (
              <div className="space-y-2">
                <Label>Calculation Formula</Label>
                <Textarea
                  value={formData.calculationFormula}
                  onChange={(e) => setFormData(prev => ({ ...prev, calculationFormula: e.target.value }))}
                  placeholder="e.g., (technicalRating + communicationRating) / 2"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Use field names and arithmetic operators: +, -, *, /, ()
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveField} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {editingField ? 'Update' : 'Create'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

