'use client';

import React, { useState } from 'react';
import { X, Eye, EyeOff, TestTube, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { apiRequest } from '@/services/apiConfig';

interface NylasAccountModalProps {
  account?: any;
  onClose: () => void;
  onSave: () => void;
}

export function NylasAccountModal({ account, onClose, onSave }: NylasAccountModalProps) {
  const [formData, setFormData] = useState({
    name: account?.name || '',
    clientId: account?.clientId || '',
    apiKey: '',
    clientSecret: '',
    region: account?.region || 'us',
    maxGrants: account?.maxGrants || 5,
    accountType: account?.accountType || 'sandbox',
    priority: account?.priority || 0,
    notes: account?.notes || ''
  });

  const [showApiKey, setShowApiKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const handleTestBeforeSave = async () => {
    if (!formData.clientId || (!account && !formData.apiKey)) {
      toast.error('Please enter Client ID and API Key');
      return;
    }
    
    setTesting(true);
    setTestResult(null);
    
    try {
      const token = localStorage.getItem('adminToken');
      const response = await apiRequest('/api/admin/nylas-accounts/test-credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth-token': token!
        },
        body: JSON.stringify({
          clientId: formData.clientId,
          apiKey: formData.apiKey,
          region: formData.region
        })
      });

      const data = await response.json();
      
      setTestResult(data);
      
      if (data.success) {
        toast.success('✅ Credentials valid!', {
          description: 'Connection to Nylas API successful'
        });
      } else {
        toast.error('❌ Invalid credentials', {
          description: data.message || data.error
        });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: 'Network error or invalid credentials'
      });
      toast.error('Test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    // Validation
    if (!formData.name || !formData.clientId) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (!account && (!formData.apiKey || !formData.clientSecret)) {
      toast.error('API Key and Client Secret are required for new accounts');
      return;
    }

    setSaving(true);
    try {
      const url = account 
        ? `/api/admin/nylas-accounts/${account._id}`
        : '/api/admin/nylas-accounts';
      
      const method = account ? 'PUT' : 'POST';

      const token = localStorage.getItem('adminToken');
      const response = await apiRequest(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth-token': token!
        },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (data.success) {
        toast.success(account ? 'Account updated' : 'Account created successfully', {
          description: account ? 'Nylas account updated' : 'New Nylas account added to the pool'
        });
        onSave();
      } else {
        toast.error(data.error || 'Failed to save account');
      }
    } catch (error) {
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white z-10">
          <h2 className="text-2xl font-bold text-foreground">
            {account ? 'Edit' : 'Add'} Nylas Account
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-muted-foreground transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <div className="p-6 space-y-5">
          {/* Account Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Account Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              placeholder="e.g., Production US, Sandbox Europe"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
            />
            <p className="text-xs text-muted-foreground mt-1">Friendly name to identify this account</p>
          </div>

          {/* Client ID */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Client ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm transition-all"
              placeholder="70fe2510-7ea4-4159-8d13-99a1cce95fe7"
              value={formData.clientId}
              onChange={(e) => setFormData({...formData, clientId: e.target.value})}
              disabled={!!account}
            />
            {account && (
              <p className="text-xs text-amber-600 mt-1">Client ID cannot be changed after creation</p>
            )}
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              API Key {!account && <span className="text-red-500">*</span>}
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm pr-12 transition-all"
                placeholder={account ? 'Leave blank to keep current' : 'nyk_v0_...'}
                value={formData.apiKey}
                onChange={(e) => setFormData({...formData, apiKey: e.target.value})}
              />
              {account && (
                <p className="text-xs text-muted-foreground mt-1">Leave blank to keep existing API Key</p>
              )}
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-muted-foreground transition-colors"
              >
                {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Client Secret */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Client Secret {!account && <span className="text-red-500">*</span>}
            </label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm pr-12 transition-all"
                placeholder={account ? 'Leave blank to keep current' : 'nyk_v0_...'}
                value={formData.clientSecret}
                onChange={(e) => setFormData({...formData, clientSecret: e.target.value})}
              />
              {account && (
                <p className="text-xs text-muted-foreground mt-1">Leave blank to keep existing Client Secret</p>
              )}
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-muted-foreground transition-colors"
              >
                {showSecret ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Region and Max Grants */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Region
              </label>
              <select
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                value={formData.region}
                onChange={(e) => setFormData({...formData, region: e.target.value})}
              >
                <option value="us">United States (US)</option>
                <option value="eu">Europe (EU)</option>
                <option value="au">Australia (AU)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Max Grants
              </label>
              <input
                type="number"
                min="1"
                max="100"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                value={formData.maxGrants}
                onChange={(e) => setFormData({...formData, maxGrants: parseInt(e.target.value) || 5})}
              />
              <p className="text-xs text-muted-foreground mt-1">Nylas free tier: 5, Paid: up to 100</p>
            </div>
          </div>

          {/* Account Type and Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Account Type
              </label>
              <select
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                value={formData.accountType}
                onChange={(e) => setFormData({...formData, accountType: e.target.value as any})}
              >
                <option value="sandbox">Sandbox (Free/Testing)</option>
                <option value="production">Production (Paid)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Priority
              </label>
              <input
                type="number"
                min="0"
                max="100"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                value={formData.priority}
                onChange={(e) => setFormData({...formData, priority: parseInt(e.target.value) || 0})}
              />
              <p className="text-xs text-muted-foreground mt-1">Higher = preferred (0-100)</p>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
              rows={3}
              placeholder="Internal notes about this account..."
              value={formData.notes}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
            />
          </div>

          {/* Test Result */}
          {testResult && (
            <div className={`p-4 rounded-lg border ${
              testResult.success 
                ? 'bg-green-50 border-green-200' 
                : 'bg-red-50 border-red-200'
            }`}>
              <div className="flex items-start">
                {testResult.success ? (
                  <Check className="w-5 h-5 text-green-600 mt-0.5 mr-2 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 mr-2 flex-shrink-0" />
                )}
                <div className="flex-1">
                  <p className={`text-sm font-medium ${
                    testResult.success ? 'text-green-800' : 'text-red-800'
                  }`}>
                    {testResult.message}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t bg-gray-50 sticky bottom-0">
          <Button
            variant="outline"
            onClick={handleTestBeforeSave}
            disabled={testing || !formData.clientId || (!account && !formData.apiKey)}
            className="border-blue-200 text-blue-600 hover:bg-blue-50"
          >
            <TestTube className="w-4 h-4 mr-2" />
            {testing ? 'Testing Connection...' : 'Test Connection'}
          </Button>
          
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="hover:bg-muted/50">
              Cancel
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {saving ? 'Saving...' : account ? 'Update Account' : 'Create Account'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
