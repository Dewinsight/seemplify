'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Loader2, Mail, Shield, UserCheck, User, Eye } from 'lucide-react';

/**
 * Demo component showing the different error states and visual feedback 
 * implemented in the invite user modal
 */
export default function InviteModalDemo() {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Invite Modal Error Visuals - Demo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-8">
          
          {/* Error States */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Error States</h3>
            <div className="space-y-4">
              
              {/* General Error */}
              <div>
                <Badge variant="destructive" className="mb-2">General Error</Badge>
                <div className="flex items-center space-x-2 p-3 bg-red-50 border border-red-200 rounded-md">
                  <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                  <span className="text-sm text-red-700">You have reached your organization member limit</span>
                </div>
              </div>

              {/* Email Validation Error */}
              <div>
                <Badge variant="destructive" className="mb-2">Email Validation Error</Badge>
                <div className="flex items-center space-x-1">
                  <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
                  <span className="text-xs text-red-600">Please enter a valid email address</span>
                </div>
              </div>

              {/* Duplicate Member Error */}
              <div>
                <Badge variant="destructive" className="mb-2">Duplicate Member Error</Badge>
                <div className="flex items-center space-x-1">
                  <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
                  <span className="text-xs text-red-600">This user is already a member of your organization</span>
                </div>
              </div>
            </div>
          </div>

          {/* Success States */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Success States</h3>
            <div className="space-y-4">
              
              {/* Valid Email */}
              <div>
                <Badge variant="default" className="mb-2">Valid Email</Badge>
                <div className="flex items-center space-x-2">
                  <div className="relative flex-1">
                    <input 
                      className="w-full px-3 py-2 border border-green-300 rounded-md focus:border-green-500 focus:ring-green-500" 
                      value="colleague@company.com" 
                      readOnly 
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Loading States */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Loading States</h3>
            <div className="space-y-4">
              
              {/* Loading Button */}
              <div>
                <Badge variant="secondary" className="mb-2">Sending Invitation</Badge>
                <button 
                  className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md opacity-75 cursor-not-allowed min-w-[120px]"
                  disabled
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sending...</span>
                </button>
              </div>

              {/* Normal Button */}
              <div>
                <Badge variant="default" className="mb-2">Ready to Send</Badge>
                <button className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 min-w-[120px]">
                  <Mail className="w-4 h-4" />
                  <span>Send Invite</span>
                </button>
              </div>
            </div>
          </div>

          {/* Role Selection */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Enhanced Role Selection</h3>
            <div className="space-y-3">
              
              <div className="flex items-center space-x-3 p-3 border rounded-md">
                <Shield className="w-4 h-4 text-blue-600" />
                <div>
                  <div className="font-medium">Admin</div>
                  <div className="text-xs text-gray-500">Full access to manage users, jobs, and candidates</div>
                </div>
              </div>

              <div className="flex items-center space-x-3 p-3 border rounded-md">
                <UserCheck className="w-4 h-4 text-green-600" />
                <div>
                  <div className="font-medium">HR Manager</div>
                  <div className="text-xs text-gray-500">Can manage jobs, candidates, and view analytics</div>
                </div>
              </div>

              <div className="flex items-center space-x-3 p-3 border rounded-md bg-blue-50">
                <User className="w-4 h-4 text-purple-600" />
                <div>
                  <div className="font-medium">Recruiter</div>
                  <div className="text-xs text-gray-500">Can manage candidates and view jobs</div>
                </div>
              </div>

              <div className="flex items-center space-x-3 p-3 border rounded-md">
                <Eye className="w-4 h-4 text-orange-600" />
                <div>
                  <div className="font-medium">Interviewer</div>
                  <div className="text-xs text-gray-500">Can view candidates and jobs for interviews</div>
                </div>
              </div>
            </div>
          </div>

          {/* Error Scenarios */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Error Scenarios Handled</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              <div className="p-4 border rounded-md">
                <h4 className="font-medium text-red-600 mb-2">❌ Invalid Email Format</h4>
                <p className="text-sm text-gray-600">Real-time validation for email format</p>
              </div>

              <div className="p-4 border rounded-md">
                <h4 className="font-medium text-red-600 mb-2">❌ Self-Invitation</h4>
                <p className="text-sm text-gray-600">Prevents users from inviting themselves</p>
              </div>

              <div className="p-4 border rounded-md">
                <h4 className="font-medium text-red-600 mb-2">❌ Duplicate Member</h4>
                <p className="text-sm text-gray-600">Checks against existing members</p>
              </div>

              <div className="p-4 border rounded-md">
                <h4 className="font-medium text-red-600 mb-2">❌ Organization Limit</h4>
                <p className="text-sm text-gray-600">Respects plan-based member limits</p>
              </div>

              <div className="p-4 border rounded-md">
                <h4 className="font-medium text-red-600 mb-2">❌ Permission Denied</h4>
                <p className="text-sm text-gray-600">Role-based access control</p>
              </div>

              <div className="p-4 border rounded-md">
                <h4 className="font-medium text-red-600 mb-2">❌ Network Errors</h4>
                <p className="text-sm text-gray-600">Graceful handling of API failures</p>
              </div>
            </div>
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
