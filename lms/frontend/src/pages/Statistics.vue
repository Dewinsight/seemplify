<template>
	<div class="">
		<header
			class="sticky top-0 z-10 flex items-center justify-between border-b bg-surface-white px-3 py-2.5 sm:px-5"
		>
			<Breadcrumbs class="h-7" :items="breadcrumbs" />
		</header>
		<div v-if="chartDetails.data" class="p-5">
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
				<Tooltip :text="__('Published Courses')">
					<NumberChart
						class="border rounded-md"
						:config="{ title: 'Courses', value: chartDetails.data.courses }"
					/>
				</Tooltip>
				<Tooltip :text="__('Active Members')">
					<NumberChart
						class="border rounded-md"
						:config="{ title: 'Signups', value: chartDetails.data.users }"
					/>
				</Tooltip>
				<Tooltip :text="__('Course Enrollments')">
					<NumberChart
						class="border rounded-md"
						:config="{
							title: 'Enrollments',
							value: chartDetails.data.enrollments,
						}"
					/>
				</Tooltip>
				<Tooltip :text="__('Course Completions')">
					<NumberChart
						class="border rounded-md"
						:config="{
							title: 'Completions',
							value: chartDetails.data.completions,
						}"
					/>
				</Tooltip>
				<Tooltip :text="__('Certified Members')">
					<NumberChart
						class="border rounded-md"
						:config="{
							title: 'Certifications',
							value: chartDetails.data.certifications,
						}"
					/>
				</Tooltip>
			</div>
			<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
				<div class="statistics-chart-card">
					<div class="statistics-chart-header">
						<h2>{{ __('Signups') }}</h2>
						<p>{{ __('Signups per day') }}</p>
					</div>
					<div v-if="hasSignupsChartData" class="statistics-chart-body">
						<AxisChart :config="signupsChartConfig" />
					</div>
					<div v-else class="statistics-empty-state">
						<p>{{ chartStatus(signupsChart, __('No signup activity yet.')) }}</p>
					</div>
				</div>
				<div class="statistics-chart-card">
					<div class="statistics-chart-header">
						<h2>{{ __('Enrollments') }}</h2>
						<p>{{ __('Enrollments per day') }}</p>
					</div>
					<div v-if="hasEnrollmentChartData" class="statistics-chart-body">
						<AxisChart :config="enrollmentChartConfig" />
					</div>
					<div v-else class="statistics-empty-state">
						<p>{{ chartStatus(enrollmentChart, __('No enrollment activity yet.')) }}</p>
					</div>
				</div>
				<div class="statistics-chart-card">
					<div class="statistics-chart-header">
						<h2>{{ __('Certifications') }}</h2>
						<p>{{ __('Certifications per day') }}</p>
					</div>
					<div v-if="hasCertificationChartData" class="statistics-chart-body">
						<AxisChart :config="certificationChartConfig" />
					</div>
					<div v-else class="statistics-empty-state">
						<p>
							{{
								chartStatus(
									certification,
									__('No certifications have been issued yet.')
								)
							}}
						</p>
					</div>
				</div>
				<div class="statistics-chart-card">
					<div class="statistics-chart-header">
						<h2>{{ __('Completions') }}</h2>
						<p>{{ __('Course Completion') }}</p>
					</div>
					<div v-if="hasCompletionData" class="statistics-completion-body">
						<div class="statistics-completion-donut" :style="completionDonutStyle">
							<div>
								<strong>{{ completedPercent }}%</strong>
								<span>{{ __('Completed') }}</span>
							</div>
						</div>
						<div class="statistics-completion-legend">
							<div
								v-for="row in completionRows"
								:key="row.label"
								class="statistics-completion-legend-item"
							>
								<span
									class="statistics-completion-dot"
									:style="{ backgroundColor: completionColor(row.label) }"
								/>
								<span>{{ completionLegendLabel(row) }}</span>
							</div>
						</div>
					</div>
					<div v-else class="statistics-empty-state">
						<p>{{ __('No completion data yet.') }}</p>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
<script setup>
import {
	AxisChart,
	Breadcrumbs,
	createResource,
	NumberChart,
	Tooltip,
	usePageMeta,
} from 'frappe-ui'
import { computed } from 'vue'
import { sessionStore } from '../stores/session'

const { brand } = sessionStore()

const breadcrumbs = computed(() => {
	return [
		{
			label: 'Statistics',
			route: {
				name: 'Statistics',
			},
		},
	]
})

const chartDetails = createResource({
	url: 'lms.lms.api.get_chart_details',
	cache: ['statistics'],
	auto: true,
})

const hasChartData = (resource) => {
	return Array.isArray(resource.data) && resource.data.length
}

const chartStatus = (resource, emptyMessage) => {
	if (resource.loading) return __('Loading chart...')
	if (resource.error) return __('Unable to load this chart.')
	return emptyMessage
}

const axisChartConfig = (data, valueKey, yAxisTitle) => {
	return {
		data: data || [],
		xAxis: {
			key: 'date',
			type: 'time',
			title: 'Date',
			timeGrain: 'day',
		},
		yAxis: {
			title: yAxisTitle,
		},
		series: [{ name: valueKey, type: 'line', showDataPoints: true }],
	}
}

const signupsChart = createResource({
	url: 'lms.lms.utils.get_chart_data',
	cache: ['statistics', 'signups'],
	params: {
		chart_name: 'New Signups',
	},
	auto: true,
	transform(data) {
		return data.map((item) => {
			return {
				date: new Date(item.date),
				signups: item.count,
			}
		})
	},
})

const hasSignupsChartData = computed(() => hasChartData(signupsChart))
const signupsChartConfig = computed(() =>
	axisChartConfig(signupsChart.data, 'signups', 'Signups')
)

const enrollmentChart = createResource({
	url: 'lms.lms.utils.get_chart_data',
	cache: ['statistics', 'enrollments'],
	params: {
		chart_name: 'Course Enrollments',
	},
	auto: true,
	transform(data) {
		return data.map((item) => {
			return {
				date: new Date(item.date),
				enrollments: item.count,
			}
		})
	},
})

const hasEnrollmentChartData = computed(() => hasChartData(enrollmentChart))
const enrollmentChartConfig = computed(() =>
	axisChartConfig(enrollmentChart.data, 'enrollments', 'Enrollments')
)

const certification = createResource({
	url: 'lms.lms.utils.get_chart_data',
	cache: ['statistics', 'certifications'],
	params: {
		chart_name: 'Certification',
	},
	auto: true,
	transform(data) {
		return data.map((item) => {
			return {
				date: new Date(item.date),
				certifications: item.count,
			}
		})
	},
})

const hasCertificationChartData = computed(() => hasChartData(certification))
const certificationChartConfig = computed(() =>
	axisChartConfig(certification.data, 'certifications', 'Certifications')
)

const courseCompletion = createResource({
	url: 'lms.lms.utils.get_course_completion_data',
	auto: true,
	cache: ['courseCompletion'],
})

const completionRows = computed(() => {
	return Array.isArray(courseCompletion.data) ? courseCompletion.data : []
})

const completionTotal = computed(() => {
	return completionRows.value.reduce((total, row) => {
		return total + Number(row.value || 0)
	}, 0)
})

const completedValue = computed(() => {
	const completed = completionRows.value.find((row) =>
		String(row.label || '')
			.toLowerCase()
			.includes('completed')
	)
	return Number(completed?.value || 0)
})

const hasCompletionData = computed(() => completionTotal.value > 0)

const completedPercent = computed(() => {
	if (!completionTotal.value) return 0
	return Math.round((completedValue.value / completionTotal.value) * 100)
})

const completionDonutStyle = computed(() => {
	return {
		'--completed-percent': `${completedPercent.value}%`,
	}
})

const completionColor = (label) => {
	return String(label || '')
		.toLowerCase()
		.includes('completed')
		? '#ffd85c'
		: '#37a2da'
}

const completionLegendLabel = (row) => {
	const value = Number(row.value || 0)
	const percent = completionTotal.value
		? Math.round((value / completionTotal.value) * 100)
		: 0
	return `${row.label} (${percent}%)`
}

usePageMeta(() => {
	return {
		title: __('Statistics'),
		icon: brand.favicon,
	}
})
</script>

<style scoped>
.statistics-chart-card {
	display: flex;
	height: 26rem;
	min-height: 0;
	flex-direction: column;
	border: 1px solid #d7e2f0;
	border-radius: 0.75rem;
	background: #ffffff;
	padding: 1.25rem;
	overflow: hidden;
	box-shadow: 0 12px 28px rgba(13, 44, 84, 0.06);
}

.statistics-chart-header {
	margin-bottom: 0.75rem;
}

.statistics-chart-header h2 {
	margin: 0;
	color: #0b2854;
	font-size: 1.05rem;
	font-weight: 700;
	line-height: 1.4;
}

.statistics-chart-header p {
	margin: 0.15rem 0 0;
	color: #64748b;
	font-size: 0.9rem;
	line-height: 1.4;
}

.statistics-chart-body {
	height: 20rem;
	min-height: 0;
	overflow: hidden;
}

.statistics-chart-body :deep(> *) {
	height: 100%;
	max-height: 100%;
	min-height: 0;
}

.statistics-completion-body {
	display: flex;
	height: 20rem;
	min-height: 0;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 1.35rem;
}

.statistics-completion-donut {
	display: grid;
	width: min(14rem, 72%);
	aspect-ratio: 1;
	place-items: center;
	border-radius: 50%;
	background: conic-gradient(
		#ffd85c 0 var(--completed-percent),
		#37a2da var(--completed-percent) 100%
	);
	box-shadow: 0 16px 30px rgba(20, 61, 107, 0.12);
}

.statistics-completion-donut::before {
	grid-area: 1 / 1;
	width: 58%;
	aspect-ratio: 1;
	border-radius: 50%;
	background: #ffffff;
	box-shadow: inset 0 0 0 1px #e3edf8;
	content: '';
}

.statistics-completion-donut > div {
	z-index: 1;
	grid-area: 1 / 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	color: #0b2854;
	line-height: 1.1;
}

.statistics-completion-donut strong {
	font-size: 2rem;
	font-weight: 800;
}

.statistics-completion-donut span {
	margin-top: 0.2rem;
	color: #64748b;
	font-size: 0.85rem;
	font-weight: 600;
}

.statistics-completion-legend {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 0.75rem 1.25rem;
	color: #334155;
	font-size: 0.95rem;
}

.statistics-completion-legend-item {
	display: inline-flex;
	align-items: center;
	gap: 0.45rem;
}

.statistics-completion-dot {
	width: 0.7rem;
	height: 0.7rem;
	flex: 0 0 auto;
	border-radius: 50%;
}

.statistics-empty-state {
	display: flex;
	height: 20rem;
	min-height: 0;
	align-items: center;
	justify-content: center;
	border: 1px dashed #c9d7ea;
	border-radius: 0.65rem;
	background: linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%);
	color: #4b5f7a;
	font-size: 0.95rem;
	text-align: center;
}

.statistics-empty-state p {
	margin: 0;
	padding: 0 1rem;
}

@media (max-width: 640px) {
	.statistics-chart-card {
		height: 24rem;
	}

	.statistics-chart-body,
	.statistics-completion-body,
	.statistics-empty-state {
		height: 18rem;
	}
}
</style>
