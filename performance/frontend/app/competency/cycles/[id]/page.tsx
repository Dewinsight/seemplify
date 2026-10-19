'use client';
import { useParams } from 'next/navigation';
import CycleEditor from '@/components/competency/library/CycleEditor';
export default function Page() { const { id } = useParams<{
    id: string;
}>(); return <CycleEditor cycleId={id}/>; }
