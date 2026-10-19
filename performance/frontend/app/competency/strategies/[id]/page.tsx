'use client';
import { useParams } from 'next/navigation';
import FrameworkEditor from '@/components/competency/library/FrameworkEditor';
export default function Page() { const { id } = useParams<{
    id: string;
}>(); return <FrameworkEditor recordId={id} strategy/>; }
