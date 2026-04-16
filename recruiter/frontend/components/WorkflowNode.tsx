'use client';

import { Handle, Position } from '@xyflow/react';
import { motion } from 'framer-motion';
import { 
  BrainCircuit, Files, Globe, Search, 
  ListChecks, PanelLeft, CalendarCheck, 
  Users, ArrowUpRight, FileText, HelpCircle, 
  BarChart, ClipboardCheck, FileStack, AreaChart, 
  ArrowDownToLine, Chrome, MessageSquare, Video
} from 'lucide-react';
import { useBrandConfig } from '@/context/BrandContext';

interface WorkflowNodeData {
  id: number;
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  features: {
    text: string;
    icon: string;
  }[];
}

interface WorkflowNodeProps {
  data: WorkflowNodeData;
}

const getFeatureIcon = (iconName: string) => {
  switch (iconName) {
    case 'brain': return <BrainCircuit className="w-3 h-3" />;
    case 'files': return <Files className="w-3 h-3" />;
    case 'portal': return <Globe className="w-3 h-3" />;
    case 'search': return <Search className="w-3 h-3" />;
    case 'skills': return <ListChecks className="w-3 h-3" />;
    case 'rank': return <BarChart className="w-3 h-3" />;
    case 'pipeline': return <PanelLeft className="w-3 h-3" />;
    case 'shortlist': return <ClipboardCheck className="w-3 h-3" />;
    case 'automation': return <ArrowUpRight className="w-3 h-3" />;
    case 'calendar': return <CalendarCheck className="w-3 h-3" />;
    case 'meet': return <Video className="w-3 h-3" />;
    case 'notes': return <FileText className="w-3 h-3" />;
    case 'questions': return <HelpCircle className="w-3 h-3" />;
    case 'analysis': return <BarChart className="w-3 h-3" />;
    case 'form': return <FileStack className="w-3 h-3" />;
    case 'distribute': return <Users className="w-3 h-3" />;
    case 'aggregate': return <AreaChart className="w-3 h-3" />;
    case 'dashboard': return <BarChart className="w-3 h-3" />;
    case 'compare': return <Users className="w-3 h-3" />;
    case 'onboard': return <ArrowDownToLine className="w-3 h-3" />;
    default: return <div className="w-3 h-3" />;
  }
};

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

export default function WorkflowNode({ data }: WorkflowNodeProps) {
  const brand = useBrandConfig();
  const jet = brand.id === 'jetstone';
  const barFillClass = jet ? solidAccentBg(data.color) : getColorClass(data.color, 'bg');
  const accentTextClass = jet ? solidAccentText(data.color) : getColorClass(data.color, 'text');
  const pvTitle = jet ? 'text-slate-800' : 'text-white';
  const pvMuted = jet ? 'text-slate-600' : 'text-slate-400';
  const pvSub = jet ? 'text-slate-500' : 'text-slate-400';
  const pvStrong = jet ? 'text-slate-900 font-semibold' : 'text-white';
  const pvCard = jet ? 'border border-slate-200 rounded bg-slate-50' : 'border border-white/10 rounded bg-slate-900/50';
  const pvLine = jet ? 'bg-slate-200' : 'bg-white/10';
  return (
    <div
      className={
        jet
          ? 'bg-white border border-slate-200 shadow-lg rounded-xl overflow-hidden w-full max-w-[500px]'
          : `bg-white/5 backdrop-blur-sm rounded-xl border ${getColorClass(data.color, 'border')} overflow-hidden w-full max-w-[500px]`
      }
    >
      {/* Connection handles */}
      <Handle type="target" position={Position.Top} className="w-3 h-3 !bg-blue-400 !border-2 !border-white" />
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 !bg-purple-400 !border-2 !border-white" />
      
      <div className="p-6">
        {/* Step number and title */}
        <div className="flex items-center mb-3">
          <div className={`w-8 h-8 rounded-full ${getColorClass(data.color, 'bg')} flex items-center justify-center mr-3`}>
            <span className={`font-bold ${getColorClass(data.color, 'text')}`}>{data.id}</span>
          </div>
          <h3 className={`text-xl font-bold ${jet ? 'text-slate-900' : 'text-white'}`}>{data.title}</h3>
        </div>
        
        {/* Step description */}
        <p className={`text-sm mb-4 ${jet ? 'text-slate-600' : 'text-slate-300'}`}>{data.description}</p>
        
        {/* Platform integration badges - for step 4 */}
        {data.id === 4 && (
          <div className="flex flex-wrap gap-2 mb-4">
            <div className={`flex items-center rounded-full px-2 py-1 ${jet ? 'bg-slate-100 border border-slate-200' : 'bg-white/10'}`}>
              <Chrome className={`w-3 h-3 mr-1 ${jet ? 'text-slate-600' : 'text-white'}`} />
              <span className={`text-xs ${jet ? 'text-slate-700' : 'text-white'}`}>Google Meet</span>
            </div>
            <div className={`flex items-center rounded-full px-2 py-1 ${jet ? 'bg-slate-100 border border-slate-200' : 'bg-white/10'}`}>
              <MessageSquare className={`w-3 h-3 mr-1 ${jet ? 'text-slate-600' : 'text-white'}`} />
              <span className={`text-xs ${jet ? 'text-slate-700' : 'text-white'}`}>MS Teams</span>
            </div>
            <div className={`flex items-center rounded-full px-2 py-1 ${jet ? 'bg-slate-100 border border-slate-200' : 'bg-white/10'}`}>
              <Video className={`w-3 h-3 mr-1 ${jet ? 'text-slate-600' : 'text-white'}`} />
              <span className={`text-xs ${jet ? 'text-slate-700' : 'text-white'}`}>Zoom</span>
            </div>
          </div>
        )}
        
        {/* Feature list */}
        <ul className="space-y-2 mb-4">
          {data.features.map((feature, idx) => (
            <li key={idx} className="flex items-center">
              <div className={`w-5 h-5 rounded-full ${getColorClass(data.color, 'bg')} flex items-center justify-center mr-2 flex-shrink-0`}>
                {getFeatureIcon(feature.icon)}
              </div>
              <span className={`text-sm ${jet ? 'text-slate-800' : 'text-white'}`}>{feature.text}</span>
            </li>
          ))}
        </ul>
        
        {/* Demo UI Preview - Step-specific */}
        <div
          className={
            jet
              ? 'relative h-40 rounded-lg overflow-hidden border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-3'
              : 'relative h-40 rounded-lg overflow-hidden border border-white/10 bg-gradient-to-br from-gray-900/70 to-gray-900/50 p-3'
          }
        >
          {data.id === 1 && (
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <div className={`text-xs font-medium ${pvTitle}`}>Resume Upload</div>
                <div className={`text-xs ${accentTextClass}`}>AI Processing</div>
              </div>
              <div className={`flex-1 flex items-center justify-center rounded p-2 ${pvCard}`}>
                <div className="space-y-1 w-full">
                  <motion.div 
                    className={`h-1 rounded-full ${pvLine}`}
                    initial={{ width: 0 }}
                    animate={{ width: '75%' }}
                    transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 1 }}
                  />
                  <motion.div 
                    className={`h-1 w-full rounded-full ${pvLine}`}
                    initial={{ opacity: 0.3 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.8, delay: 0.3, repeat: Infinity, repeatDelay: 1.2 }}
                  />
                  <motion.div 
                    className={`h-1 rounded-full ${pvLine}`}
                    initial={{ width: 0 }}
                    animate={{ width: '66%' }}
                    transition={{ duration: 1.2, delay: 0.5, repeat: Infinity, repeatDelay: 1 }}
                  />
                  <div className="flex justify-end mt-2">
                    <motion.div 
                      className={`h-4 w-4 rounded-full ${barFillClass}`}
                      animate={{ 
                        scale: [1, 1.2, 1],
                        opacity: [0.6, 1, 0.6]
                      }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-2 flex justify-between items-center">
                <div className={`text-xs ${pvMuted}`}>Parsing documents</div>
                <motion.div 
                  className={`text-xs ${pvStrong}`}
                  key={Math.random()}
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  3/5
                </motion.div>
              </div>
            </div>
          )}
          
          {data.id === 2 && (
            <div className="h-full flex flex-col">
              <div className={`text-xs font-medium mb-2 ${pvTitle}`}>AI Matching Score</div>
              <div className="flex-1 flex space-x-1">
                {[85, 72, 93, 68, 91].map((score, i) => (
                  <div key={i} className="flex-1 flex flex-col justify-end">
                    <div className="h-full flex flex-col justify-end">
                      <motion.div 
                        className={`w-full ${barFillClass} rounded-sm`}
                        initial={{ height: 0 }}
                        animate={{ height: `${score}%` }}
                        transition={{ 
                          duration: 1, 
                          delay: i * 0.15,
                          repeat: Infinity,
                          repeatDelay: 2
                        }}
                      />
                    </div>
                    <motion.div 
                      className={`text-center text-[8px] mt-1 ${pvMuted}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 1 + (i * 0.15) }}
                    >
                      {score}%
                    </motion.div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {data.id === 3 && (
            <div className="h-full flex flex-col">
              <div className={`text-xs font-medium mb-2 ${pvTitle}`}>Pipeline Stages</div>
              <div className="flex-1 grid grid-cols-4 gap-1">
                {['Applied', 'Shortlist', 'Interview', 'Offer'].map((stage, i) => (
                  <motion.div 
                    key={i} 
                    className={`rounded p-1 flex flex-col border ${i === 1 ? getColorClass(data.color, 'border') : jet ? 'border-slate-200' : 'border-white/10'}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.2, duration: 0.5 }}
                    whileHover={{ scale: 1.05, borderColor: i === 1 ? undefined : jet ? 'rgba(15,23,42,0.25)' : 'rgba(255,255,255,0.3)' }}
                  >
                    <div className={`text-[8px] text-center ${pvSub}`}>{stage}</div>
                    <motion.div 
                      className={`text-center text-[10px] mt-auto ${i === 1 ? pvStrong : pvSub}`}
                      animate={i === 1 ? { scale: [1, 1.1, 1] } : {}}
                      transition={i === 1 ? { duration: 2, repeat: Infinity } : {}}
                    >
                      {[12, 8, 4, 2][i]}
                    </motion.div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}
          
          {data.id === 4 && (
            <div className="h-full flex flex-col">
              <div className={`text-xs font-medium mb-2 ${pvTitle}`}>Interview Schedule</div>
              <div className={`flex-1 flex rounded ${pvCard}`}>
                <div className={`w-1/4 border-r p-1 ${jet ? 'border-slate-200' : 'border-white/10'}`}>
                  <div className={`text-[8px] ${pvSub}`}>Today</div>
                  <motion.div 
                    className={`text-[9px] mt-1 ${pvStrong}`}
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    09:00
                  </motion.div>
                  <motion.div 
                    className={`text-[9px] mt-1 ${pvStrong}`}
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 }}
                  >
                    11:30
                  </motion.div>
                  <motion.div 
                    className={`text-[9px] mt-1 ${pvStrong}`}
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.6 }}
                  >
                    14:00
                  </motion.div>
                </div>
                <div className="flex-1 p-1">
                  <motion.div 
                    className={`rounded mt-3 px-1 py-0.5 text-[8px] text-white ${jet ? solidAccentBg(data.color) : getColorClass(data.color, 'bg')}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 }}
                    whileHover={{ scale: 1.05 }}
                  >
                    Technical Interview
                  </motion.div>
                  <motion.div 
                    className={`rounded mt-3 px-1 py-0.5 text-[8px] ${jet ? 'bg-indigo-100 text-indigo-800' : 'bg-indigo-500/30 text-white'}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 }}
                    whileHover={{ scale: 1.05 }}
                  >
                    HR Interview
                  </motion.div>
                  <motion.div 
                    className={`rounded mt-3 px-1 py-0.5 text-[8px] ${jet ? 'bg-emerald-100 text-emerald-800' : 'bg-green-500/30 text-white'}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.7 }}
                    whileHover={{ scale: 1.05 }}
                  >
                    Final Round
                  </motion.div>
                </div>
              </div>
            </div>
          )}
          
          {data.id === 5 && (
            <div className="h-full flex flex-col">
              <div className={`text-xs font-medium mb-2 ${pvTitle}`}>AI Notetaker</div>
              <div className={`flex-1 rounded p-2 ${pvCard}`}>
                <div className="space-y-1">
                  <motion.div 
                    className={`h-1 rounded-full ${jet ? 'bg-slate-300' : 'bg-white/20'}`}
                    initial={{ width: 0 }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 1 }}
                  />
                  <motion.div 
                    className={`h-1 rounded-full ${jet ? 'bg-slate-200' : 'bg-white/15'}`}
                    initial={{ width: 0 }}
                    animate={{ width: '83%' }}
                    transition={{ duration: 1.3, delay: 0.3, repeat: Infinity, repeatDelay: 1 }}
                  />
                  <motion.div 
                    className={`h-1 rounded-full ${pvLine}`}
                    initial={{ width: 0 }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 1.6, delay: 0.5, repeat: Infinity, repeatDelay: 1 }}
                  />
                  <motion.div 
                    className={`h-1 rounded-full ${jet ? 'bg-slate-300' : 'bg-white/20'}`}
                    initial={{ width: 0 }}
                    animate={{ width: '80%' }}
                    transition={{ duration: 1.4, delay: 0.7, repeat: Infinity, repeatDelay: 1 }}
                  />
                  <motion.div 
                    className={`h-1 rounded-full ${jet ? 'bg-slate-200' : 'bg-white/15'}`}
                    initial={{ width: 0 }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 1.7, delay: 0.9, repeat: Infinity, repeatDelay: 1 }}
                  />
                  <motion.div 
                    className={`mt-2 text-[8px] rounded px-1 py-0.5 w-fit ${jet ? 'bg-blue-100 text-blue-800' : 'text-white bg-blue-500/20'}`}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 1.5 }}
                  >
                    Key Insight
                  </motion.div>
                </div>
              </div>
              <div className="mt-1 flex justify-between items-center">
                <motion.div 
                  className={`text-[8px] ${pvSub}`}
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  Live transcription
                </motion.div>
                <motion.div 
                  className={`text-[8px] ${accentTextClass}`}
                  animate={{ opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  10:23
                </motion.div>
              </div>
            </div>
          )}
          
          {data.id === 6 && (
            <div className="h-full flex flex-col">
              <div className={`text-xs font-medium mb-2 ${pvTitle}`}>Feedback Collection</div>
              <div className="flex-1 grid grid-cols-3 gap-1">
                {['Technical', 'Communication', 'Culture'].map((category, i) => (
                  <motion.div 
                    key={i} 
                    className={`border rounded p-1 flex flex-col ${jet ? 'border-slate-200 bg-white/60' : 'border-white/10'}`}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.2 }}
                  >
                    <div className={`text-[8px] ${pvSub}`}>{category}</div>
                    <div className="flex mt-1 justify-center">
                      {[...Array(5)].map((_, starIndex) => {
                        const isActive = starIndex < [4, 3, 5][i];
                        return (
                          <motion.div 
                            key={starIndex} 
                            className={`w-1.5 h-1.5 mx-0.5 rounded-full ${isActive ? barFillClass : jet ? 'bg-slate-200' : 'bg-white/10'}`}
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ 
                              delay: 0.5 + (i * 0.2) + (starIndex * 0.1),
                              duration: 0.3
                            }}
                          />
                        );
                      })}
                    </div>
                  </motion.div>
                ))}
              </div>
              <motion.div 
                className={`border rounded mt-1 p-1 ${jet ? 'border-slate-200 bg-white/60' : 'border-white/10'}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.5 }}
              >
                <div className={`text-[8px] ${pvSub}`}>Comments</div>
                <motion.div 
                  className={`h-1 rounded-full mt-1 ${pvLine}`}
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 2, delay: 2, repeat: Infinity, repeatDelay: 1 }}
                />
              </motion.div>
            </div>
          )}
          
          {data.id === 7 && (
            <div className="h-full flex flex-col">
              <div className={`text-xs font-medium mb-2 ${pvTitle}`}>Analytics Dashboard</div>
              <div className={`flex-1 rounded p-1 ${pvCard}`}>
                <div className="flex h-1/2">
                  <div className={`w-1/2 border-r p-1 ${jet ? 'border-slate-200' : 'border-white/10'}`}>
                    <div className={`text-[7px] ${pvSub}`}>Top Candidates</div>
                    <div className="flex items-center">
                      <motion.div 
                        className={`w-1 h-1 rounded-full ${barFillClass} mr-1`}
                        animate={{ scale: [1, 1.3, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                      <motion.div 
                        className={`h-1 rounded-full ${jet ? 'bg-slate-200' : 'bg-white/20'}`}
                        initial={{ width: 0 }}
                        animate={{ width: '100%' }}
                        transition={{ duration: 1, delay: 0.2 }}
                      />
                    </div>
                    <div className="flex items-center mt-0.5">
                      <motion.div 
                        className={`w-1 h-1 rounded-full mr-1 ${jet ? 'bg-indigo-500' : 'bg-indigo-500/50'}`}
                        animate={{ scale: [1, 1.3, 1] }}
                        transition={{ duration: 2, delay: 0.5, repeat: Infinity }}
                      />
                      <motion.div 
                        className={`h-1 rounded-full ${jet ? 'bg-slate-200' : 'bg-white/20'}`}
                        initial={{ width: 0 }}
                        animate={{ width: '80%' }}
                        transition={{ duration: 1, delay: 0.5 }}
                      />
                    </div>
                  </div>
                  <div className="w-1/2 p-1">
                    <div className={`text-[7px] ${pvSub}`}>Time to Hire</div>
                    <div className="flex justify-center items-end h-2/3 space-x-0.5">
                      {[...Array(7)].map((_, i) => (
                        <motion.div 
                          key={i} 
                          className={`w-1 ${jet ? solidAccentBg(data.color) : `${getColorClass(data.color, 'bg')} opacity-50`}`}
                          initial={{ height: 0 }}
                          animate={{ height: `${30 + (i * 10)}%` }}
                          transition={{ 
                            duration: 0.8, 
                            delay: i * 0.1,
                            repeat: Infinity,
                            repeatDelay: 2
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div className={`h-1/2 pt-1 border-t mt-1 ${jet ? 'border-slate-200' : 'border-white/10'}`}>
                  <div className={`text-[7px] ${pvSub}`}>Onboarding Progress</div>
                  <div className={`w-full h-1.5 rounded-full mt-1 ${jet ? 'bg-slate-200' : 'bg-white/10'}`}>
                    <motion.div 
                      className={`h-full ${barFillClass} rounded-full`}
                      initial={{ width: 0 }}
                      animate={{ width: '75%' }}
                      transition={{ 
                        duration: 2, 
                        delay: 1,
                        repeat: Infinity,
                        repeatDelay: 2
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

