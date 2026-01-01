'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, useScroll, useTransform, useInView } from 'framer-motion';
import { 
  FileUp, BrainCircuit, Filter, Calendar, Video, Mic,
  MessageSquareText, BarChart3, CheckCircle2, ArrowRight
} from 'lucide-react';
import Image from 'next/image';
import WorkflowStepCard from './WorkflowStepCard';
import WorkflowNode from './WorkflowNode';
import { ReactFlow, Controls, Background, MarkerType, Edge, Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export default function WorkflowSection() {
  // Intersection observer for section entrance animation
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-100px 0px" });
  
  // Get scroll progress for this section to animate the connection line with improved sensitivity
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start 95%", "85% end"]
  });
  
  // Calculate the path drawing progress based on scroll position - improved range to show full path
  const pathLength = useTransform(scrollYProgress, [0.05, 0.8], [0, 1]);
  
  // Define node types for ReactFlow
  const nodeTypes = useMemo(() => ({ workflowNode: WorkflowNode }), []);
  
  // Define the workflow steps
  const workflowSteps = [
    {
      id: 1,
      title: "Candidate Sourcing",
      description: "Upload CVs or receive job applications from candidates",
      icon: <FileUp className="w-8 h-8" />,
      color: "blue",
      features: [
        { text: "AI-powered CV parsing", icon: "brain" },
        { text: "Bulk CV upload capability", icon: "files" },
        { text: "Candidate job portal applications", icon: "portal" }
      ],
      image: "/workflow/cv-upload.png",
    },
    {
      id: 2,
      title: "AI Matching & Analysis",
      description: "Find the best candidate matches with vector search technology",
      icon: <BrainCircuit className="w-8 h-8" />,
      color: "purple",
      features: [
        { text: "Vector search technology", icon: "search" },
        { text: "Skill gap analysis", icon: "skills" },
        { text: "Top candidate identification", icon: "rank" }
      ],
      image: "/workflow/ai-matching.png",
    },
    {
      id: 3,
      title: "Pipeline & Shortlisting",
      description: "Create interview stages and shortlist qualified candidates",
      icon: <Filter className="w-8 h-8" />,
      color: "indigo",
      features: [
        { text: "Custom pipeline stages", icon: "pipeline" },
        { text: "Candidate shortlisting", icon: "shortlist" },
        { text: "Automated stage progression", icon: "automation" }
      ],
      image: "/workflow/pipeline.png",
    },
    {
      id: 4,
      title: "Interview Scheduling",
      description: "Schedule and manage interviews across teams and platforms",
      icon: <Calendar className="w-8 h-8" />,
      color: "cyan",
      features: [
        { text: "Calendar integration", icon: "calendar" },
        { text: "Google Meet & MS Teams", icon: "meet" },
        { text: "Automated scheduling", icon: "auto" }
      ],
      image: "/workflow/scheduling.png",
    },
    {
      id: 5,
      title: "AI Interview Assistance",
      description: "Get real-time transcription, notes, and suggested questions",
      icon: <Mic className="w-8 h-8" />,
      color: "emerald",
      features: [
        { text: "AI Notetaker transcription", icon: "notes" },
        { text: "Generated interview questions", icon: "questions" },
        { text: "Real-time analysis", icon: "analysis" }
      ],
      image: "/workflow/ai-notetaker.png",
    },
    {
      id: 6,
      title: "Feedback Collection",
      description: "Gather and analyze standardized interviewer feedback",
      icon: <MessageSquareText className="w-8 h-8" />,
      color: "amber",
      features: [
        { text: "Structured feedback forms", icon: "form" },
        { text: "Automated distribution", icon: "distribute" },
        { text: "Feedback aggregation", icon: "aggregate" }
      ],
      image: "/workflow/feedback.png",
    },
    {
      id: 7,
      title: "Decision & Onboarding",
      description: "Compare candidates, make hiring decisions, and onboard",
      icon: <CheckCircle2 className="w-8 h-8" />,
      color: "green",
      features: [
        { text: "Analytics dashboard", icon: "dashboard" },
        { text: "Candidate comparison", icon: "compare" },
        { text: "Onboarding process", icon: "onboard" }
      ],
      image: "/workflow/decision.png",
    },
  ];
  
  // Create ReactFlow nodes from workflow steps with improved positioning
  const nodes: Node[] = useMemo(() => 
    workflowSteps.map((step, idx) => ({
      id: `step-${step.id}`,
      type: 'workflowNode',
      position: { 
        x: idx % 2 === 0 ? 50 : 550,  // Zigzag layout: alternating left/right with more spacing
        y: idx * 320  // Vertical spacing between steps (increased for demo UIs)
      },
      data: step,
      draggable: false,
      selectable: false,
    })),
    []
  );
  
  // Create ReactFlow edges to connect the steps
  const edges: Edge[] = useMemo(() => 
    workflowSteps.slice(0, -1).map((step, idx) => ({
      id: `edge-${idx}`,
      source: `step-${step.id}`,
      target: `step-${workflowSteps[idx + 1].id}`,
      type: 'smoothstep',
      animated: true,
      style: {
        strokeWidth: 3,
        stroke: `rgba(139, 92, 246, 0.6)`, // Purple color
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 20,
        height: 20,
        color: '#8B5CF6',
      },
    })),
    [workflowSteps]
  );

  return (
    <section 
      ref={sectionRef} 
      className="relative z-10 container mx-auto px-4 py-16 sm:py-20 lg:py-24 overflow-hidden"
    >
      {/* Background decoration */}
      <div className="absolute top-1/3 right-0 w-full max-w-[400px] aspect-square bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 left-0 w-full max-w-[300px] aspect-square bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* Section header */}
      <motion.div 
        className="text-center mb-10 sm:mb-16 lg:mb-20"
        initial={{ opacity: 0, y: 20 }}
        animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.6 }}
      >
        <span className="inline-flex items-center px-2.5 sm:px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-xs sm:text-sm font-medium mb-3 sm:mb-4">
          Complete Workflow
        </span>
        <h2 className="text-2xl sm:text-3xl md:text-5xl font-bold mb-4 sm:mb-6 bg-clip-text text-transparent bg-gradient-to-r from-white to-blue-200">
          Streamlined Hiring Journey
        </h2>
        <p className="text-slate-300 text-base sm:text-lg max-w-3xl mx-auto">
          Experience a seamless end-to-end recruitment process, from candidate sourcing 
          to onboarding, powered by advanced AI at every step.
        </p>
      </motion.div>

      {/* Workflow visualization - Desktop version with ReactFlow */}
      <div className="hidden lg:block relative mb-12 w-full" style={{ height: '2400px' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView={false}
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          panOnScroll={false}
          className="workflow-reactflow"
          proOptions={{ hideAttribution: true }}
          defaultViewport={{ x: 100, y: 0, zoom: 1 }}
        >
          <Background color="#8B5CF6" gap={16} size={1} className="opacity-10" />
          <svg>
            <defs>
              <linearGradient id="edge-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#3B82F6" />
                <stop offset="50%" stopColor="#8B5CF6" />
                <stop offset="100%" stopColor="#10B981" />
              </linearGradient>
            </defs>
          </svg>
        </ReactFlow>
      </div>

      {/* Workflow visualization - Mobile & Tablet version */}
      <div className="lg:hidden">
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-500 via-purple-500 to-green-500 opacity-30"></div>
          
          <div className="space-y-12 pl-12">
            {workflowSteps.map((step, idx) => (
              <div key={step.id} className="relative">
                <div className="absolute left-[-36px] top-2 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold">
                  {step.id}
                </div>
                <WorkflowStepCard
                  step={step}
                  alignment="left"
                  index={idx}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
