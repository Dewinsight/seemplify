'use client';
import { useParams } from 'next/navigation';
import RoleEditor from '@/components/competency/library/RoleEditor';
export default function Page() { const { id } = useParams<{
    id: string;
}>(); return <RoleEditor roleId={id}/>; }
