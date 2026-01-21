'use client'

import { useEffect, useState } from 'react'
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { motion } from 'framer-motion'

// Icon components
const PencilIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
  </svg>
)

const EyeIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)

const CheckIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
)

const CalendarIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
  </svg>
)

const LeaveNode = ({ data }: { data: { label: string; sublabel: string; color: string; icon: React.ReactNode; active?: boolean } }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`px-5 py-3.5 rounded-xl border ${data.color} ${data.active ? 'ring-1 ring-emerald-500/50 ring-offset-1 ring-offset-white dark:ring-offset-zinc-950' : ''} bg-white dark:bg-zinc-900/90 backdrop-blur transition-all duration-300 shadow-sm dark:shadow-none`}
    >
      <div className="flex items-center gap-3">
        <div className={`${data.active ? 'text-emerald-500 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'} transition-colors duration-300`}>{data.icon}</div>
        <div>
          <div className="font-medium text-zinc-900 dark:text-white text-sm">{data.label}</div>
          <div className="text-xs text-zinc-500">{data.sublabel}</div>
        </div>
      </div>
    </motion.div>
  )
}

const nodeTypes = {
  leave: LeaveNode,
}

export default function LeaveApprovalFlow() {
  const [activeStep, setActiveStep] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep(prev => (prev + 1) % 4)
    }, 2500)
    return () => clearInterval(interval)
  }, [])

  const nodes: Node[] = [
    {
      id: '1',
      type: 'leave',
      position: { x: 0, y: 50 },
      data: { label: 'Request', sublabel: 'Submit Leave', color: 'border-zinc-200 dark:border-zinc-700', icon: <PencilIcon />, active: activeStep === 0 },
    },
    {
      id: '2',
      type: 'leave',
      position: { x: 170, y: 50 },
      data: { label: 'Review', sublabel: 'Manager', color: 'border-zinc-200 dark:border-zinc-700', icon: <EyeIcon />, active: activeStep === 1 },
    },
    {
      id: '3',
      type: 'leave',
      position: { x: 340, y: 50 },
      data: { label: 'Approve', sublabel: 'One Click', color: 'border-zinc-200 dark:border-zinc-700', icon: <CheckIcon />, active: activeStep === 2 },
    },
    {
      id: '4',
      type: 'leave',
      position: { x: 510, y: 50 },
      data: { label: 'Synced', sublabel: 'Calendar Updated', color: 'border-zinc-200 dark:border-zinc-700', icon: <CalendarIcon />, active: activeStep === 3 },
    },
  ]

  const edges: Edge[] = [
    {
      id: 'e1-2',
      source: '1',
      target: '2',
      style: { stroke: activeStep >= 1 ? '#10b981' : '#3f3f46', strokeWidth: 1.5, transition: 'stroke 0.3s ease' },
      markerEnd: { type: MarkerType.ArrowClosed, color: activeStep >= 1 ? '#10b981' : '#3f3f46', width: 16, height: 16 }
    },
    {
      id: 'e2-3',
      source: '2',
      target: '3',
      style: { stroke: activeStep >= 2 ? '#10b981' : '#3f3f46', strokeWidth: 1.5, transition: 'stroke 0.3s ease' },
      markerEnd: { type: MarkerType.ArrowClosed, color: activeStep >= 2 ? '#10b981' : '#3f3f46', width: 16, height: 16 }
    },
    {
      id: 'e3-4',
      source: '3',
      target: '4',
      style: { stroke: activeStep >= 3 ? '#10b981' : '#3f3f46', strokeWidth: 1.5, transition: 'stroke 0.3s ease' },
      markerEnd: { type: MarkerType.ArrowClosed, color: activeStep >= 3 ? '#10b981' : '#3f3f46', width: 16, height: 16 }
    },
  ]

  return (
    <div className="w-full h-[160px] rounded-xl overflow-hidden bg-white/80 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800/60">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        preventScrolling={false}
        nodesDraggable={false}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#27272a" gap={20} size={1} />
      </ReactFlow>
    </div>
  )
}
