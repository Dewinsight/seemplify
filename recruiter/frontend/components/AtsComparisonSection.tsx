'use client';

import { motion } from 'framer-motion';
import { 
  Search, Cpu, BrainCircuit, BarChart3, ZoomIn, Filter, 
  ClipboardList, Clock, Users, Zap, Check, X, Share2 
} from 'lucide-react';
import Image from 'next/image';
import { useBrandConfig } from '@/context/BrandContext';

export default function AtsComparisonSection() {
  const brand = useBrandConfig();
  const isJetstone = brand.id === 'jetstone';
  const comparisonPoints = [
    {
      title: "Resume Analysis",
      smarthr: {
        feature: "Deep semantic analysis with AI",
        icon: <BrainCircuit className="w-5 h-5 text-green-400" />,
        description: "Extracts implicit skills, experiences and potential from unstructured data"
      },
      traditional: {
        feature: "Basic keyword matching",
        icon: <Search className="w-5 h-5 text-red-400" />,
        description: "Misses qualified candidates whose resumes don't contain exact keywords"
      }
    },
    {
      title: "Candidate Search",
      smarthr: {
        feature: "Vector search technology",
        icon: <ZoomIn className="w-5 h-5 text-green-400" />,
        description: "Finds candidates based on semantic similarity and contextual understanding"
      },
      traditional: {
        feature: "Boolean search filters",
        icon: <Filter className="w-5 h-5 text-red-400" />,
        description: "Limited to exact matches and complex boolean queries"
      }
    },
    {
      title: "Matching Algorithm",
      smarthr: {
        feature: "AI-powered holistic matching",
        icon: <Cpu className="w-5 h-5 text-green-400" />,
        description: "Considers skills, experience, culture fit and growth potential"
      },
      traditional: {
        feature: "Rules-based screening",
        icon: <ClipboardList className="w-5 h-5 text-red-400" />,
        description: "Rigid requirements often eliminate good candidates"
      }
    },
    {
      title: "Processing Speed",
      smarthr: {
        feature: "Real-time analysis",
        icon: <Zap className="w-5 h-5 text-green-400" />,
        description: "Instant results for thousands of candidates"
      },
      traditional: {
        feature: "Sequential processing",
        icon: <Clock className="w-5 h-5 text-red-400" />,
        description: "Slow manual review required for large volumes"
      }
    }
  ];

  return (
    <section className="relative z-10 container mx-auto px-4 py-20 overflow-hidden">
      {/* Enhanced Background decoration */}
      <div className="absolute -top-20 right-0 w-full max-w-[600px] h-[600px] opacity-20 pointer-events-none">
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className={`w-full h-full ${isJetstone ? 'fill-amber-500/30' : 'fill-purple-500/30'}`}>
          <path d="M44.7,-76.4C58.8,-69.2,71.8,-59.1,79.6,-45.8C87.4,-32.6,90,-16.3,88.5,-1.5C87,13.4,81.4,26.8,73.5,38.5C65.6,50.2,55.3,60.3,43.1,67.6C31,74.9,15.5,79.4,0.3,79C-14.9,78.5,-29.9,73.1,-41.8,64.4C-53.8,55.7,-62.8,43.7,-70.8,30.7C-78.9,17.7,-86,3.7,-83.8,-8.9C-81.5,-21.5,-69.9,-32.6,-58.4,-40.9C-46.9,-49.1,-35.4,-54.4,-24,-63.1C-12.7,-71.7,-1.3,-83.8,12.2,-85.4C25.7,-87,51.3,-78.1,44.7,-76.4Z" transform="translate(100 100)" />
        </svg>
      </div>
      <div className="absolute bottom-0 left-0 w-full max-w-[500px] h-[500px] opacity-20 pointer-events-none">
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className={`w-full h-full ${isJetstone ? 'fill-green-500/30' : 'fill-blue-500/30'}`}>
          <path d="M34.6,-59.3C45.4,-53.8,55.2,-45.6,62.1,-35.1C69,-24.6,73,-11.8,74.2,1.2C75.4,14.2,73.8,28.3,66.8,39C59.8,49.6,47.4,56.8,34.9,58.4C22.4,60,9.7,56,-2.5,55.5C-14.6,54.9,-29.3,57.8,-40.4,53.3C-51.5,48.9,-59.1,37.1,-66.2,24.4C-73.2,11.7,-79.7,-1.9,-79.2,-15.6C-78.7,-29.3,-71.2,-43,-59.9,-49.7C-48.7,-56.5,-33.5,-56.3,-21,-54.9C-8.4,-53.5,1.6,-51,12.5,-57.3C23.4,-63.6,34.3,-79,37.8,-77.9C41.3,-76.9,37.2,-59.4,34.6,-59.3Z" transform="translate(100 100)" />
        </svg>
      </div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[800px] aspect-square pointer-events-none opacity-10">
        <svg width="100%" height="100%" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
          <g fill="none" stroke="url(#grad)" strokeWidth="2">
            <circle cx="400" cy="400" r="200" />
            <circle cx="400" cy="400" r="250" />
            <circle cx="400" cy="400" r="300" />
            <circle cx="400" cy="400" r="350" />
            <line x1="0" y1="400" x2="800" y2="400" />
            <line x1="400" y1="0" x2="400" y2="800" />
          </g>
          <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={isJetstone ? "#10B981" : "#4F46E5"} />
              <stop offset="100%" stopColor={isJetstone ? "#F59E0B" : "#9333EA"} />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <motion.div 
        className="text-center mb-16"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
      >
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium mb-4 ${isJetstone ? 'bg-green-500/10 text-green-700' : 'bg-blue-500/10 text-blue-400'}`}>
          <Share2 className="w-4 h-4 mr-2" />
          Competitive Edge
        </span>
        <h2 className={`text-3xl md:text-5xl font-bold mb-6 bg-clip-text text-transparent ${isJetstone ? 'bg-gradient-to-r from-green-900 to-amber-800' : 'bg-gradient-to-r from-white to-blue-200'}`}>
          Beyond Traditional ATS Systems
        </h2>
        <p className={`text-lg max-w-3xl mx-auto ${isJetstone ? 'text-slate-600' : 'text-slate-300'}`}>
          {brand.name} revolutionizes candidate matching with advanced AI and vector search technology, 
          going far beyond what traditional Applicant Tracking Systems can offer.
        </p>
      </motion.div>

      {/* Main comparison visualization */}
      <div className="relative mb-8 sm:mb-12 lg:mb-16">
        <motion.div 
          className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-purple-500/5 rounded-xl sm:rounded-2xl lg:rounded-3xl"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3, duration: 1 }}
        />

        <div className={`relative rounded-xl sm:rounded-2xl overflow-hidden border shadow-xl ${isJetstone ? 'border-green-200/50' : 'border-white/10'}`}>
          <div className="flex flex-col lg:flex-row">
            {/* SmartHR side */}
            <motion.div 
              className={`flex-1 backdrop-blur-sm p-8 relative ${isJetstone ? 'bg-gradient-to-br from-green-50 to-emerald-50' : 'bg-gradient-to-br from-blue-900/40 to-purple-900/40'}`}
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
            >
              {/* Custom animated background decorations */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <svg className="absolute -top-20 -right-20 w-80 h-80 opacity-10" viewBox="0 0 100 100">
                  <defs>
                    <linearGradient id="circleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor={isJetstone ? "#10B981" : "#4F46E5"} />
                      <stop offset="100%" stopColor={isJetstone ? "#F59E0B" : "#9333EA"} />
                    </linearGradient>
                  </defs>
                  <circle cx="50" cy="50" r="40" strokeWidth="1" stroke="url(#circleGradient)" fill="none" />
                  <circle cx="50" cy="50" r="35" strokeWidth="0.5" stroke="url(#circleGradient)" fill="none" strokeDasharray="2 2" />
                  <circle cx="50" cy="50" r="30" strokeWidth="0.5" stroke="url(#circleGradient)" fill="none" />
                  <circle cx="50" cy="50" r="25" strokeWidth="0.5" stroke="url(#circleGradient)" fill="none" strokeDasharray="3 1" />
                </svg>
                
                <motion.div
                  className="absolute bottom-0 left-0 w-full h-40 opacity-5"
                  animate={{ 
                    backgroundPosition: ["0% 0%", "100% 100%"],
                  }}
                  transition={{
                    duration: 20,
                    repeat: Infinity,
                    repeatType: "reverse",
                  }}
                  style={{
                    backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
                    backgroundSize: "60px 60px",
                  }}
                />
              </div>
              
              <div className="flex items-center mb-6 relative z-10">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shadow-lg mr-3 relative overflow-hidden ${isJetstone ? 'bg-gradient-to-br from-green-500 to-emerald-600' : 'bg-gradient-to-br from-blue-400 to-purple-500'}`}>
                  <span className="font-extrabold text-white text-sm relative z-10">HR</span>
                  {/* Abstract data flow animation */}
                  <motion.div 
                    className="absolute inset-0 opacity-30"
                    animate={{ 
                      backgroundPositionY: ["0%", "100%"],
                    }}
                    transition={{
                      duration: 3,
                      repeat: Infinity,
                      repeatType: "loop",
                    }}
                    style={{
                      backgroundImage: "linear-gradient(0deg, transparent 0%, transparent 40%, rgba(255,255,255,0.5) 50%, transparent 60%, transparent 100%)",
                      backgroundSize: "100% 300%",
                    }}
                  />
                </div>
                <h3 className={`text-xl font-bold ${isJetstone ? 'text-green-900' : 'text-white'}`}>{brand.name}</h3>
                <div className={`ml-auto px-3 py-1 rounded-full text-sm font-medium border shadow-sm ${isJetstone ? 'bg-green-100 text-green-700 border-green-200 shadow-green-100' : 'bg-green-400/20 text-green-400 border-green-400/30 shadow-green-400/10'}`}>
                  Next-Gen Solution
                </div>
              </div>

              <div className={`relative h-52 mb-6 rounded-lg overflow-hidden border shadow-md ${isJetstone ? 'border-green-200/50 shadow-green-100' : 'border-indigo-500/30 shadow-indigo-500/10'}`}>
                {/* Custom AI dashboard visualization */}
                <div className={`absolute inset-0 flex items-center justify-center ${isJetstone ? 'bg-gradient-to-br from-green-800 to-emerald-900' : 'bg-gradient-to-br from-blue-900/60 to-purple-900/60'}`}>
                  <svg className="w-full h-full absolute opacity-20 z-10" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="20" cy="50" r="3" fill="#A5B4FC" />
                    <circle cx="80" cy="30" r="3" fill="#A5B4FC" />
                    <circle cx="80" cy="70" r="3" fill="#A5B4FC" />
                    <circle cx="40" cy="30" r="2" fill="#A5B4FC" />
                    <circle cx="60" cy="30" r="2" fill="#A5B4FC" />
                    <circle cx="40" cy="70" r="2" fill="#A5B4FC" />
                    <circle cx="60" cy="70" r="2" fill="#A5B4FC" />
                    <circle cx="50" cy="50" r="4" fill="#C4B5FD" />
                    <path d="M20 50 L40 30" stroke="#A5B4FC" strokeWidth="0.5" />
                    <path d="M20 50 L40 70" stroke="#A5B4FC" strokeWidth="0.5" />
                    <path d="M80 30 L60 30" stroke="#A5B4FC" strokeWidth="0.5" />
                    <path d="M80 70 L60 70" stroke="#A5B4FC" strokeWidth="0.5" />
                    <path d="M50 50 L40 30" stroke="#C4B5FD" strokeWidth="0.5" />
                    <path d="M50 50 L60 30" stroke="#C4B5FD" strokeWidth="0.5" />
                    <path d="M50 50 L40 70" stroke="#C4B5FD" strokeWidth="0.5" />
                    <path d="M50 50 L60 70" stroke="#C4B5FD" strokeWidth="0.5" />
                  </svg>
                  
                  <div className="relative z-15 w-3/4 h-3/4 flex flex-col">
                    {/* Top panel - Candidate visualization */}
                    <div className={`flex-1 border backdrop-blur-sm rounded-md p-2 mb-2 ${isJetstone ? 'border-green-500/30 bg-green-900/60' : 'border-indigo-500/30 bg-blue-900/60'}`}>
                      <div className={`text-xs mb-1 font-semibold ${isJetstone ? 'text-green-200' : 'text-blue-200'}`}>Candidate Vector Analysis</div>
                      <div className="flex h-12">
                        {/* Animated skill match bars */}
                        {[85, 92, 78, 64, 89, 72].map((value, idx) => (
                          <motion.div 
                            key={idx}
                            className={`w-3 h-full mx-0.5 rounded-sm opacity-80 ${isJetstone ? 'bg-gradient-to-t from-green-500 to-amber-400' : 'bg-gradient-to-t from-blue-600 to-indigo-400'}`}
                            initial={{ height: 0 }}
                            animate={{ height: `${value}%` }}
                            transition={{ 
                              duration: 1,
                              delay: idx * 0.1,
                              ease: "easeOut" 
                            }}
                          />
                        ))}
                      </div>
                    </div>
                    
                    {/* Bottom panel - Candidate cards */}
                    <div className="flex space-x-2 h-8">
                      {[...Array(3)].map((_, idx) => (
                        <motion.div 
                          key={idx}
                          className={`flex-1 border backdrop-blur-sm rounded-md p-1 flex items-center ${isJetstone ? 'border-green-500/30 bg-green-900/60' : 'border-indigo-500/30 bg-blue-900/60'}`}
                          initial={{ y: 20, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={{ 
                            duration: 0.5,
                            delay: 0.8 + (idx * 0.2)
                          }}
                        >
                          <div className={`w-3 h-3 rounded-full mr-1 ${isJetstone ? 'bg-green-400' : 'bg-indigo-400'}`}></div>
                          <div className={`h-1.5 w-full rounded-full ${isJetstone ? 'bg-green-400/30' : 'bg-indigo-400/30'}`}>
                            <motion.div 
                              className={`h-full rounded-full ${isJetstone ? 'bg-green-400' : 'bg-indigo-400'}`}
                              initial={{ width: "0%" }}
                              animate={{ width: `${90 - (idx * 15)}%` }}
                              transition={{ duration: 0.8, delay: 1 + (idx * 0.2) }}
                            />
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </div>
                
                <div className={`absolute inset-0 flex flex-col justify-end p-4 z-20 ${isJetstone ? 'bg-gradient-to-t from-green-950/90 to-transparent' : 'bg-gradient-to-t from-blue-900/80 to-transparent'}`}>
                  <div className="text-sm font-medium text-white">{isJetstone ? 'Smart Screening Dashboard' : 'Advanced AI Dashboard'}</div>
                  <div className={`text-xs font-medium inline-block px-2 py-0.5 rounded relative z-30 ${isJetstone ? 'text-green-200 bg-green-900/70' : 'text-blue-300 bg-blue-900/70'}`}>Vector-based candidate matching</div>
                </div>
              </div>

              <ul className="space-y-3 mb-6">
                {[
                  "Semantic understanding of resumes and job descriptions",
                  "Vector search finds candidates based on relevance, not keywords",
                  "AI-powered skill gap analysis and growth potential assessment",
                  "Eliminates bias through anonymized initial screening",
                  "Learns from hiring decisions to continuously improve matches"
                ].map((feature, index) => (
                  <motion.li 
                    key={index} 
                    className="flex items-start"
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.2 + (index * 0.1) }}
                  >
                    <Check className={`w-5 h-5 mt-0.5 mr-3 flex-shrink-0 ${isJetstone ? 'text-green-600' : 'text-green-400'}`} />
                    <span className={`text-sm ${isJetstone ? 'text-slate-700' : 'text-white'}`}>{feature}</span>
                  </motion.li>
                ))}
              </ul>

              <div className={`rounded-lg p-4 border ${isJetstone ? 'bg-green-100/50 border-green-200' : 'bg-blue-500/10 border-blue-500/20'}`}>
                <div className={`font-medium mb-1 ${isJetstone ? 'text-green-800' : 'text-blue-300'}`}>Result:</div>
                <div className={isJetstone ? 'text-slate-700' : 'text-white'}>Better candidates, faster hiring, lower costs</div>
              </div>
            </motion.div>

            {/* Traditional ATS side */}
            <motion.div 
              className={`flex-1 p-8 relative ${isJetstone ? 'bg-slate-50' : 'bg-slate-900/80'}`}
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
            >
              {/* Custom background pattern */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <svg className="absolute top-0 left-0 w-full h-full opacity-5" width="100%" height="100%">
                  <pattern id="grid-pattern" width="20" height="20" patternUnits="userSpaceOnUse">
                    <rect width="20" height="20" fill="none" />
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="white" strokeWidth="0.5" />
                  </pattern>
                  <rect width="100%" height="100%" fill="url(#grid-pattern)" />
                </svg>
                
                <svg className="absolute -bottom-10 -right-10 w-60 h-60 opacity-5" viewBox="0 0 100 100">
                  <rect x="10" y="10" width="80" height="80" fill="none" stroke="#9CA3AF" strokeWidth="0.5" />
                  <rect x="15" y="15" width="70" height="70" fill="none" stroke="#9CA3AF" strokeWidth="0.5" />
                  <rect x="20" y="20" width="60" height="60" fill="none" stroke="#9CA3AF" strokeWidth="0.5" />
                  <rect x="25" y="25" width="50" height="50" fill="none" stroke="#9CA3AF" strokeWidth="0.5" />
                </svg>
              </div>
              
              <div className="flex items-center mb-6 relative z-10">
                <div className="w-10 h-10 bg-slate-700 rounded-lg flex items-center justify-center shadow-lg mr-3 border border-slate-600/50">
                  <span className="font-medium text-slate-300 text-sm">ATS</span>
                </div>
                <h3 className="text-xl font-bold text-slate-300">Traditional ATS</h3>
                <div className="ml-auto bg-slate-700 text-slate-400 px-3 py-1 rounded-full text-sm font-medium border border-slate-600/50">
                  Legacy System
                </div>
              </div>

              <div className="relative h-52 mb-6 rounded-lg overflow-hidden border border-slate-700/50 shadow-md shadow-slate-900/70">
                {/* Custom legacy interface illustration */}
                <div className="absolute inset-0 bg-slate-800 flex flex-col">
                  {/* Toolbar */}
                  <div className="h-8 bg-slate-700 border-b border-slate-600 flex items-center px-3">
                    <div className="w-3 h-3 rounded-full bg-slate-500 mr-2"></div>
                    <div className="w-3 h-3 rounded-full bg-slate-500 mr-2"></div>
                    <div className="w-3 h-3 rounded-full bg-slate-500"></div>
                    <div className="ml-auto text-xs text-slate-400">Traditional ATS v3.2</div>
                  </div>
                  
                  {/* Main interface */}
                  <div className="flex flex-1">
                    {/* Sidebar */}
                    <div className="w-1/4 bg-slate-750 border-r border-slate-700 p-2">
                      <div className="h-4 w-4/5 bg-slate-600 rounded mb-2"></div>
                      {[...Array(5)].map((_, idx) => (
                        <div key={idx} className="h-3 w-full bg-slate-600/70 rounded-sm mb-1.5"></div>
                      ))}
                    </div>
                    
                    {/* Content area */}
                    <div className="flex-1 p-2">
                      {/* Search bar */}
                      <div className="flex mb-3">
                        <div className="flex-1 h-6 bg-slate-700 rounded-l-md border border-slate-600"></div>
                        <div className="w-16 h-6 bg-slate-600 rounded-r-md border border-slate-600 flex items-center justify-center">
                          <div className="text-xs text-slate-400">Search</div>
                        </div>
                      </div>
                      
                      {/* Filter tags */}
                      <div className="flex flex-wrap gap-1 mb-3">
                        {['Java', 'Senior', '5+ Years'].map((tag, idx) => (
                          <motion.div 
                            key={idx} 
                            className="px-2 py-0.5 bg-slate-700 rounded-md border border-slate-600 text-xs flex items-center"
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: 0.5 + (idx * 0.1) }}
                          >
                            <span className="text-slate-300 text-xs">{tag}</span>
                            <div className="ml-1 w-3 h-3 rounded-full bg-slate-500 flex items-center justify-center">
                              <span className="text-slate-300 text-[8px]">×</span>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                      
                      {/* Results table */}
                      <div className="border border-slate-600 rounded-sm">
                        {/* Table header */}
                        <div className="h-6 bg-slate-700 border-b border-slate-600 flex px-2">
                          {['Name', 'Keywords', 'Match', 'Action'].map((col, idx) => (
                            <div key={idx} className="flex-1 text-xs text-slate-400 flex items-center">
                              {col}
                              {idx < 3 && <div className="ml-1 text-xs">▼</div>}
                            </div>
                          ))}
                        </div>
                        
                        {/* Table rows */}
                        {[...Array(3)].map((_, rowIdx) => (
                          <div 
                            key={rowIdx} 
                            className="h-7 flex items-center px-2 border-b border-slate-700"
                          >
                            <div className="flex-1 h-2.5 bg-slate-700 rounded-full w-4/5"></div>
                            <div className="flex-1 h-2.5 bg-slate-700 rounded-full w-3/4"></div>
                            <div className="flex-1 flex items-center">
                              <div className="w-full h-1.5 bg-slate-700 rounded-full">
                                <div 
                                  className="h-full rounded-full bg-slate-500" 
                                  style={{ width: `${70 - (rowIdx * 20)}%` }}
                                ></div>
                              </div>
                            </div>
                            <div className="flex-1 flex justify-end">
                              <div className="h-4 w-10 bg-slate-700 rounded"></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 to-slate-900/30 flex flex-col justify-end p-4">
                  <div className="text-sm font-medium text-slate-300">Basic Search Interface</div>
                  <div className="text-xs text-slate-400">Keyword-based filtering</div>
                </div>
              </div>

              <ul className="space-y-3 mb-6">
                {[
                  "Keyword matching misses qualified candidates",
                  "Boolean search requires complex queries",
                  "No understanding of skills beyond exact matches",
                  "Bias amplification through rigid filtering",
                  "Static system that doesn't learn or improve"
                ].map((limitation, index) => (
                  <motion.li 
                    key={index} 
                    className="flex items-start"
                    initial={{ opacity: 0, x: 20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.2 + (index * 0.1) }}
                  >
                    <X className="w-5 h-5 text-red-400 mt-0.5 mr-3 flex-shrink-0" />
                    <span className="text-slate-400 text-sm">{limitation}</span>
                  </motion.li>
                ))}
              </ul>

              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
                <div className="font-medium text-slate-400 mb-1">Result:</div>
                <div className="text-slate-300">Missed talent, longer time-to-hire, higher costs</div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Detailed comparison points */}
      <div className="space-y-8 mt-16">
        <h3 className="text-2xl font-bold text-center mb-8">Feature by Feature Comparison</h3>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {comparisonPoints.map((point, idx) => (
            <motion.div 
              key={idx}
              className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 overflow-hidden relative"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.1 }}
            >
              {/* Enhanced header with custom graphic */}
              <div className="p-4 relative">
                <div className="absolute inset-0 overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 to-purple-600/5"></div>
                  <svg className="absolute top-0 right-0 h-full opacity-10" width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                    <defs>
                      <linearGradient id={`gradTitle${idx}`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#60A5FA" />
                        <stop offset="100%" stopColor="#C4B5FD" />
                      </linearGradient>
                    </defs>
                    {/* Custom graphic based on comparison point */}
                    {idx === 0 && ( // Resume Analysis
                      <g stroke="url(#gradTitle0)" fill="none" strokeWidth="1">
                        <rect x="15" y="20" width="70" height="60" rx="2" />
                        <path d="M25 35 L65 35 M25 45 L55 45 M25 55 L60 55 M25 65 L45 65" strokeWidth="2" />
                        <circle cx="75" cy="35" r="15" strokeDasharray="2 1" />
                      </g>
                    )}
                    {idx === 1 && ( // Candidate Search
                      <g stroke="url(#gradTitle1)" fill="none" strokeWidth="1">
                        <circle cx="35" cy="35" r="20" />
                        <path d="M50 50 L65 65" strokeWidth="3" />
                        <path d="M20 35 L50 35 M35 20 L35 50" strokeWidth="1" strokeDasharray="1 1" />
                      </g>
                    )}
                    {idx === 2 && ( // Matching Algorithm
                      <g stroke="url(#gradTitle2)" fill="none" strokeWidth="1">
                        <path d="M20 50 L80 50" strokeDasharray="2 1" />
                        <circle cx="30" cy="30" r="10" />
                        <circle cx="50" cy="50" r="15" />
                        <circle cx="70" cy="30" r="10" />
                        <path d="M30 30 L50 50 L70 30" />
                      </g>
                    )}
                    {idx === 3 && ( // Processing Speed
                      <g stroke="url(#gradTitle3)" fill="none" strokeWidth="1">
                        <path d="M50 20 L50 80" />
                        <path d="M20 50 L80 50" />
                        <path d="M30 30 L70 70" strokeDasharray="2 1" />
                        <path d="M30 70 L70 30" strokeDasharray="2 1" />
                        <circle cx="50" cy="50" r="25" />
                      </g>
                    )}
                  </svg>
                </div>
                <h4 className="text-lg font-semibold relative z-10">{point.title}</h4>
              </div>
              
              <div className="grid grid-cols-2 divide-x divide-white/10">
                {/* SmartHR Side - Enhanced */}
                <div className="p-4 space-y-3 relative">
                  {/* Subtle background pattern */}
                  <div className="absolute inset-0 opacity-5">
                    <svg width="100%" height="100%">
                      <pattern id={`dotPattern${idx}a`} x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
                        <circle cx="2" cy="2" r="1" fill="white" />
                      </pattern>
                      <rect width="100%" height="100%" fill={`url(#dotPattern${idx}a)`} />
                    </svg>
                  </div>
                  
                  <div className="flex items-start relative z-10">
                    <div className="p-2 rounded-lg mr-3 relative">
                      {/* Custom animated icon container */}
                      <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-green-500/20 to-blue-500/20 backdrop-blur-sm"></div>
                      <motion.div
                        className="absolute inset-0 rounded-lg bg-gradient-to-br from-green-400/10 to-blue-400/10"
                        animate={{ 
                          opacity: [0.5, 0.8, 0.5],
                          scale: [1, 1.05, 1]
                        }}
                        transition={{
                          duration: 3,
                          repeat: Infinity,
                          repeatType: "reverse"
                        }}
                      />
                      <div className="relative">
                        {point.smarthr.icon}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-white">{point.smarthr.feature}</div>
                      <div className="text-xs text-slate-300 mt-1">{point.smarthr.description}</div>
                    </div>
                  </div>
                </div>
                
                {/* Traditional ATS Side - Enhanced */}
                <div className="p-4 space-y-3 bg-slate-900/30 relative">
                  {/* Grid background pattern */}
                  <div className="absolute inset-0 opacity-5">
                    <svg width="100%" height="100%">
                      <pattern id={`gridPattern${idx}`} width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="white" strokeWidth="0.5" />
                      </pattern>
                      <rect width="100%" height="100%" fill={`url(#gridPattern${idx})`} />
                    </svg>
                  </div>
                  
                  <div className="flex items-start relative z-10">
                    <div className="p-2 rounded-lg mr-3 relative">
                      {/* Custom icon container */}
                      <div className="absolute inset-0 rounded-lg bg-red-500/10 border border-red-500/20"></div>
                      <div className="relative">
                        {point.traditional.icon}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-slate-300">{point.traditional.feature}</div>
                      <div className="text-xs text-slate-400 mt-1">{point.traditional.description}</div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
