"use client";

import React, { useState, useEffect } from 'react';
import { UserPlus, Mail, Trash2, ChevronLeft, ChevronRight, Eye, EyeOff, Users, Loader2 } from 'lucide-react';
import { Button } from '../button';
import { Input } from '../input';
import { Label } from '../label';
import { Badge } from '../badge';
import { Avatar, AvatarFallback, AvatarImage } from '../avatar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../tabs';
import { InterviewSchedulerData } from '../multi-step-interview-scheduler';
import organizationService from '@/services/organizationService';
import { toast } from 'sonner';
import { useUser } from '@/context/UserContext';

interface ParticipantsStepProps {
  data: InterviewSchedulerData;
  updateData: (updates: Partial<InterviewSchedulerData>) => void;
  onNext: () => void;
  onPrevious: () => void;
}

interface OrganizationMember {
  _id: string;
  user: {
    _id: string;
    email: string;
    profile?: {
      firstName?: string;
      lastName?: string;
    };
  };
  role: string;
  status: string;
}

export function ParticipantsStep({ data, updateData, onNext, onPrevious }: ParticipantsStepProps) {
  const { state } = useUser();
  const [organizationMembers, setOrganizationMembers] = useState<OrganizationMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [participantType, setParticipantType] = useState<'additional' | 'cc' | 'bcc'>('additional');
  
  // Form state for adding participants
  const [newParticipantEmail, setNewParticipantEmail] = useState('');
  const [newParticipantName, setNewParticipantName] = useState('');
  const [newParticipantRole, setNewParticipantRole] = useState<'interviewer' | 'observer'>('observer');
  const [selectedMemberId, setSelectedMemberId] = useState('');

  // Local state for participants
  const [additionalParticipants, setAdditionalParticipants] = useState(data.additionalParticipants || []);
  const [ccParticipants, setCcParticipants] = useState(data.ccParticipants || []);
  const [bccParticipants, setBccParticipants] = useState(data.bccParticipants || []);

  useEffect(() => {
    loadOrganizationMembers();
  }, []);

  const loadOrganizationMembers = async () => {
    if (!state.user?.currentOrganization) return;

    setLoadingMembers(true);
    try {
      const result = await organizationService.getOrganizationMembers();
      const members = result.members;
      // Filter out the current user and only show active members
      const filteredMembers = members.filter((member: OrganizationMember) => 
        member.user._id !== state.user?._id && member.status === 'active'
      );
      setOrganizationMembers(filteredMembers);
    } catch (error) {
      console.error('Error loading organization members:', error);
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleAddFromOrganization = () => {
    const member = organizationMembers.find(m => m._id === selectedMemberId);
    if (!member) {
      toast.error('Please select a team member');
      return;
    }

    const participantData = {
      id: member.user._id,
      email: member.user.email,
      name: member.user.profile?.firstName && member.user.profile?.lastName
        ? `${member.user.profile.firstName} ${member.user.profile.lastName}`
        : member.user.email,
      role: newParticipantRole
    };

    // Check if already added
    const allParticipants = [...additionalParticipants, ...ccParticipants, ...bccParticipants];
    if (allParticipants.some(p => p.email === participantData.email)) {
      toast.error('This participant has already been added');
      return;
    }

    addParticipant(participantData);
    resetForm();
    setShowAddDialog(false);
  };

  const handleAddExternal = () => {
    if (!newParticipantEmail || !newParticipantName) {
      toast.error('Please enter both email and name');
      return;
    }

    const participantData = {
      id: `external-${Date.now()}`,
      email: newParticipantEmail,
      name: newParticipantName,
      role: newParticipantRole
    };

    // Check if already added
    const allParticipants = [...additionalParticipants, ...ccParticipants, ...bccParticipants];
    if (allParticipants.some(p => p.email === participantData.email)) {
      toast.error('This participant has already been added');
      return;
    }

    addParticipant(participantData);
    resetForm();
    setShowAddDialog(false);
  };

  const addParticipant = (participant: any) => {
    switch (participantType) {
      case 'additional':
        setAdditionalParticipants([...additionalParticipants, participant]);
        break;
      case 'cc':
        setCcParticipants([...ccParticipants, participant]);
        break;
      case 'bcc':
        setBccParticipants([...bccParticipants, participant]);
        break;
    }
  };

  const removeParticipant = (email: string, type: 'additional' | 'cc' | 'bcc') => {
    switch (type) {
      case 'additional':
        setAdditionalParticipants(additionalParticipants.filter(p => p.email !== email));
        break;
      case 'cc':
        setCcParticipants(ccParticipants.filter(p => p.email !== email));
        break;
      case 'bcc':
        setBccParticipants(bccParticipants.filter(p => p.email !== email));
        break;
    }
  };

  const resetForm = () => {
    setNewParticipantEmail('');
    setNewParticipantName('');
    setNewParticipantRole('observer');
    setSelectedMemberId('');
  };

  const handleContinue = () => {
    // Update the main data
    updateData({
      additionalParticipants,
      ccParticipants,
      bccParticipants
    });
    onNext();
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const ParticipantList = ({ 
    participants, 
    type, 
    title, 
    description 
  }: { 
    participants: any[]; 
    type: 'additional' | 'cc' | 'bcc';
    title: string;
    description: string;
  }) => (
    <div className="space-y-3">
      <div className="flex justify-between items-start">
        <div>
          <h4 className="font-medium">{title}</h4>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setParticipantType(type);
            setShowAddDialog(true);
          }}
        >
          <UserPlus className="h-4 w-4 mr-2" />
          Add
        </Button>
      </div>

      {participants.length > 0 ? (
        <div className="space-y-2">
          {participants.map((participant) => (
            <div
              key={participant.email}
              className="flex items-center justify-between p-3 rounded-lg border bg-card"
            >
              <div className="flex items-center space-x-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{getInitials(participant.name)}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">{participant.name}</p>
                  <p className="text-xs text-muted-foreground">{participant.email}</p>
                </div>
                {participant.role && (
                  <Badge variant="secondary" className="text-xs">
                    {participant.role}
                  </Badge>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeParticipant(participant.email, type)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6 text-sm text-muted-foreground border rounded-lg">
          No {type === 'additional' ? 'additional participants' : type.toUpperCase() + ' recipients'} added
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Interview Participants</h3>
        <p className="text-sm text-muted-foreground">
          Add additional interviewers or observers to this interview
        </p>
      </div>

      {/* Primary Participants */}
      <div className="p-4 rounded-lg border bg-muted/30">
        <h4 className="text-sm font-medium mb-3">Primary Participants</h4>
        <div className="space-y-2">
          <div className="flex items-center space-x-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{getInitials(data.candidateName)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium">{data.candidateName}</p>
              {data.candidateEmail && (
                <p className="text-xs text-muted-foreground">{data.candidateEmail}</p>
              )}
            </div>
            <Badge>Candidate</Badge>
          </div>
          
          <div className="flex items-center space-x-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback>
                {state.user?.profile?.firstName && state.user?.profile?.lastName
                  ? getInitials(`${state.user.profile.firstName} ${state.user.profile.lastName}`)
                  : 'ME'}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium">
                {state.user?.profile?.firstName && state.user?.profile?.lastName
                  ? `${state.user.profile.firstName} ${state.user.profile.lastName}`
                  : state.user?.email}
              </p>
              <p className="text-xs text-muted-foreground">{state.user?.email}</p>
            </div>
            <Badge variant="secondary">Interviewer</Badge>
          </div>
        </div>
      </div>

      {/* Additional Participants */}
      <ParticipantList
        participants={additionalParticipants}
        type="additional"
        title="Additional Participants"
        description="Will receive calendar invites and can join the interview"
      />

      {/* CC Recipients */}
      <ParticipantList
        participants={ccParticipants}
        type="cc"
        title="CC Recipients"
        description="Will receive email notifications and calendar invites (visible to all)"
      />

      {/* BCC Recipients */}
      <ParticipantList
        participants={bccParticipants}
        type="bcc"
        title="BCC Recipients"
        description="Will receive email notifications and calendar invites (hidden from others)"
      />

      {/* Add Participant Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="scheduler-dialog">
          <DialogHeader>
            <DialogTitle>
              Add {participantType === 'additional' ? 'Participant' : participantType.toUpperCase() + ' Recipient'}
            </DialogTitle>
            <DialogDescription>
              Add team members or external participants to this interview
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="team" className="mt-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="team">Team Members</TabsTrigger>
              <TabsTrigger value="external">External</TabsTrigger>
            </TabsList>

            <TabsContent value="team" className="space-y-4">
              {loadingMembers ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : organizationMembers.length > 0 ? (
                <>
                  <div className="space-y-2">
                    <Label>Select Team Member</Label>
                    <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a team member" />
                      </SelectTrigger>
                      <SelectContent>
                        {organizationMembers.map((member) => (
                          <SelectItem key={member._id} value={member._id}>
                            <div className="flex items-center space-x-2">
                              <Avatar className="h-6 w-6">
                                <AvatarFallback>
                                  {member.user.profile?.firstName && member.user.profile?.lastName
                                    ? getInitials(`${member.user.profile.firstName} ${member.user.profile.lastName}`)
                                    : getInitials(member.user.email)}
                                </AvatarFallback>
                              </Avatar>
                              <span>
                                {member.user.profile?.firstName && member.user.profile?.lastName
                                  ? `${member.user.profile.firstName} ${member.user.profile.lastName}`
                                  : member.user.email}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {participantType === 'additional' && (
                    <div className="space-y-2">
                      <Label>Role</Label>
                      <Select value={newParticipantRole} onValueChange={(value: any) => setNewParticipantRole(value)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="interviewer">Interviewer</SelectItem>
                          <SelectItem value="observer">Observer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <Button onClick={handleAddFromOrganization} className="w-full">
                    Add Team Member
                  </Button>
                </>
              ) : (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No team members available
                </div>
              )}
            </TabsContent>

            <TabsContent value="external" className="space-y-4">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="participant@example.com"
                  value={newParticipantEmail}
                  onChange={(e) => setNewParticipantEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  type="text"
                  placeholder="John Doe"
                  value={newParticipantName}
                  onChange={(e) => setNewParticipantName(e.target.value)}
                />
              </div>

              {participantType === 'additional' && (
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={newParticipantRole} onValueChange={(value: any) => setNewParticipantRole(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="interviewer">Interviewer</SelectItem>
                      <SelectItem value="observer">Observer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Button onClick={handleAddExternal} className="w-full">
                Add External Participant
              </Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Navigation */}
      <div className="flex justify-between pt-6">
        <Button variant="outline" onClick={onPrevious}>
          <ChevronLeft className="h-4 w-4 mr-2" />
          Previous
        </Button>
        
        <Button onClick={handleContinue}>
          Continue
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
