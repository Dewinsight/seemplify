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

const LeaveNode = ({ data }: { data: { label: string; sublabel: string; color: string; emoji: string; active?: boolean } }) => {
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`px-5 py-3 rounded-xl border-2 ${data.color} ${data.active ? 'ring-2 ring-green-400 ring-offset-2 ring-offset-slate-900' : ''} bg-slate-900/90 backdrop-blur shadow-xl`}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{data.emoji}</span>
        <div>
          <div className="font-bold text-white text-sm">{data.label}</div>
          <div className="text-xs text-slate-400">{data.sublabel}</div>
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
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const nodes: Node[] = [
    {
      id: '1',
      type: 'leave',
      position: { x: 0, y: 50 },
      data: { label: 'Request', sublabel: 'Submit Leave', color: 'border-blue-500/50', emoji: '📝', active: activeStep === 0 },
    },
    {
      id: '2',
      type: 'leave',
      position: { x: 180, y: 50 },
      data: { label: 'Review', sublabel: 'Manager', color: 'border-purple-500/50', emoji: '👀', active: activeStep === 1 },
    },
    {
      id: '3',
      type: 'leave',
      position: { x: 360, y: 50 },
      data: { label: 'Approve', sublabel: 'One Click', color: 'border-amber-500/50', emoji: '✅', active: activeStep === 2 },
    },
    {
      id: '4',
      type: 'leave',
      position: { x: 540, y: 50 },
      data: { label: 'Updated', sublabel: 'Calendar Synced', color: 'border-green-500/50', emoji: '📅', active: activeStep === 3 },
    },
  ]

  const edges: Edge[] = [
    { id: 'e1-2', source: '1', target: '2', animated: activeStep >= 1, style: { stroke: activeStep >= 1 ? '#22c55e' : '#475569', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: activeStep >= 1 ? '#22c55e' : '#475569' } },
    { id: 'e2-3', source: '2', target: '3', animated: activeStep >= 2, style: { stroke: activeStep >= 2 ? '#22c55e' : '#475569', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: activeStep >= 2 ? '#22c55e' : '#475569' } },
    { id: 'e3-4', source: '3', target: '4', animated: activeStep >= 3, style: { stroke: activeStep >= 3 ? '#22c55e' : '#475569', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: activeStep >= 3 ? '#22c55e' : '#475569' } },
  ]

  return (
    <div className="w-full h-[180px] rounded-2xl overflow-hidden bg-slate-900/50 border border-white/10">
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
        <Background color="#334155" gap={16} size={1} />
      </ReactFlow>
    </div>
  )
}
