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

// Icon components for professional look
const InboxIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z" />
  </svg>
)

const SearchIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
  </svg>
)

const ChatIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
  </svg>
)

const DocumentIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
)

const CheckCircleIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

// Custom node component for pipeline stages
const PipelineNode = ({ data }: { data: { label: string; count: number; color: string; icon: React.ReactNode } }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`px-5 py-3.5 rounded-xl border ${data.color} bg-zinc-900/90 backdrop-blur min-w-[130px]`}
    >
      <div className="flex items-center gap-3">
        <div className="text-zinc-400">{data.icon}</div>
        <div>
          <div className="font-medium text-white text-sm">{data.label}</div>
          <div className="text-xs text-zinc-500">{data.count} candidates</div>
        </div>
      </div>
    </motion.div>
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
    data: { label: 'Applied', count: 156, color: 'border-zinc-700', icon: <InboxIcon /> },
  },
  {
    id: '2',
    type: 'pipeline',
    position: { x: 180, y: 80 },
    data: { label: 'Screening', count: 48, color: 'border-zinc-700', icon: <SearchIcon /> },
  },
  {
    id: '3',
    type: 'pipeline',
    position: { x: 360, y: 80 },
    data: { label: 'Interview', count: 24, color: 'border-zinc-700', icon: <ChatIcon /> },
  },
  {
    id: '4',
    type: 'pipeline',
    position: { x: 540, y: 80 },
    data: { label: 'Offer', count: 8, color: 'border-zinc-700', icon: <DocumentIcon /> },
  },
  {
    id: '5',
    type: 'pipeline',
    position: { x: 720, y: 80 },
    data: { label: 'Hired', count: 5, color: 'border-emerald-800/50', icon: <CheckCircleIcon /> },
  },
]

const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', style: { stroke: '#3f3f46', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#3f3f46', width: 16, height: 16 } },
  { id: 'e2-3', source: '2', target: '3', style: { stroke: '#3f3f46', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#3f3f46', width: 16, height: 16 } },
  { id: 'e3-4', source: '3', target: '4', style: { stroke: '#3f3f46', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#3f3f46', width: 16, height: 16 } },
  { id: 'e4-5', source: '4', target: '5', style: { stroke: '#3f3f46', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#3f3f46', width: 16, height: 16 } },
]

export default function HiringPipelineFlow() {
  const [nodes] = useNodesState(initialNodes)
  const [edges] = useEdgesState(initialEdges)

  return (
    <div className="w-full h-[220px] rounded-xl overflow-hidden bg-zinc-900/40 border border-zinc-800/60">
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
        <Background color="#27272a" gap={24} size={1} />
      </ReactFlow>
    </div>
  )
}
