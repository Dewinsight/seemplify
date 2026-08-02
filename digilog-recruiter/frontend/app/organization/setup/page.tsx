'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import organizationService, { type UserPendingInvitation } from '@/services/organizationService';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, LogOut, ArrowRight, Mail, Check, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from '@/hooks/use-toast';

export default function OrganizationSetupPage() {
  const { currentOrganization, isLoading, createOrganization } = useOrganization();
  const { logout } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [size, setSize] = useState('');
  const [website, setWebsite] = useState('');
  const [creating, setCreating] = useState(false);

  const [invites, setInvites] = useState<UserPendingInvitation[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [acceptingToken, setAcceptingToken] = useState<string | null>(null);

  // Already has an organization → straight to the dashboard
  useEffect(() => {
    if (!isLoading && currentOrganization) {
      router.push('/dashboard');
    }
  }, [currentOrganization, isLoading, router]);

  // Load any pending invitations the user has received
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await organizationService.getUserPendingInvitations();
        if (active) {
          const list = res.pendingInvites || [];
          setInvites(list);
          if (list.length > 0) setTab('join');
        }
      } catch {
        /* no invites is fine */
      } finally {
        if (active) setLoadingInvites(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({ title: 'Organization name is required', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      await createOrganization({
        name: name.trim(),
        industry: industry.trim() || undefined,
        size: size.trim() || undefined,
        website: website.trim() || undefined,
      } as any);
      toast({ title: 'Organization created', description: `Welcome to ${name.trim()}!` });
      router.push('/dashboard');
    } catch (err: any) {
      toast({
        title: 'Could not create organization',
        description: err?.message || 'Please try again.',
        variant: 'destructive',
      });
      setCreating(false);
    }
  };

  const handleAccept = async (token: string) => {
    setAcceptingToken(token);
    try {
      await organizationService.acceptInvite(token);
      toast({ title: 'Joined organization' });
      window.location.href = '/dashboard';
    } catch (err: any) {
      toast({
        title: 'Could not join organization',
        description: err?.message || 'Please try again.',
        variant: 'destructive',
      });
      setAcceptingToken(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1E0059] via-[#3a1f8f] to-[#1E0059]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-200">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1E0059] via-[#3a1f8f] to-[#1E0059] relative overflow-hidden flex items-center justify-center p-4">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#754BE5]/30 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#6935CF]/30 rounded-full blur-3xl animate-pulse delay-1000" />

      <div className="relative z-10 w-full max-w-lg">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <Card className="bg-white/95 backdrop-blur-2xl border-white/20 shadow-2xl">
            <CardHeader className="text-center pb-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.15, type: 'spring' }}
                className="mx-auto w-16 h-16 bg-gradient-to-br from-[#754BE5] to-[#6935CF] rounded-2xl flex items-center justify-center mb-4 shadow-xl"
              >
                <Building2 className="w-8 h-8 text-white" />
              </motion.div>
              <CardTitle className="text-2xl text-slate-900 mb-1">Set up your organization</CardTitle>
              <CardDescription className="text-slate-500 text-base">
                Create a new organization or join one you've been invited to.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6 px-6 pb-8">
              {/* Tabs */}
              <div className="grid grid-cols-2 gap-2 p-1 rounded-full bg-[#F1ECFF]">
                <button
                  type="button"
                  onClick={() => setTab('create')}
                  className={`h-9 rounded-full text-sm font-medium transition-colors ${
                    tab === 'create' ? 'bg-white text-[#1E0059] shadow' : 'text-[#6935CF] hover:text-[#1E0059]'
                  }`}
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setTab('join')}
                  className={`h-9 rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
                    tab === 'join' ? 'bg-white text-[#1E0059] shadow' : 'text-[#6935CF] hover:text-[#1E0059]'
                  }`}
                >
                  Join
                  {invites.length > 0 && (
                    <span className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-[#754BE5] text-white text-xs">
                      {invites.length}
                    </span>
                  )}
                </button>
              </div>

              {tab === 'create' ? (
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="org-name" className="text-slate-700">Organization name *</Label>
                    <Input
                      id="org-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Acme Inc."
                      className="bg-[#F7F5FF] border-[#E2DAFB]"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="org-industry" className="text-slate-700">Industry</Label>
                      <Input
                        id="org-industry"
                        value={industry}
                        onChange={(e) => setIndustry(e.target.value)}
                        placeholder="Technology"
                        className="bg-[#F7F5FF] border-[#E2DAFB]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="org-size" className="text-slate-700">Company size</Label>
                      <Input
                        id="org-size"
                        value={size}
                        onChange={(e) => setSize(e.target.value)}
                        placeholder="1-10"
                        className="bg-[#F7F5FF] border-[#E2DAFB]"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="org-website" className="text-slate-700">Website</Label>
                    <Input
                      id="org-website"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://acme.com"
                      className="bg-[#F7F5FF] border-[#E2DAFB]"
                    />
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    disabled={creating}
                    className="w-full h-12 bg-gradient-to-r from-[#754BE5] to-[#6935CF] hover:from-[#6935CF] hover:to-[#5a2bb8] text-white font-semibold shadow-lg"
                  >
                    {creating ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Creating...
                      </>
                    ) : (
                      <>
                        Create organization <ArrowRight className="w-5 h-5 ml-2" />
                      </>
                    )}
                  </Button>
                </form>
              ) : (
                <div className="space-y-3">
                  {loadingInvites ? (
                    <div className="flex items-center justify-center py-8 text-slate-500">
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Checking invitations...
                    </div>
                  ) : invites.length === 0 ? (
                    <div className="text-center py-8">
                      <Mail className="w-10 h-10 mx-auto text-[#A284F1] mb-3" />
                      <p className="text-slate-600 font-medium">No pending invitations</p>
                      <p className="text-slate-400 text-sm mt-1">
                        Ask an organization owner to invite{' '}
                        <span className="text-[#6935CF]">your email</span>, or create your own.
                      </p>
                    </div>
                  ) : (
                    invites.map((inv) => (
                      <div
                        key={inv._id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[#E2DAFB] bg-[#F7F5FF] p-4"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 truncate">{inv.organization?.name}</p>
                          <p className="text-xs text-slate-500">
                            Invited as {inv.role}
                            {inv.invitedBy?.profile?.firstName ? ` by ${inv.invitedBy.profile.firstName}` : ''}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          disabled={acceptingToken === inv.token}
                          onClick={() => handleAccept(inv.token)}
                          className="bg-gradient-to-r from-[#754BE5] to-[#6935CF] text-white shrink-0"
                        >
                          {acceptingToken === inv.token ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <Check className="w-4 h-4 mr-1" /> Join
                            </>
                          )}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}

              <div className="pt-4 border-t border-slate-200">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => logout()}
                  className="w-full text-slate-500 hover:text-slate-800"
                >
                  <LogOut className="mr-2 h-4 w-4" /> Log out
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
