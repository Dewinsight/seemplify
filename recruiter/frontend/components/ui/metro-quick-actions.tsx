"use client";

import React from "react";
import { useUser } from "@/context/UserContext";
import interviewService from "@/services/interviewService";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
	Users,
	Briefcase,
	Calendar,
	Settings,
	Upload,
	UserPlus,
	Clock,
	TrendingUp,
} from "lucide-react";
import "@/styles/metro-layout.css";
import { useFeatureFlags } from "@/context/FeatureFlagsContext";

interface MetroAction {
	id: string;
	title: string;
	subtitle?: string;
	href: string;
	icon: React.ReactNode;
	color: string;
	bgPattern?: string;
	size?: "small" | "medium" | "large" | "wide" | "tall";
	stats?: {
		value: string;
		label: string;
		trend?: "up" | "down";
	};
}

interface MetroQuickActionsProps {
	className?: string;
	compact?: boolean;
}

// Metro tile size mapping
const getSizeClass = (size: string) => {
	switch (size) {
		case "small":
			return "metro-tile-small";
		case "medium":
			return "metro-tile-medium";
		case "large":
			return "metro-tile-large";
		case "wide":
			return "metro-tile-wide";
		case "tall":
			return "metro-tile-tall";
		default:
			return "metro-tile-small";
	}
};

export function MetroQuickActions({ className, compact = false }: MetroQuickActionsProps) {
	const { state } = useUser();
	const { isFeatureEnabled } = useFeatureFlags();
	const { analytics } = state;
	const [todayInterviews, setTodayInterviews] = React.useState<number>(0);

	React.useEffect(() => {
		// Fetch today's interviews count
		const start = new Date();
		start.setHours(0, 0, 0, 0);
		const end = new Date();
		end.setHours(23, 59, 59, 999);
		interviewService
			.getInterviews({ startDate: start.toISOString(), endDate: end.toISOString() })
			.then((list) => setTodayInterviews(list.length))
			.catch(() => setTodayInterviews(0));
	}, []);

	const allActions: MetroAction[] = [
		{
			id: "candidates",
			title: "Candidates",
			subtitle: "Manage talent pipeline",
			href: "/candidates",
			icon: <Users />,
			color: "metro-tile-indigo",
			bgPattern: "dots",
			size: "large",
			stats: {
				value: String(analytics?.overview?.totalCandidates?.value ?? 0),
				label: "Total",
				trend: "up"
			}
		},
		{
			id: "jobs",
			title: "Jobs",
			subtitle: "Open positions",
			href: "/jobs",
			icon: <Briefcase />,
			color: "metro-tile-teal",
			size: "wide",
			stats: {
				value: String(analytics?.overview?.activeJobs?.value ?? 0),
				label: "Active"
			}
		},
		{
			id: "interviews",
			title: "Interviews",
			subtitle: "Today's schedule",
			href: "/calendar",
			icon: <Calendar />,
			color: "metro-tile-slate",
			bgPattern: "grid",
			size: "wide",
			stats: {
				value: String(todayInterviews),
				label: "Today"
			}
		},
		{
			id: "new-job",
			title: "Post Job",
			subtitle: "Create new position",
			href: "/jobs/new",
			icon: <UserPlus />,
			color: "metro-tile-indigo",
			size: "small",
		},
		{
			id: "uploads",
			title: "Bulk Upload",
			subtitle: "Import CVs",
			href: "/bulk-upload",
			icon: <Upload />,
			color: "metro-tile-teal",
			size: "small",
		},
		{
			id: "settings",
			title: "Settings",
			subtitle: "Configure",
			href: "/settings",
			icon: <Settings />,
			color: "metro-tile-slate",
			bgPattern: "lines",
			size: "wide",
		},
	];
	const actions = allActions.filter(
		(action) => action.id !== "uploads" || isFeatureEnabled('bulkCvUpload')
	);

	// Background pattern class mapping
	const getBackgroundPatternClass = (pattern?: string) => {
		switch (pattern) {
			case "dots":
				return "metro-tile-pattern-dots";
			case "grid":
				return "metro-tile-pattern-grid";
			case "lines":
				return "metro-tile-pattern-lines";
			default:
				return "";
		}
	};

	return (
		<div className={cn("metro-container", className)} data-tutorial="dashboard-quick-actions-inner">
			{actions.map((action, index) => (
				<Link
					key={action.id}
					href={action.href}
					className={cn(
						"metro-tile",
						getSizeClass(action.size || "small"),
						action.color,
						"metro-tile-animate"
					)}
					style={{
						animationDelay: `${index * 50}ms`
					}}
				>
					{/* Background pattern */}
					{action.bgPattern && (
						<div className={cn("metro-tile-pattern", getBackgroundPatternClass(action.bgPattern))} />
					)}

					{/* Gradient overlay */}
					<div className="metro-tile-overlay" />

					{/* Content */}
					<div className="metro-tile-content">
						{/* Header with icon and stats */}
						<div className="metro-tile-header">
							<div className="metro-tile-icon">
								<div className={action.size === "large" ? "h-8 w-8" : "h-6 w-6"}>
									{action.icon}
								</div>
							</div>
							
							{action.stats && (
								<div className="metro-tile-stats">
									<div className="metro-tile-stats-value">
										<span>{action.stats.value}</span>
										{action.stats.trend && (
											<TrendingUp 
												className={cn(
													"h-4 w-4",
													action.stats.trend === "up" ? "metro-trend-up" : "metro-trend-down"
												)} 
											/>
										)}
									</div>
									<div className="metro-tile-stats-label">{action.stats.label}</div>
								</div>
							)}
						</div>

						{/* Footer with title and subtitle */}
						<div className="metro-tile-footer">
							<div className="metro-tile-title">
								{action.title}
							</div>
							{action.subtitle && (
								<div className="metro-tile-subtitle">
									{action.subtitle}
								</div>
							)}
						</div>
					</div>

					{/* Hover effects */}
					<div className="metro-tile-shine" />
					<div className="metro-tile-glow" />
				</Link>
			))}
		</div>
	);
}
