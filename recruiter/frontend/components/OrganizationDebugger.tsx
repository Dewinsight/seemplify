'use client';

import React, { useState } from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import OrganizationSetupModal from '@/components/OrganizationSetupModal';

export default function OrganizationDebugger() {
  const { 
    currentOrganization, 
    organizations, 
    isLoading, 
    error, 
    needsOrganizationSetup,
    loadOrganizations 
  } = useOrganization();
  
  const [forceModalOpen, setForceModalOpen] = useState(false);

  return (
    <Card className="w-full max-w-2xl mx-auto mt-4">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <AlertCircle className="w-5 h-5" />
          <span>Organization Debug Info</span>
        </CardTitle>
        <CardDescription>
          Current organization state and debugging information
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* State Overview */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm font-medium text-gray-700">Loading</div>
            <Badge variant={isLoading ? "default" : "secondary"}>
              {isLoading ? "Loading..." : "Complete"}
            </Badge>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-700">Needs Setup</div>
            <Badge variant={needsOrganizationSetup ? "destructive" : "default"}>
              {needsOrganizationSetup ? "YES - Setup Required" : "NO - Setup Complete"}
            </Badge>
          </div>
        </div>

        {/* Organizations */}
        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">Organizations ({organizations.length})</div>
          {organizations.length === 0 ? (
            <div className="text-sm text-gray-500 italic">No organizations found</div>
          ) : (
            <div className="space-y-2">
              {organizations.map((org) => (
                <div key={org._id} className="flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-sm">{org.name}</span>
                  <Badge variant="outline">{org.userRole}</Badge>
                  {org._id === currentOrganization?._id && (
                    <Badge variant="default">Current</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Current Organization */}
        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">Current Organization</div>
          {currentOrganization ? (
            <div className="text-sm bg-green-50 p-2 rounded border">
              <strong>{currentOrganization.name}</strong> ({currentOrganization.userRole})
            </div>
          ) : (
            <div className="text-sm bg-red-50 p-2 rounded border text-red-700">
              No current organization set
            </div>
          )}
        </div>

        {/* Error State */}
        {error && (
          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">Error</div>
            <div className="text-sm bg-red-50 p-2 rounded border text-red-700">
              {error}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-4 border-t">
          <Button 
            onClick={() => {
              console.log('🔄 Manual refresh triggered');
              loadOrganizations();
            }}
            disabled={isLoading}
            size="sm"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh Organizations
          </Button>
          
          <Button 
            onClick={() => {
              console.log('📊 Current state dump:', {
                currentOrganization,
                organizations,
                isLoading,
                error,
                needsOrganizationSetup
              });
            }}
            variant="outline"
            size="sm"
          >
            Log State to Console
          </Button>
          
          <Button 
            onClick={() => {
              window.location.href = '/organization/setup';
            }}
            variant="secondary"
            size="sm"
          >
            Go to Setup Page
          </Button>
          
          <Button 
            onClick={() => {
              console.log('🚀 Force opening organization setup modal');
              setForceModalOpen(true);
            }}
            variant="destructive"
            size="sm"
          >
            Force Open Modal
          </Button>
        </div>

        {/* Modal State Explanation */}
        <div className="bg-blue-50 p-4 rounded border">
          <div className="text-sm font-medium text-blue-900 mb-2">Modal Logic</div>
          <div className="text-sm text-blue-700 space-y-1">
            <div>• Modal shows when: <code>needsOrganizationSetup === true</code></div>
            <div>• Currently: <code>needsOrganizationSetup === {needsOrganizationSetup.toString()}</code></div>
            <div>• Expected behavior: {organizations.length === 0 ? "Should show modal" : "Should NOT show modal"}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
} 