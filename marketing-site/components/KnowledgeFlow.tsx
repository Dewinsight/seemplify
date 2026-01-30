'use client'

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

// Icons
const DraftIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
)

const CollabIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
    </svg>
)

const CloudIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
    </svg>
)

const GlobeIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
)

const KnowledgeNode = ({ data }: { data: { label: string; subtext: string; color: string; icon: React.ReactNode } }) => {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className={`px-5 py-3.5 rounded-xl border ${data.color} bg-white dark:bg-zinc-900/90 backdrop-blur min-w-[140px] shadow-sm dark:shadow-none`}
        >
            <div className="flex items-center gap-3">
                <div className="text-zinc-500 dark:text-zinc-400 p-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-lg">{data.icon}</div>
                <div>
                    <div className="font-medium text-zinc-900 dark:text-white text-sm">{data.label}</div>
                    <div className="text-xs text-zinc-500">{data.subtext}</div>
                </div>
            </div>
        </motion.div>
    )
}

const nodeTypes = {
    knowledge: KnowledgeNode,
}

const initialNodes: Node[] = [
    {
        id: '1',
        type: 'knowledge',
        position: { x: 0, y: 80 },
        data: { label: 'Draft', subtext: 'Private mode', color: 'border-zinc-200 dark:border-zinc-700', icon: <DraftIcon /> },
    },
    {
        id: '2',
        type: 'knowledge',
        position: { x: 200, y: 80 },
        data: { label: 'Collaborate', subtext: 'Multi-player', color: 'border-zinc-200 dark:border-zinc-700', icon: <CollabIcon /> },
    },
    {
        id: '3',
        type: 'knowledge',
        position: { x: 400, y: 80 },
        data: { label: 'Approve', subtext: 'Version lock', color: 'border-zinc-200 dark:border-zinc-700', icon: <CloudIcon /> },
    },
    {
        id: '4',
        type: 'knowledge',
        position: { x: 600, y: 80 },
        data: { label: 'Publish', subtext: 'Team accessible', color: 'border-blue-300 dark:border-blue-800/50', icon: <GlobeIcon /> },
    },
]

// Animated edges with blue color
const initialEdges: Edge[] = [
    { id: 'e1-2', source: '1', target: '2', animated: true, style: { stroke: '#3b82f6', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6', width: 16, height: 16 } },
    { id: 'e2-3', source: '2', target: '3', animated: true, style: { stroke: '#3b82f6', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6', width: 16, height: 16 } },
    { id: 'e3-4', source: '3', target: '4', animated: true, style: { stroke: '#3b82f6', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6', width: 16, height: 16 } },
]

export default function KnowledgeFlow() {
    const [nodes] = useNodesState(initialNodes)
    const [edges] = useEdgesState(initialEdges)

    return (
        <div className="w-full h-[220px] rounded-xl overflow-hidden bg-white/80 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800/60">
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
                <Background color="#3b82f6" gap={30} size={1} className="opacity-10" />
            </ReactFlow>
        </div>
    )
}
