import { cn, getStatusColor } from "@/lib/utils";

interface StatusBadgeProps {
    status?: string;
    className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
    const displayStatus = status || 'unknown';
    return (
        <span className={cn(
            "px-2.5 py-0.5 rounded-full text-xs font-medium border",
            getStatusColor(displayStatus),
            className
        )}>
            {displayStatus.charAt(0).toUpperCase() + displayStatus.slice(1)}
        </span>
    );
}
