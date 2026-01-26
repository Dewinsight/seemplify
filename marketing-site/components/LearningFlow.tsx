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
const BookIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
)

const PlayIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
    </svg>
)

const QuizIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
    </svg>
)

const AwardIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-8.719c-.621 0-1.125.504-1.125 1.125v3.375m15 0h.008v.008H16.5v-.008zm-9.04-14.25C6.004 4.545 4.5 6.32 4.5 8.75c0 1.34.6 2.535 1.548 3.328A3.75 3.75 0 008.25 10.5h7.5a3.75 3.75 0 002.202 1.578c.948-.793 1.548-1.989 1.548-3.328 0-2.43-1.504-4.205-2.96-4.25" />
    </svg>
)

const LearningNode = ({ data }: { data: { label: string; subtext: string; color: string; icon: React.ReactNode } }) => {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: "backOut" }}
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
    learning: LearningNode,
}

const initialNodes: Node[] = [
    {
        id: '1',
        type: 'learning',
        position: { x: 0, y: 80 },
        data: { label: 'Enroll', subtext: 'Auto-assigned', color: 'border-zinc-200 dark:border-zinc-700', icon: <BookIcon /> },
    },
    {
        id: '2',
        type: 'learning',
        position: { x: 200, y: 80 },
        data: { label: 'Modules', subtext: 'Interactive video', color: 'border-zinc-200 dark:border-zinc-700', icon: <PlayIcon /> },
    },
    {
        id: '3',
        type: 'learning',
        position: { x: 400, y: 80 },
        data: { label: 'Assessment', subtext: '80% pass rate', color: 'border-zinc-200 dark:border-zinc-700', icon: <QuizIcon /> },
    },
    {
        id: '4',
        type: 'learning',
        position: { x: 600, y: 80 },
        data: { label: 'Certified', subtext: 'Compliance met', color: 'border-sky-300 dark:border-sky-800/50', icon: <AwardIcon /> },
    },
]

const initialEdges: Edge[] = [
    { id: 'e1-2', source: '1', target: '2', animated: true, style: { stroke: '#0ea5e9', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#0ea5e9', width: 16, height: 16 } },
    { id: 'e2-3', source: '2', target: '3', animated: true, style: { stroke: '#0ea5e9', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#0ea5e9', width: 16, height: 16 } },
    { id: 'e3-4', source: '3', target: '4', animated: true, style: { stroke: '#0ea5e9', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#0ea5e9', width: 16, height: 16 } },
]

export default function LearningFlow() {
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
                <Background color="#0ea5e9" gap={30} size={1} className="opacity-10" />
            </ReactFlow>
        </div>
    )
}
