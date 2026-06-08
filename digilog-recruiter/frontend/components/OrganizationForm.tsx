'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, LogOut } from 'lucide-react';

interface OrganizationFormProps {
  formData: {
    name: string;
    description: string;
    industry: string;
    size: string;
    website: string;
  };
  onSubmit: (e: React.FormEvent) => void;
  onChange: (field: string, value: string) => void;
  isLoading: boolean;
  showLogout?: boolean;
  onLogout?: () => void;
  submitLabel?: string;
  canSubmit?: boolean;
  limitMessage?: string;
}

const OrganizationForm: React.FC<OrganizationFormProps> = ({
  formData,
  onSubmit,
  onChange,
  isLoading,
  showLogout = false,
  onLogout,
  submitLabel = 'Create Organization',
  canSubmit = true,
  limitMessage
}) => {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="name">Organization Name *</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => onChange('name', e.target.value)}
          placeholder="e.g., Acme Corporation"
          required
          disabled={isLoading}
          autoFocus
        />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => onChange('description', e.target.value)}
          placeholder="Brief description of your organization"
          rows={3}
          disabled={isLoading}
        />
      </div>

      <div>
        <Label htmlFor="industry">Industry</Label>
        <Input
          id="industry"
          value={formData.industry}
          onChange={(e) => onChange('industry', e.target.value)}
          placeholder="e.g., Technology, Healthcare, Finance"
          disabled={isLoading}
        />
      </div>

      <div>
        <Label htmlFor="size">Company Size</Label>
        <Select
          value={formData.size}
          onValueChange={(value) => onChange('size', value)}
          disabled={isLoading}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select company size" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1-10">1-10 employees</SelectItem>
            <SelectItem value="11-50">11-50 employees</SelectItem>
            <SelectItem value="51-200">51-200 employees</SelectItem>
            <SelectItem value="201-500">201-500 employees</SelectItem>
            <SelectItem value="501-1000">501-1000 employees</SelectItem>
            <SelectItem value="1000+">1000+ employees</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="website">Website</Label>
        <Input
          id="website"
          type="url"
          value={formData.website}
          onChange={(e) => onChange('website', e.target.value)}
          placeholder="https://example.com"
          disabled={isLoading}
        />
      </div>

      {limitMessage && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
          <p className="text-sm text-amber-800">{limitMessage}</p>
        </div>
      )}

      <div className="pt-4">
        <Button
          type="submit"
          disabled={isLoading || !canSubmit}
          className="w-full"
          size="lg"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating Organization...
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </div>

      {showLogout && onLogout && (
        <div className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onLogout}
            disabled={isLoading}
            className="w-full"
            size="lg"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Logout Instead
          </Button>
        </div>
      )}

      <p className="text-xs text-center text-gray-500">
        You can update these details later in your organization settings.
      </p>
    </form>
  );
};

export default OrganizationForm;