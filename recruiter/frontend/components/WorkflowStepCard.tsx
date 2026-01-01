'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import Image from 'next/image';
import { 
  BrainCircuit, Files, Globe, Search, 
  ListChecks, Syringe, PanelLeft, CalendarCheck, 
  Users, ArrowUpRight, FileText, HelpCircle, 
  BarChart, ClipboardCheck, FileStack, AreaChart, 
  ArrowDownToLine, Chrome, MessageSquare, Video
} from 'lucide-react';

interface WorkflowStep {
  id: number;
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  features: {
    text: string;
    icon: string;
  }[];
  image: string;
}

interface WorkflowStepCardProps {
  step: WorkflowStep;
  alignment: 'left' | 'right';
  index: number;
}

export default function WorkflowStepCard({ step, alignment, index }: WorkflowStepCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px 0px" });

  // Get the appropriate color class based on the step's color property
  const getColorClass = (color: string, type: 'bg' | 'text' | 'border') => {
    const opacity = type === 'bg' ? '10' : type === 'border' ? '30' : '';
    switch (color) {
      case 'blue': return `${type}-blue-500${opacity ? '/' + opacity : ''}`;
      case 'purple': return `${type}-purple-500${opacity ? '/' + opacity : ''}`;
      case 'indigo': return `${type}-indigo-500${opacity ? '/' + opacity : ''}`;
      case 'cyan': return `${type}-cyan-500${opacity ? '/' + opacity : ''}`;
      case 'emerald': return `${type}-emerald-500${opacity ? '/' + opacity : ''}`;
      case 'amber': return `${type}-amber-500${opacity ? '/' + opacity : ''}`;
      case 'green': return `${type}-green-500${opacity ? '/' + opacity : ''}`;
      default: return `${type}-blue-500${opacity ? '/' + opacity : ''}`;
    }
  };

  // Select the appropriate icon component based on the feature icon string
  const getFeatureIcon = (iconName: string) => {
    switch (iconName) {
      case 'brain': return <BrainCircuit className="w-4 h-4" />;
      case 'files': return <Files className="w-4 h-4" />;
      case 'portal': return <Globe className="w-4 h-4" />;
      case 'search': return <Search className="w-4 h-4" />;
      case 'skills': return <ListChecks className="w-4 h-4" />;
      case 'rank': return <BarChart className="w-4 h-4" />;
      case 'pipeline': return <PanelLeft className="w-4 h-4" />;
      case 'shortlist': return <ClipboardCheck className="w-4 h-4" />;
      case 'automation': return <ArrowUpRight className="w-4 h-4" />;
      case 'calendar': return <CalendarCheck className="w-4 h-4" />;
      case 'meet': return <Video className="w-4 h-4" />;
      case 'auto': return <Syringe className="w-4 h-4" />;
      case 'notes': return <FileText className="w-4 h-4" />;
      case 'questions': return <HelpCircle className="w-4 h-4" />;
      case 'analysis': return <BarChart className="w-4 h-4" />;
      case 'form': return <FileStack className="w-4 h-4" />;
      case 'distribute': return <Users className="w-4 h-4" />;
      case 'aggregate': return <AreaChart className="w-4 h-4" />;
      case 'dashboard': return <BarChart className="w-4 h-4" />;
      case 'compare': return <Users className="w-4 h-4" />;
      case 'onboard': return <ArrowDownToLine className="w-4 h-4" />;
      default: return <div className="w-4 h-4" />;
    }
  };

  const cardVariants = {
    hidden: { 
      opacity: 0, 
      x: alignment === 'left' ? -30 : 30 
    },
    visible: { 
      opacity: 1, 
      x: 0,
      transition: { 
        duration: 0.5,
        delay: 0.1 * index
      }
    }
  };

  return (
    <motion.div
      ref={ref}
      className={`bg-white/5 backdrop-blur-sm rounded-xl border ${getColorClass('border', 'border')} overflow-hidden`}
      variants={cardVariants}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
    >
      <div className={`p-4 sm:p-6 pb-6 sm:pb-8`}>
        {/* Step number */}
        <div className="flex items-center mb-3 sm:mb-4">
          <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full ${getColorClass('bg', 'bg')} flex items-center justify-center mr-2 sm:mr-3`}>
            <span className={`text-sm sm:text-base font-bold ${getColorClass('text', 'text')}`}>{step.id}</span>
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-white">{step.title}</h3>
        </div>
        
        {/* Step description */}
        <p className="text-slate-300 text-sm sm:text-base mb-4 sm:mb-6">{step.description}</p>
        
        {/* Platform integration badges - Conditionally show based on step */}
        {step.id === 4 && (
          <div className="flex flex-wrap gap-2 sm:gap-3 mb-6">
            <div className="flex items-center bg-white/10 rounded-full px-2 sm:px-3 py-1 sm:py-1.5">
              <Chrome className="w-3 h-3 sm:w-4 sm:h-4 text-white mr-1 sm:mr-2" />
              <span className="text-xs sm:text-sm text-white">Google Meet</span>
            </div>
            <div className="flex items-center bg-white/10 rounded-full px-2 sm:px-3 py-1 sm:py-1.5">
              <MessageSquare className="w-3 h-3 sm:w-4 sm:h-4 text-white mr-1 sm:mr-2" />
              <span className="text-xs sm:text-sm text-white">MS Teams</span>
            </div>
            <div className="flex items-center bg-white/10 rounded-full px-2 sm:px-3 py-1 sm:py-1.5">
              <Video className="w-3 h-3 sm:w-4 sm:h-4 text-white mr-1 sm:mr-2" />
              <span className="text-xs sm:text-sm text-white">Zoom</span>
            </div>
          </div>
        )}
        
        {/* Feature list */}
        <ul className="space-y-2 sm:space-y-3 mb-6">
          {step.features.map((feature, idx) => (
            <motion.li 
              key={idx} 
              className="flex items-center"
              initial={{ opacity: 0, x: -10 }}
              animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
              transition={{ duration: 0.3, delay: 0.3 + (idx * 0.1) }}
            >
              <div className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full ${getColorClass('bg', 'bg')} flex items-center justify-center mr-2 sm:mr-3 flex-shrink-0`}>
                {getFeatureIcon(feature.icon)}
              </div>
              <span className="text-white text-sm sm:text-base">{feature.text}</span>
            </motion.li>
          ))}
        </ul>
        
        {/* Realistic UI Preview based on step */}
        <motion.div 
          className="relative h-32 sm:h-40 md:h-48 rounded-lg overflow-hidden border border-white/10"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-gray-900/70 to-gray-900/50 p-3">
            {/* Step-specific UI previews */}
            {step.id === 1 && (
              <div className="h-full flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-white">Resume Upload</div>
                  <div className={`text-xs ${getColorClass('text', 'text')}`}>AI Processing</div>
                </div>
                <div className="flex-1 flex items-center justify-center border border-white/10 rounded bg-slate-900/50 p-2">
                  <div className="space-y-1 w-full">
                    <div className="h-1 bg-white/10 w-3/4 rounded-full"></div>
                    <div className="h-1 bg-white/10 w-full rounded-full"></div>
                    <div className="h-1 bg-white/10 w-2/3 rounded-full"></div>
                    <div className="flex justify-end mt-2">
                      <div className={`h-4 w-4 rounded-full ${getColorClass('bg', 'bg')} animate-pulse`}></div>
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex justify-between items-center">
                  <div className="text-xs text-slate-400">Parsing documents</div>
                  <div className="text-xs text-white">3/5</div>
                </div>
              </div>
            )}
            
            {step.id === 2 && (
              <div className="h-full flex flex-col">
                <div className="text-xs font-medium text-white mb-2">AI Matching Score</div>
                <div className="flex-1 flex space-x-1">
                  {[85, 72, 93, 68, 91].map((score, i) => (
                    <div key={i} className="flex-1 flex flex-col justify-end">
                      <div className="h-full flex flex-col justify-end">
                        <div 
                          className={`w-full ${getColorClass('bg', 'bg')} rounded-sm`} 
                          style={{height: `${score}%`}}
                        ></div>
                      </div>
                      <div className="text-center text-[8px] text-slate-400 mt-1">{score}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {step.id === 3 && (
              <div className="h-full flex flex-col">
                <div className="text-xs font-medium text-white mb-2">Pipeline Stages</div>
                <div className="flex-1 grid grid-cols-4 gap-1">
                  {['Applied', 'Shortlist', 'Interview', 'Offer'].map((stage, i) => (
                    <div key={i} className={`border ${i === 1 ? getColorClass('border', 'border') : 'border-white/10'} rounded p-1 flex flex-col`}>
                      <div className="text-[8px] text-center text-slate-400">{stage}</div>
                      <div className={`text-center text-[10px] ${i === 1 ? 'text-white' : 'text-slate-400'} mt-auto`}>{[12, 8, 4, 2][i]}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {step.id === 4 && (
              <div className="h-full flex flex-col">
                <div className="text-xs font-medium text-white mb-2">Interview Schedule</div>
                <div className="flex-1 flex border border-white/10 rounded bg-slate-900/50">
                  <div className="w-1/4 border-r border-white/10 p-1">
                    <div className="text-[8px] text-slate-400">Today</div>
                    <div className="text-[9px] text-white mt-1">09:00</div>
                    <div className="text-[9px] text-white mt-1">11:30</div>
                    <div className="text-[9px] text-white mt-1">14:00</div>
                  </div>
                  <div className="flex-1 p-1">
                    <div className={`rounded mt-3 px-1 py-0.5 text-[8px] ${getColorClass('bg', 'bg')} text-white`}>Technical Interview</div>
                    <div className="rounded mt-3 px-1 py-0.5 text-[8px] bg-indigo-500/30 text-white">HR Interview</div>
                    <div className="rounded mt-3 px-1 py-0.5 text-[8px] bg-green-500/30 text-white">Final Round</div>
                  </div>
                </div>
              </div>
            )}
            
            {step.id === 5 && (
              <div className="h-full flex flex-col">
                <div className="text-xs font-medium text-white mb-2">AI Notetaker</div>
                <div className="flex-1 border border-white/10 rounded bg-slate-900/50 p-2">
                  <div className="space-y-1">
                    <div className="h-1 bg-white/20 w-full rounded-full"></div>
                    <div className="h-1 bg-white/15 w-5/6 rounded-full"></div>
                    <div className="h-1 bg-white/10 w-full rounded-full"></div>
                    <div className="h-1 bg-white/20 w-4/5 rounded-full"></div>
                    <div className="h-1 bg-white/15 w-full rounded-full"></div>
                    <div className="mt-2 text-[8px] text-white bg-blue-500/20 rounded px-1 py-0.5 w-fit">Key Insight</div>
                  </div>
                </div>
                <div className="mt-1 flex justify-between items-center">
                  <div className="text-[8px] text-slate-400">Live transcription</div>
                  <div className={`text-[8px] ${getColorClass('text', 'text')}`}>10:23</div>
                </div>
              </div>
            )}
            
            {step.id === 6 && (
              <div className="h-full flex flex-col">
                <div className="text-xs font-medium text-white mb-2">Feedback Collection</div>
                <div className="flex-1 grid grid-cols-3 gap-1">
                  {['Technical', 'Communication', 'Culture'].map((category, i) => (
                    <div key={i} className="border border-white/10 rounded p-1 flex flex-col">
                      <div className="text-[8px] text-slate-400">{category}</div>
                      <div className="flex mt-1 justify-center">
                        {[...Array(5)].map((_, starIndex) => (
                          <div key={starIndex} 
                            className={`w-1.5 h-1.5 mx-0.5 rounded-full ${starIndex < [4, 3, 5][i] ? getColorClass('bg', 'bg') : 'bg-white/10'}`}
                          ></div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border border-white/10 rounded mt-1 p-1">
                  <div className="text-[8px] text-slate-400">Comments</div>
                  <div className="h-1 bg-white/10 w-full rounded-full mt-1"></div>
                </div>
              </div>
            )}
            
            {step.id === 7 && (
              <div className="h-full flex flex-col">
                <div className="text-xs font-medium text-white mb-2">Analytics Dashboard</div>
                <div className="flex-1 border border-white/10 rounded bg-slate-900/50 p-1">
                  <div className="flex h-1/2">
                    <div className="w-1/2 border-r border-white/10 p-1">
                      <div className="text-[7px] text-slate-400">Top Candidates</div>
                      <div className="flex items-center">
                        <div className={`w-1 h-1 rounded-full ${getColorClass('bg', 'bg')} mr-1`}></div>
                        <div className="h-1 bg-white/20 w-full rounded-full"></div>
                      </div>
                      <div className="flex items-center mt-0.5">
                        <div className="w-1 h-1 rounded-full bg-indigo-500/50 mr-1"></div>
                        <div className="h-1 bg-white/20 w-4/5 rounded-full"></div>
                      </div>
                    </div>
                    <div className="w-1/2 p-1">
                      <div className="text-[7px] text-slate-400">Time to Hire</div>
                      <div className="flex justify-center items-end h-2/3 space-x-0.5">
                        {[...Array(7)].map((_, i) => (
                          <div key={i} className={`w-1 ${getColorClass('bg', 'bg')} opacity-50`} style={{height: `${30 + (i * 10)}%`}}></div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="h-1/2 pt-1 border-t border-white/10 mt-1">
                    <div className="text-[7px] text-slate-400">Onboarding Progress</div>
                    <div className="w-full bg-white/10 h-1.5 rounded-full mt-1">
                      <div className={`h-full ${getColorClass('bg', 'bg')} rounded-full`} style={{width: '75%'}}></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
