"use client";

import React from "react";
import Link from "next/link";
import {
	ArrowRight,
	Briefcase,
	Calendar,
	Settings,
	Upload,
	UserPlus,
	Users,
} from "lucide-react";
import { useUser } from "@/context/UserContext";
import { useFeatureFlags } from "@/context/FeatureFlagsContext";
import interviewService from "@/services/interviewService";
import { cn } from "@/lib/utils";
import "@/styles/metro-layout.css";

interface RecruiterAction {
	id: string;
	title: string;
	subtitle: string;
	href: string;
	icon: React.ElementType;
	stats?: {
		value: string;
		label: string;
	};
}

interface MetroQuickActionsProps {
	className?: string;
	compact?: boolean;
}

export function MetroQuickActions({ className, compact = false }: MetroQuickActionsProps) {
	const { state } = useUser();
	const { isFeatureEnabled } = useFeatureFlags();
	const { analytics } = state;
	const [todayInterviews, setTodayInterviews] = React.useState<number>(0);

	React.useEffect(() => {
		const start = new Date();
		start.setHours(0, 0, 0, 0);
		const end = new Date();
		end.setHours(23, 59, 59, 999);

		interviewService
			.getInterviews({ startDate: start.toISOString(), endDate: end.toISOString() })
			.then((list) => setTodayInterviews(list.length))
			.catch(() => setTodayInterviews(0));
	}, []);

	const primaryActions: RecruiterAction[] = [
		{
			id: "candidates",
			title: "Candidates",
			subtitle: "Manage talent pipeline",
			href: "/candidates",
			icon: Users,
			stats: {
				value: String(analytics?.overview?.totalCandidates?.value ?? 0),
				label: "Total candidates",
			},
		},
		{
			id: "jobs",
			title: "Jobs",
			subtitle: "Open positions",
			href: "/jobs",
			icon: Briefcase,
			stats: {
				value: String(analytics?.overview?.activeJobs?.value ?? 0),
				label: "Active jobs",
			},
		},
	];

	const supportingActions: RecruiterAction[] = [
		{
			id: "interviews",
			title: "Interviews",
			subtitle: "Today's schedule",
			href: "/calendar",
			icon: Calendar,
			stats: {
				value: String(todayInterviews),
				label: "Today",
			},
		},
		{
			id: "new-job",
			title: "Post job",
			subtitle: "Create new position",
			href: "/jobs/new",
			icon: UserPlus,
		},
		{
			id: "uploads",
			title: "Bulk upload",
			subtitle: "Import CVs",
			href: "/bulk-upload",
			icon: Upload,
		},
		{
			id: "settings",
			title: "Settings",
			subtitle: "Configure workspace",
			href: "/settings",
			icon: Settings,
		},
	].filter((action) => action.id !== "uploads" || isFeatureEnabled("bulkCvUpload"));

	return (
		<div
			className={cn(
				"recruiter-action-workspace",
				compact && "recruiter-action-workspace--compact",
				className
			)}
			role="group"
			aria-label="Recruitment workspace actions"
			data-tutorial="dashboard-quick-actions-inner"
		>
			<div className="recruiter-action-primary" aria-label="Primary recruitment areas">
				{primaryActions.map((action) => {
					const Icon = action.icon;

					return (
						<Link key={action.id} href={action.href} className="recruiter-action-card">
							<div className="recruiter-action-card-top">
								<span className="recruiter-action-icon" aria-hidden="true">
									<Icon />
								</span>
								<ArrowRight className="recruiter-action-arrow" aria-hidden="true" />
							</div>

							<div className="recruiter-action-card-copy">
								<h3>{action.title}</h3>
								<p>{action.subtitle}</p>
							</div>

							{action.stats && (
								<div className="recruiter-action-card-footer">
									<span className="recruiter-action-stat-value">{action.stats.value}</span>
									<span className="recruiter-action-stat-label">{action.stats.label}</span>
								</div>
							)}
						</Link>
					);
				})}
			</div>

			<nav className="recruiter-action-support" aria-label="Recruitment shortcuts">
				{supportingActions.map((action) => {
					const Icon = action.icon;

					return (
						<Link key={action.id} href={action.href} className="recruiter-action-row">
							<Icon className="recruiter-action-row-icon" aria-hidden="true" />
							<span className="recruiter-action-row-copy">
								<span className="recruiter-action-row-title">{action.title}</span>
								<span className="recruiter-action-row-subtitle">{action.subtitle}</span>
							</span>
							{action.stats ? (
								<span className="recruiter-action-row-stat" aria-label={`${action.stats.value} ${action.stats.label}`}>
									<strong>{action.stats.value}</strong>
									<span>{action.stats.label}</span>
								</span>
							) : (
								<ArrowRight className="recruiter-action-row-arrow" aria-hidden="true" />
							)}
						</Link>
					);
				})}
			</nav>
		</div>
	);
}
