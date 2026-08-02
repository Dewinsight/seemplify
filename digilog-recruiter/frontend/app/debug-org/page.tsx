"use client";

import { useOrganization } from '@/context/OrganizationContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshCw } from 'lucide-react';

export default function DebugOrgPage() {
  const { currentOrganization, organizations, forceRefresh, isLoading } = useOrganization();

  return (
    <div className="container mx-auto py-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Organization Debug</h1>
        <Button onClick={forceRefresh} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Force Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Organization</CardTitle>
          <CardDescription>Real-time organization data from context</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
            {JSON.stringify(currentOrganization, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Organizations</CardTitle>
          <CardDescription>All organizations from context</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
            {JSON.stringify(organizations, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subscription Details</CardTitle>
          <CardDescription>Current organization subscription info</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p><strong>Plan:</strong> {currentOrganization?.subscription?.plan || 'undefined'}</p>
            <p><strong>Member Limit:</strong> {currentOrganization?.subscription?.memberLimit || 'undefined'}</p>
            <p><strong>Job Limit:</strong> {currentOrganization?.subscription?.jobLimit || 'undefined'}</p>
            <p><strong>Candidate Limit:</strong> {currentOrganization?.subscription?.candidateLimit || 'undefined'}</p>
        
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
