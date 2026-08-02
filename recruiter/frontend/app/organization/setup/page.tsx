'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getIdpBaseUrl } from '@/utils/env';
import { Building2, ExternalLink, LogOut, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

export default function OrganizationSetupPage() {
  const { currentOrganization, isLoading, organizations } = useOrganization();
  const { logout } = useAuth();
  const router = useRouter();
  const idpUrl = getIdpBaseUrl();
  const [redirecting, setRedirecting] = useState(false);
  
  // Redirect if user already has an organization
  useEffect(() => {
    if (!isLoading && currentOrganization) {
      console.log('✅ User already has organization, redirecting to dashboard');
      router.push('/dashboard');
    }
  }, [currentOrganization, isLoading, router]);
  
  const handleRedirectToIdP = () => {
    setRedirecting(true);
    const idpOrgUrl = `${idpUrl.replace(/\/$/, '')}/organizations`;
    console.log('🔗 Redirecting to IdP organizations page:', idpOrgUrl);
    window.location.href = idpOrgUrl;
  };
  
  const handleLogout = () => {
    console.log('🔐 User requested logout from organization setup');
    logout();
  };

  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-300">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden flex items-center justify-center p-4">
      {/* Animated Background */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-1000"></div>

      <div className="relative z-10 w-full max-w-lg">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card className="bg-white/10 backdrop-blur-2xl border-white/20 shadow-2xl">
            <CardHeader className="text-center pb-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring" }}
                className="mx-auto w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mb-6 shadow-xl"
              >
                <Building2 className="w-10 h-10 text-white" />
              </motion.div>
              <CardTitle className="text-3xl text-white mb-3">
                Organization Required
              </CardTitle>
              <CardDescription className="text-slate-300 text-base">
                You need to be part of an organization to use SmartHR
              </CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-6 px-6 pb-8">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6"
              >
                <h3 className="text-white font-semibold text-lg mb-3 flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-blue-400" />
                  Manage Organizations via Identity Provider
                </h3>
                <p className="text-slate-300 text-sm mb-4 leading-relaxed">
                  Organizations are managed through the AIIN Identity Provider for enhanced security 
                  and centralized management. You can create a new organization or accept invitations 
                  to join existing ones.
                </p>
                
                <Button
                  onClick={handleRedirectToIdP}
                  disabled={redirecting}
                  className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold h-12 rounded-xl shadow-lg"
                  size="lg"
                >
                  {redirecting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                      Redirecting...
                    </>
                  ) : (
                    <>
                      <ExternalLink className="w-5 h-5 mr-2" />
                      Go to Identity Provider
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </>
                  )}
                </Button>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-center space-y-3"
              >
                <p className="text-slate-400 text-sm">
                  After creating or joining an organization in the Identity Provider, 
                  return here and refresh to continue.
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="pt-4 border-t border-white/10"
              >
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleLogout}
                  className="w-full border-white/20 text-white hover:bg-white/10"
                  size="lg"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Logout Instead
                </Button>
              </motion.div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
