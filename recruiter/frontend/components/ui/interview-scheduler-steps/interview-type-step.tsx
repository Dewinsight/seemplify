"use client";

import React from 'react';
import { Users, User, Badge } from 'lucide-react';
import { Button } from '../button';
import { Card, CardContent } from '../card';
import { cn } from '@/lib/utils';

interface InterviewTypeStepProps {
  interviewType: 'single' | 'multi';
  onTypeSelect: (type: 'single' | 'multi') => void;
  onNext: () => void;
}

export function InterviewTypeStep({ interviewType, onTypeSelect, onNext }: InterviewTypeStepProps) {
  const handleSelect = (type: 'single' | 'multi') => {
    onTypeSelect(type);
    onNext();
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h3 className="text-lg font-medium">Choose Interview Type</h3>
        <p className="text-sm text-muted-foreground">
          Select whether you want to schedule a single interview or multiple candidates in one session
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Single Interview Option */}
        <Card 
          className={cn(
            "cursor-pointer transition-all hover:shadow-lg",
            interviewType === 'single' && "ring-2 ring-primary"
          )}
          onClick={() => handleSelect('single')}
        >
          <CardContent className="p-6 text-center space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center">
              <User className="h-8 w-8 text-blue-600" />
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-lg">Single Interview</h4>
              <p className="text-sm text-muted-foreground">
                Schedule an interview with one candidate
              </p>
            </div>
            <ul className="text-sm text-left space-y-2 text-muted-foreground">
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                Individual focus time
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                Flexible scheduling
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                Dedicated interview slot
              </li>
            </ul>
            <Button className="w-full" variant={interviewType === 'single' ? 'default' : 'outline'}>
              Select Single Interview
            </Button>
          </CardContent>
        </Card>

        {/* Multi-Candidate Option */}
        <Card 
          className={cn(
            "cursor-pointer transition-all hover:shadow-lg relative",
            interviewType === 'multi' && "ring-2 ring-primary"
          )}
          onClick={() => handleSelect('multi')}
        >
          <CardContent className="p-6 text-center space-y-4">
            <Badge variant="secondary" className="absolute top-4 right-4 bg-orange-100 text-orange-600">
              BETA
            </Badge>
            <div className="mx-auto w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center">
              <Users className="h-8 w-8 text-orange-600" />
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold text-lg">Multi-Candidate</h4>
              <p className="text-sm text-muted-foreground">
                Interview multiple candidates in one session
              </p>
            </div>
            <ul className="text-sm text-left space-y-2 text-muted-foreground">
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                Efficient time usage
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                Compare candidates easily
              </li>
              <li className="flex items-start">
                <span className="text-green-500 mr-2">✓</span>
                Single meeting link
              </li>
            </ul>
            <Button className="w-full" variant={interviewType === 'multi' ? 'default' : 'outline'}>
              Select Multi-Candidate
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="text-center text-sm text-muted-foreground">
        <p>You can always go back and change your selection</p>
      </div>
    </div>
  );
}
