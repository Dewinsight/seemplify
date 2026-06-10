'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import Image from 'next/image';
import { useBrandConfig } from '@/context/BrandContext';
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
  const brand = useBrandConfig();
  const jet = brand.id === 'jetstone';

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

  const solidAccentBg = (color: string) => {
    switch (color) {
      case 'blue': return 'bg-blue-500';
      case 'purple': return 'bg-purple-500';
      case 'indigo': return 'bg-indigo-500';
      case 'cyan': return 'bg-cyan-500';
      case 'emerald': return 'bg-emerald-600';
      case 'amber': return 'bg-amber-500';
      case 'green': return 'bg-green-600';
      default: return 'bg-blue-500';
    }
  };

  const solidAccentText = (color: string) => {
    switch (color) {
      case 'blue': return 'text-blue-600';
      case 'purple': return 'text-purple-600';
      case 'indigo': return 'text-indigo-600';
      case 'cyan': return 'text-cyan-600';
      case 'emerald': return 'text-emerald-700';
      case 'amber': return 'text-amber-700';
      case 'green': return 'text-green-700';
      default: return 'text-blue-600';
    }
  };

  const barFillClass = jet ? solidAccentBg(step.color) : getColorClass(step.color, 'bg');
  const accentTextClass = jet ? solidAccentText(step.color) : getColorClass(step.color, 'text');
  const pvTitle = jet ? 'text-slate-800' : 'text-white';
  const pvMuted = jet ? 'text-slate-600' : 'text-slate-400';
  const pvSub = jet ? 'text-slate-500' : 'text-slate-400';
  const pvStrong = jet ? 'text-slate-900 font-semibold' : 'text-white';
  const pvCard = jet ? 'border border-slate-200 rounded bg-slate-50' : 'border border-white/10 rounded bg-slate-900/50';
  const pvLine = jet ? 'bg-slate-200' : 'bg-white/10';

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
      className={
        jet
          ? 'bg-white rounded-xl border border-slate-200 shadow-md overflow-hidden'
          : `bg-white/5 backdrop-blur-sm rounded-xl border ${getColorClass(step.color, 'border')} overflow-hidden`
      }
      variants={cardVariants}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
    >
      <div className={`p-4 sm:p-6 pb-6 sm:pb-8`}>
        {/* Step number */}
        <div className="flex items-center mb-3 sm:mb-4">
          <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full ${getColorClass(step.color, 'bg')} flex items-center justify-center mr-2 sm:mr-3`}>
            <span className={`text-sm sm:text-base font-bold ${getColorClass(step.color, 'text')}`}>{step.id}</span>
          </div>
          <h3 className={`text-lg sm:text-xl font-bold ${jet ? 'text-slate-900' : 'text-white'}`}>{step.title}</h3>
        </div>
        
        {/* Step description */}
        <p className={`text-sm sm:text-base mb-4 sm:mb-6 ${jet ? 'text-slate-600' : 'text-slate-300'}`}>{step.description}</p>
        
        {/* Platform integration badges - Conditionally show based on step */}
        {step.id === 4 && (
          <div className="flex flex-wrap gap-2 sm:gap-3 mb-6">
            <div className={`flex items-center rounded-full px-2 sm:px-3 py-1 sm:py-1.5 ${jet ? 'bg-slate-100 border border-slate-200' : 'bg-white/10'}`}>
              <Chrome className={`w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2 ${jet ? 'text-slate-600' : 'text-white'}`} />
              <span className={`text-xs sm:text-sm ${jet ? 'text-slate-700' : 'text-white'}`}>Google Meet</span>
            </div>
            <div className={`flex items-center rounded-full px-2 sm:px-3 py-1 sm:py-1.5 ${jet ? 'bg-slate-100 border border-slate-200' : 'bg-white/10'}`}>
              <MessageSquare className={`w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2 ${jet ? 'text-slate-600' : 'text-white'}`} />
              <span className={`text-xs sm:text-sm ${jet ? 'text-slate-700' : 'text-white'}`}>MS Teams</span>
            </div>
            <div className={`flex items-center rounded-full px-2 sm:px-3 py-1 sm:py-1.5 ${jet ? 'bg-slate-100 border border-slate-200' : 'bg-white/10'}`}>
              <Video className={`w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2 ${jet ? 'text-slate-600' : 'text-white'}`} />
              <span className={`text-xs sm:text-sm ${jet ? 'text-slate-700' : 'text-white'}`}>Zoom</span>
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
              <div className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full ${getColorClass(step.color, 'bg')} flex items-center justify-center mr-2 sm:mr-3 flex-shrink-0`}>
                {getFeatureIcon(feature.icon)}
              </div>
              <span className={`text-sm sm:text-base ${jet ? 'text-slate-800' : 'text-white'}`}>{feature.text}</span>
            </motion.li>
          ))}
        </ul>
        
        {/* Realistic UI Preview based on step */}
        <motion.div 
          className={`relative h-32 sm:h-40 md:h-48 rounded-lg overflow-hidden border ${jet ? 'border-slate-200' : 'border-white/10'}`}
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          <div
            className={
              jet
                ? 'absolute inset-0 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-3'
                : 'absolute inset-0 bg-gradient-to-br from-gray-900/70 to-gray-900/50 p-3'
            }
          >
            {/* Step-specific UI previews */}
            {step.id === 1 && (
              <div className="h-full flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <div className={`text-xs font-medium ${pvTitle}`}>Resume Upload</div>
                  <div className={`text-xs ${accentTextClass}`}>AI Processing</div>
                </div>
                <div className={`flex-1 flex items-center justify-center ${pvCard} p-2`}>
                  <div className="space-y-1 w-full">
                    <div className={`h-1 ${pvLine} w-3/4 rounded-full`}></div>
                    <div className={`h-1 ${pvLine} w-full rounded-full`}></div>
                    <div className={`h-1 ${pvLine} w-2/3 rounded-full`}></div>
                    <div className="flex justify-end mt-2">
                      <div className={`h-4 w-4 rounded-full ${barFillClass} animate-pulse`}></div>
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex justify-between items-center">
                  <div className={`text-xs ${pvMuted}`}>Parsing documents</div>
                  <div className={`text-xs ${pvStrong}`}>3/5</div>
                </div>
              </div>
            )}
            
            {step.id === 2 && (
              <div className="h-full flex flex-col">
                <div className={`text-xs font-medium mb-2 ${pvTitle}`}>AI Matching Score</div>
                <div className="flex-1 flex space-x-1">
                  {[85, 72, 93, 68, 91].map((score, i) => (
                    <div key={i} className="flex-1 flex flex-col justify-end">
                      <div className="h-full flex flex-col justify-end">
                        <div 
                          className={`w-full ${barFillClass} rounded-sm`} 
                          style={{height: `${score}%`}}
                        ></div>
                      </div>
                      <div className={`text-center text-[8px] mt-1 ${pvMuted}`}>{score}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {step.id === 3 && (
              <div className="h-full flex flex-col">
                <div className={`text-xs font-medium mb-2 ${pvTitle}`}>Pipeline Stages</div>
                <div className="flex-1 grid grid-cols-4 gap-1">
                  {['Applied', 'Shortlist', 'Interview', 'Offer'].map((stage, i) => (
                    <div key={i} className={`rounded p-1 flex flex-col border ${i === 1 ? getColorClass(step.color, 'border') : jet ? 'border-slate-200' : 'border-white/10'}`}>
                      <div className={`text-[8px] text-center ${pvSub}`}>{stage}</div>
                      <div className={`text-center text-[10px] mt-auto ${i === 1 ? pvStrong : pvSub}`}>{[12, 8, 4, 2][i]}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {step.id === 4 && (
              <div className="h-full flex flex-col">
                <div className={`text-xs font-medium mb-2 ${pvTitle}`}>Interview Schedule</div>
                <div className={`flex-1 flex border rounded ${pvCard}`}>
                  <div className={`w-1/4 border-r p-1 ${jet ? 'border-slate-200' : 'border-white/10'}`}>
                    <div className={`text-[8px] ${pvSub}`}>Today</div>
                    <div className={`text-[9px] mt-1 ${pvStrong}`}>09:00</div>
                    <div className={`text-[9px] mt-1 ${pvStrong}`}>11:30</div>
                    <div className={`text-[9px] mt-1 ${pvStrong}`}>14:00</div>
                  </div>
                  <div className="flex-1 p-1">
                    <div className={`rounded mt-3 px-1 py-0.5 text-[8px] text-white ${jet ? solidAccentBg(step.color) : getColorClass(step.color, 'bg')}`}>Technical Interview</div>
                    <div className={`rounded mt-3 px-1 py-0.5 text-[8px] ${jet ? 'bg-indigo-100 text-indigo-800' : 'bg-indigo-500/30 text-white'}`}>HR Interview</div>
                    <div className={`rounded mt-3 px-1 py-0.5 text-[8px] ${jet ? 'bg-emerald-100 text-emerald-800' : 'bg-green-500/30 text-white'}`}>Final Round</div>
                  </div>
                </div>
              </div>
            )}
            
            {step.id === 5 && (
              <div className="h-full flex flex-col">
                <div className={`text-xs font-medium mb-2 ${pvTitle}`}>AI Notetaker</div>
                <div className={`flex-1 border rounded p-2 ${pvCard}`}>
                  <div className="space-y-1">
                    <div className={`h-1 w-full rounded-full ${jet ? 'bg-slate-300' : 'bg-white/20'}`}></div>
                    <div className={`h-1 w-5/6 rounded-full ${jet ? 'bg-slate-200' : 'bg-white/15'}`}></div>
                    <div className={`h-1 w-full rounded-full ${pvLine}`}></div>
                    <div className={`h-1 w-4/5 rounded-full ${jet ? 'bg-slate-300' : 'bg-white/20'}`}></div>
                    <div className={`h-1 w-full rounded-full ${jet ? 'bg-slate-200' : 'bg-white/15'}`}></div>
                    <div className={`mt-2 text-[8px] rounded px-1 py-0.5 w-fit ${jet ? 'bg-blue-100 text-blue-800' : 'text-white bg-blue-500/20'}`}>Key Insight</div>
                  </div>
                </div>
                <div className="mt-1 flex justify-between items-center">
                  <div className={`text-[8px] ${pvSub}`}>Live transcription</div>
                  <div className={`text-[8px] ${accentTextClass}`}>10:23</div>
                </div>
              </div>
            )}
            
            {step.id === 6 && (
              <div className="h-full flex flex-col">
                <div className={`text-xs font-medium mb-2 ${pvTitle}`}>Feedback Collection</div>
                <div className="flex-1 grid grid-cols-3 gap-1">
                  {['Technical', 'Communication', 'Culture'].map((category, i) => (
                    <div key={i} className={`border rounded p-1 flex flex-col ${jet ? 'border-slate-200 bg-white/60' : 'border-white/10'}`}>
                      <div className={`text-[8px] ${pvSub}`}>{category}</div>
                      <div className="flex mt-1 justify-center">
                        {[...Array(5)].map((_, starIndex) => (
                          <div key={starIndex} 
                            className={`w-1.5 h-1.5 mx-0.5 rounded-full ${starIndex < [4, 3, 5][i] ? barFillClass : jet ? 'bg-slate-200' : 'bg-white/10'}`}
                          ></div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className={`border rounded mt-1 p-1 ${jet ? 'border-slate-200 bg-white/60' : 'border-white/10'}`}>
                  <div className={`text-[8px] ${pvSub}`}>Comments</div>
                  <div className={`h-1 w-full rounded-full mt-1 ${pvLine}`}></div>
                </div>
              </div>
            )}
            
            {step.id === 7 && (
              <div className="h-full flex flex-col">
                <div className={`text-xs font-medium mb-2 ${pvTitle}`}>Analytics Dashboard</div>
                <div className={`flex-1 border rounded p-1 ${pvCard}`}>
                  <div className="flex h-1/2">
                    <div className={`w-1/2 border-r p-1 ${jet ? 'border-slate-200' : 'border-white/10'}`}>
                      <div className={`text-[7px] ${pvSub}`}>Top Candidates</div>
                      <div className="flex items-center">
                        <div className={`w-1 h-1 rounded-full ${barFillClass} mr-1`}></div>
                        <div className={`h-1 w-full rounded-full ${jet ? 'bg-slate-200' : 'bg-white/20'}`}></div>
                      </div>
                      <div className="flex items-center mt-0.5">
                        <div className={`w-1 h-1 rounded-full mr-1 ${jet ? 'bg-indigo-500' : 'bg-indigo-500/50'}`}></div>
                        <div className={`h-1 w-4/5 rounded-full ${jet ? 'bg-slate-200' : 'bg-white/20'}`}></div>
                      </div>
                    </div>
                    <div className="w-1/2 p-1">
                      <div className={`text-[7px] ${pvSub}`}>Time to Hire</div>
                      <div className="flex justify-center items-end h-2/3 space-x-0.5">
                        {[...Array(7)].map((_, i) => (
                          <div key={i} className={`w-1 ${jet ? solidAccentBg(step.color) : `${getColorClass(step.color, 'bg')} opacity-50`}`} style={{height: `${30 + (i * 10)}%`}}></div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className={`h-1/2 pt-1 border-t mt-1 ${jet ? 'border-slate-200' : 'border-white/10'}`}>
                    <div className={`text-[7px] ${pvSub}`}>Hiring Progress</div>
                    <div className={`w-full h-1.5 rounded-full mt-1 ${jet ? 'bg-slate-200' : 'bg-white/10'}`}>
                      <div className={`h-full ${barFillClass} rounded-full`} style={{width: '75%'}}></div>
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
