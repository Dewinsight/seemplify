'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { saveJobStagesAsTemplate } from '@/services/stageTemplateService';
import { toast } from 'sonner';

interface SaveAsTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobId: string;
  stages: any[];
  onSuccess?: (template: any) => void;
}

export function SaveAsTemplateModal({
  isOpen,
  onClose,
  jobId,
  stages,
  onSuccess
}: SaveAsTemplateModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || name.trim().length < 3) {
      setError('Template name must be at least 3 characters');
      return;
    }

    try {
      setLoading(true);

      const template = await saveJobStagesAsTemplate(
        jobId,
        {
          templateName: name.trim(),
          templateDescription: description.trim() || undefined
        }
      );

      console.log('Template created:', template);

      toast.success('Template saved successfully!', {
        description: `You can now use "${name}" for future jobs.`
      });

      onSuccess?.(template);
      onClose();
      
      // Reset form
      setName('');
      setDescription('');
    } catch (err: any) {
      console.error('Error saving template:', err);
      setError(err.message || 'Failed to save template. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setName('');
      setDescription('');
      setError(null);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] w-full">
        <DialogHeader>
          <DialogTitle className="text-2xl">Save as Template</DialogTitle>
          <DialogDescription>
            Save your current stage configuration as a reusable template.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Template Name */}
          <div className="space-y-2">
            <Label htmlFor="templateName">
              Template Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="templateName"
              placeholder="e.g., Engineering - Remote First"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="h-12"
              disabled={loading}
              required
              autoFocus
            />
            <p className="text-sm text-muted-foreground">
              {name.length}/100 characters
            </p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="templateDescription">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="templateDescription"
              placeholder="Describe when to use this template..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={4}
              className="resize-none"
              disabled={loading}
            />
            <p className="text-sm text-muted-foreground">
              {description.length}/500 characters
            </p>
          </div>

          {/* Preview */}
          <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/20 p-4 space-y-2">
            <div className="flex items-start gap-2">
              <CheckCircle className="h-5 w-5 text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100">
                  This template will include {stages.length} stage{stages.length !== 1 ? 's' : ''}
                </p>
                <p className="text-sm text-indigo-700 dark:text-indigo-300 mt-1">
                  {stages.map((s: any) => s.name).join(', ')}
                </p>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Actions */}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || name.trim().length < 3 || loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Template'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

