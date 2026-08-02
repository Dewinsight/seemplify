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
const UserIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
)

const BrainIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z" />
    </svg>
)

const DataIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
    </svg>
)

const SparklesIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
)

const ChatNode = ({ data }: { data: { label: string; subtext: string; color: string; icon: React.ReactNode } }) => {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: "backOut" }}
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
    chat: ChatNode,
}

const initialNodes: Node[] = [
    {
        id: '1',
        type: 'chat',
        position: { x: 0, y: 80 },
        data: { label: 'Query', subtext: 'Natural language', color: 'border-zinc-200 dark:border-zinc-700', icon: <UserIcon /> },
    },
    {
        id: '2',
        type: 'chat',
        position: { x: 200, y: 80 },
        data: { label: 'LLM Processor', subtext: 'Intent analysis', color: 'border-zinc-200 dark:border-zinc-700', icon: <BrainIcon /> },
    },
    {
        id: '3',
        type: 'chat',
        position: { x: 400, y: 80 },
        data: { label: 'Retrieval', subtext: 'Internal docs', color: 'border-zinc-200 dark:border-zinc-700', icon: <DataIcon /> },
    },
    {
        id: '4',
        type: 'chat',
        position: { x: 600, y: 80 },
        data: { label: 'Response', subtext: 'Actionable insight', color: 'border-violet-300 dark:border-violet-800/50', icon: <SparklesIcon /> },
    },
]

// Animated edges with violet color
const initialEdges: Edge[] = [
    { id: 'e1-2', source: '1', target: '2', animated: true, style: { stroke: '#a78bfa', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#a78bfa', width: 16, height: 16 } },
    { id: 'e2-3', source: '2', target: '3', animated: true, style: { stroke: '#a78bfa', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#a78bfa', width: 16, height: 16 } },
    { id: 'e3-4', source: '3', target: '4', animated: true, style: { stroke: '#a78bfa', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#a78bfa', width: 16, height: 16 } },
]

export default function ChatFlow() {
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
                <Background color="#a78bfa" gap={30} size={1} className="opacity-10" />
            </ReactFlow>
        </div>
    )
}
