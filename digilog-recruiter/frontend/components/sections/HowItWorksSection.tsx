'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import ScrollReveal from '@/components/animations/ScrollReveal';
import ProcessStep from '@/components/process/ProcessStep';
import FlowConnector from '@/components/process/FlowConnector';
import { 
  FileCheck, 
  Users, 
  GraduationCap, 
  HeartHandshake 
} from 'lucide-react';
import { useBrandConfig } from '@/context/BrandContext';

const steps = [
  {
    icon: FileCheck,
    title: "Post & Match",
    description: "Create job postings and let our AI find the best matching candidates",
    details: "Our intelligent matching algorithm analyzes thousands of candidates in seconds, scoring them based on skills, experience, and culture fit. Get ranked results with detailed match breakdowns.",
    color: "from-blue-500 to-cyan-400",
    iconColor: "text-blue-400"
  },
  {
    icon: Users,
    title: "Screen & Schedule",
    description: "Easily screen candidates and schedule interviews with one click",
    details: "Automated screening questions filter candidates efficiently. Our smart scheduler syncs with your calendar and finds optimal times for all participants, sending automatic reminders.",
    color: "from-green-500 to-emerald-400",
    iconColor: "text-green-400"
  },
  {
    icon: GraduationCap,
    title: "Interview & Evaluate",
    description: "Conduct structured interviews with AI assistance for evaluation",
    details: "AI-powered interview guides, real-time note-taking, and automated transcription. Collect standardized feedback from all interviewers for consistent evaluation.",
    color: "from-purple-500 to-pink-400",
    iconColor: "text-purple-400"
  },
  {
    icon: HeartHandshake,
    title: "Hire",
    description: "Streamlined hiring experience",
    details: "One-click offer letters and e-signature integration.",
    color: "from-amber-500 to-orange-400",
    iconColor: "text-amber-400"
  }
];

export default function HowItWorksSection() {
  const brand = useBrandConfig();
  return (
    <section id="how-it-works" className="relative z-10 container mx-auto px-4 py-24 md:py-32">
      {/* Background decorations */}
      <div className="absolute top-1/2 left-1/4 w-[600px] h-[600px] bg-green-500/5 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>
      
      <ScrollReveal>
        <div className="text-center mb-20">
          <motion.span 
            className="inline-flex items-center px-4 py-2 rounded-full bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 text-green-300 text-sm font-semibold mb-6"
            whileHover={{ scale: 1.05 }}
          >
            <Zap className="w-4 h-4 mr-2" />
            Simple & Powerful
          </motion.span>
          <h2 className={`text-4xl md:text-5xl lg:text-6xl font-black mb-6 bg-clip-text text-transparent ${brand.id === 'jetstone' ? 'bg-gradient-to-r from-teal-900 via-cyan-800 to-teal-900' : 'bg-gradient-to-r from-white via-green-100 to-emerald-100'}`}>
            How {brand.name} Works
          </h2>
          <p className="text-slate-300 text-xl max-w-3xl mx-auto leading-relaxed">
            Our integrated platform simplifies every aspect of your HR workflow with intelligent automation
          </p>
        </div>
      </ScrollReveal>

      {/* Desktop: Horizontal flow */}
      <div className="hidden lg:block">
        <div className="relative max-w-7xl mx-auto">
          {/* Connecting line */}
          <div className="absolute top-20 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500/20 via-green-500/20 via-purple-500/20 to-amber-500/20"></div>
          
          <div className="grid grid-cols-4 gap-8">
            {steps.map((step, index) => (
              <React.Fragment key={index}>
                <ProcessStep 
                  step={step} 
                  index={index} 
                  layout="horizontal"
                />
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile & Tablet: Vertical timeline */}
      <div className="lg:hidden max-w-2xl mx-auto">
        <div className="relative">
          {/* Vertical connecting line */}
          <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-500/20 via-green-500/20 via-purple-500/20 to-amber-500/20"></div>
          
          <div className="space-y-12">
            {steps.map((step, index) => (
              <React.Fragment key={index}>
                <ProcessStep 
                  step={step} 
                  index={index} 
                  layout="vertical"
                />
                {index < steps.length - 1 && <FlowConnector layout="vertical" />}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
