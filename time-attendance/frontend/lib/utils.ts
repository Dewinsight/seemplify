import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h}h ${m}m`;
}

export function getStatusColor(status: string | undefined | null) {
    if (!status) {
        return 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20';
    }
    switch (status.toLowerCase()) {
        case 'approved':
            return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
        case 'pending':
            return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
        case 'rejected':
            return 'bg-red-500/10 text-red-500 border-red-500/20';
        case 'draft':
            return 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20';
        default:
            return 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20';
    }
}
