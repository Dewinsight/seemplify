'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { apiRequest } from '@/services/apiConfig';

const OrganizationDiagnostics: React.FC = () => {
  const auth = useAuth();
  const org = useOrganization();
  const [apiTest, setApiTest] = useState<any>(null);
  const [testing, setTesting] = useState(false);

  // Test direct API call
  const testApi = async () => {
    setTesting(true);
    try {
      const token = localStorage.getItem('jwt');
      console.log('🧪 Testing API with token:', token ? 'Token exists' : 'No token');
      
      const response = await apiRequest('/api/organizations/user', {
        method: 'GET'
      });
      
      const data = await response.json();
      setApiTest({
        status: response.status,
        ok: response.ok,
        data: data
      });
      console.log('🧪 API Test Result:', { status: response.status, data });
    } catch (error) {
      setApiTest({ error: error.message });
      console.error('🧪 API Test Error:', error);
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    console.log('🩺 OrganizationDiagnostics mounted');
    console.log('🩺 Auth state:', auth);
    console.log('🩺 Org state:', org);
  }, []);

  return (
    <Card className="w-full max-w-4xl mx-auto mt-4 border-2 border-red-500">
      <CardHeader className="bg-red-50">
        <CardTitle className="text-red-700 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          Organization System Diagnostics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-6">
        {/* Auth Status */}
        <div className="space-y-2">
          <h3 className="font-semibold text-lg">Authentication Status</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>Is Authenticated:</div>
            <div>
              <Badge variant={auth?.isAuthenticated ? "default" : "destructive"}>
                {auth?.isAuthenticated ? "Yes" : "No"}
              </Badge>
            </div>
            
            <div>Auth Loading:</div>
            <div>
              <Badge variant={auth?.isLoading ? "secondary" : "default"}>
                {auth?.isLoading ? "Loading..." : "Ready"}
              </Badge>
            </div>
            
            <div>User Email:</div>
            <div className="font-mono">{auth?.user?.email || "No user"}</div>
            
            <div>JWT Token:</div>
            <div>
              <Badge variant={localStorage.getItem('jwt') ? "default" : "destructive"}>
                {localStorage.getItem('jwt') ? "Present" : "Missing"}
              </Badge>
            </div>
          </div>
        </div>

        <hr />

        {/* Organization Status */}
        <div className="space-y-2">
          <h3 className="font-semibold text-lg">Organization Status</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>Is Loading:</div>
            <div>
              <Badge variant={org?.isLoading ? "secondary" : "default"}>
                {org?.isLoading ? "Loading..." : "Ready"}
              </Badge>
            </div>
            
            <div>Needs Setup:</div>
            <div>
              <Badge variant={org?.needsOrganizationSetup ? "destructive" : "default"}>
                {org?.needsOrganizationSetup ? "Yes" : "No"}
              </Badge>
            </div>
            
            <div>Current Organization:</div>
            <div className="font-mono">{org?.currentOrganization?.name || "None"}</div>
            
            <div>Organizations Count:</div>
            <div>{org?.organizations?.length || 0}</div>
            
            <div>Error:</div>
            <div className="text-red-600">{org?.error || "None"}</div>
          </div>
        </div>

        <hr />

        {/* API Test */}
        <div className="space-y-2">
          <h3 className="font-semibold text-lg">Direct API Test</h3>
          <Button 
            onClick={testApi} 
            disabled={testing}
            variant="outline"
            className="flex items-center gap-2"
          >
            {testing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Test Organization API
              </>
            )}
          </Button>
          
          {apiTest && (
            <pre className="bg-gray-100 p-3 rounded text-xs overflow-auto">
              {JSON.stringify(apiTest, null, 2)}
            </pre>
          )}
        </div>

        <hr />

        {/* Actions */}
        <div className="space-y-2">
          <h3 className="font-semibold text-lg">Debug Actions</h3>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={() => {
                console.log('🔄 Manually triggering loadOrganizations');
                org?.loadOrganizations();
              }}
              variant="outline"
              size="sm"
            >
              Force Load Organizations
            </Button>
            
            <Button
              onClick={() => {
                console.log('🏢 Opening setup modal');
                window.dispatchEvent(new CustomEvent('openOrganizationSetup'));
              }}
              variant="outline"
              size="sm"
            >
              Open Setup Modal
            </Button>
            
            <Button
              onClick={() => {
                console.log('🧹 Clearing localStorage');
                localStorage.removeItem('jwt');
                window.location.reload();
              }}
              variant="destructive"
              size="sm"
            >
              Clear Auth & Reload
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default OrganizationDiagnostics; 