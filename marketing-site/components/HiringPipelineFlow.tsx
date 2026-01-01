'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { motion } from 'framer-motion'

// Custom node component for pipeline stages
const PipelineNode = ({ data }: { data: { label: string; count: number; color: string; icon: React.ReactNode } }) => {
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`px-6 py-4 rounded-xl border-2 ${data.color} bg-slate-900/90 backdrop-blur shadow-xl min-w-[140px]`}
    >
      <div className="flex items-center gap-3">
        <div className="text-2xl">{data.icon}</div>
        <div>
          <div className="font-bold text-white text-sm">{data.label}</div>
          <div className="text-xs text-slate-400">{data.count} candidates</div>
        </div>
      </div>
    </motion.div>
  )
}

// Animated candidate dot moving through pipeline
const AnimatedCandidate = () => {
  const [position, setPosition] = useState(0)
  
  useEffect(() => {
    const interval = setInterval(() => {
      setPosition(prev => (prev + 1) % 5)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const positions = [
    { x: 80, y: 100 },
    { x: 280, y: 100 },
    { x: 480, y: 100 },
    { x: 680, y: 100 },
    { x: 880, y: 100 },
  ]

  return (
    <motion.div
      className="absolute w-4 h-4 rounded-full bg-gradient-to-r from-green-400 to-emerald-500 shadow-lg shadow-green-500/50"
      animate={{ 
        x: positions[position].x, 
        y: positions[position].y,
        scale: [1, 1.2, 1],
      }}
      transition={{ duration: 0.8, ease: "easeInOut" }}
    />
  )
}

const nodeTypes = {
  pipeline: PipelineNode,
}

const initialNodes: Node[] = [
  {
    id: '1',
    type: 'pipeline',
    position: { x: 0, y: 80 },
    data: { label: 'Applied', count: 156, color: 'border-blue-500/50', icon: '📥' },
  },
  {
    id: '2',
    type: 'pipeline',
    position: { x: 200, y: 80 },
    data: { label: 'Screening', count: 48, color: 'border-purple-500/50', icon: '🔍' },
  },
  {
    id: '3',
    type: 'pipeline',
    position: { x: 400, y: 80 },
    data: { label: 'Interview', count: 24, color: 'border-amber-500/50', icon: '💬' },
  },
  {
    id: '4',
    type: 'pipeline',
    position: { x: 600, y: 80 },
    data: { label: 'Offer', count: 8, color: 'border-green-500/50', icon: '📋' },
  },
  {
    id: '5',
    type: 'pipeline',
    position: { x: 800, y: 80 },
    data: { label: 'Hired', count: 5, color: 'border-emerald-500/50', icon: '🎉' },
  },
]

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', animated: true, style: { stroke: '#6366f1', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' } },
  { id: 'e2-3', source: '2', target: '3', animated: true, style: { stroke: '#a855f7', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#a855f7' } },
  { id: 'e3-4', source: '3', target: '4', animated: true, style: { stroke: '#f59e0b', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' } },
  { id: 'e4-5', source: '4', target: '5', animated: true, style: { stroke: '#10b981', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' } },
]

export default function HiringPipelineFlow() {
  const [nodes] = useNodesState(initialNodes)
  const [edges] = useEdgesState(initialEdges)

  return (
    <div className="w-full h-[250px] rounded-2xl overflow-hidden bg-slate-900/50 border border-white/10 relative">
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
        <Background color="#334155" gap={20} size={1} />
      </ReactFlow>
    </div>
  )
}
