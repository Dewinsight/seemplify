<template>
	<header
		class="sticky top-0 z-10 flex items-center justify-between border-b bg-surface-white px-3 py-2.5 sm:px-5"
	>
		<Breadcrumbs :items="breadcrumbs" />
		<Button @click="router.push({ name: 'Programs' })">
			<template #prefix>
				<ArrowLeft class="h-4 w-4 stroke-1.5" />
			</template>
			{{ __('Programs') }}
		</Button>
	</header>

	<div v-if="analytics.loading" class="program-report-state">
		{{ __('Loading program report...') }}
	</div>
	<div v-else-if="analytics.error" class="program-report-state is-error">
		{{ __('Unable to load program report.') }}
	</div>
	<div v-else-if="analytics.data" class="program-report-page">
		<section class="program-report-header">
			<div class="program-report-title">
				<h1>{{ __('View Program') }}</h1>
				<p>{{ program.title || program.name }}</p>
				<div class="program-report-badges">
					<Badge :theme="program.published ? 'green' : 'orange'">
						{{ program.published ? __('Published') : __('Draft') }}
					</Badge>
					<Badge theme="gray">
						{{
							program.enforce_course_order
								? __('Ordered Path')
								: __('Flexible Path')
						}}
					</Badge>
				</div>
			</div>
			<img
				v-if="program.image"
				class="program-report-cover"
				:src="program.image"
				:alt="program.title || program.name"
			/>
		</section>

		<section class="program-report-metrics">
			<div
				v-for="metric in summaryMetrics"
				:key="metric.label"
				class="program-report-metric"
			>
				<component :is="metric.icon" class="h-5 w-5 stroke-1.7" />
				<div>
					<span>{{ metric.label }}</span>
					<strong>{{ metric.value }}</strong>
					<small v-if="metric.hint">{{ metric.hint }}</small>
				</div>
			</div>
		</section>

		<div class="program-report-main-grid">
			<section class="program-report-panel program-report-students">
				<div class="program-report-panel-header">
					<div>
						<h2>{{ __('Learners') }}</h2>
						<p>{{ __('{0} enrolled').format(students.length) }}</p>
					</div>
				</div>

				<div class="program-report-filters">
					<label>
						<span>{{ __('Search') }}</span>
						<div class="program-report-input">
							<Search class="h-4 w-4 stroke-1.5" />
							<input
								v-model="studentSearch"
								:placeholder="__('Name or email')"
								type="search"
							/>
						</div>
					</label>
					<label>
						<span>{{ __('Course') }}</span>
						<select v-model="selectedCourseName">
							<option value="">{{ __('All courses') }}</option>
							<option
								v-for="course in courseOptions"
								:key="course.name"
								:value="course.name"
							>
								{{ course.title }}
							</option>
						</select>
					</label>
					<label>
						<span>{{ __('Status') }}</span>
						<select v-model="selectedStatus">
							<option value="all">{{ __('All status') }}</option>
							<option value="not_started">{{ __('Not Started') }}</option>
							<option value="in_progress">{{ __('In Progress') }}</option>
							<option value="completed">{{ __('Completed') }}</option>
							<option value="needs_attention">{{ __('Needs Attention') }}</option>
						</select>
					</label>
				</div>

				<div class="program-report-student-list">
					<button
						v-for="student in filteredStudents"
						:key="student.member"
						class="program-report-student-row"
						:class="{ 'is-active': selectedMember === student.member }"
						@click="selectedMember = student.member"
					>
						<Avatar
							:image="student.user_image"
							:label="student.full_name || student.member"
							size="md"
						/>
						<div class="program-report-student-copy">
							<div class="program-report-student-name">
								{{ student.full_name || student.member }}
							</div>
							<div class="program-report-student-email">
								{{ student.email || student.member }}
							</div>
							<div class="program-report-mini-progress">
								<span :style="{ width: studentProgress(student) }"></span>
							</div>
						</div>
						<div class="program-report-student-score">
							<strong>{{ studentProgress(student) }}</strong>
							<span>{{ studentStatus(student) }}</span>
						</div>
					</button>
				</div>
			</section>

			<section class="program-report-panel program-report-detail">
				<div v-if="selectedStudent" class="program-report-detail-content">
					<div class="program-report-detail-header">
						<div class="flex min-w-0 items-center gap-3">
							<Avatar
								:image="selectedStudent.user_image"
								:label="selectedStudent.full_name || selectedStudent.member"
								size="lg"
							/>
							<div class="min-w-0">
								<h2>{{ selectedStudent.full_name || selectedStudent.member }}</h2>
								<p>{{ selectedStudent.email || selectedStudent.member }}</p>
								<p v-if="selectedStudent.last_activity">
									{{ __('Last activity') }}:
									{{ selectedStudent.last_activity }}
								</p>
							</div>
						</div>
						<Badge :theme="statusTheme(selectedStudent.status)">
							{{ selectedStudent.status }}
						</Badge>
					</div>

					<div class="program-report-detail-metrics">
						<div
							v-for="metric in selectedStudentMetrics"
							:key="metric.label"
						>
							<span>{{ metric.label }}</span>
							<strong>{{ metric.value }}</strong>
						</div>
					</div>

					<div class="program-report-section-header">
						<h3>{{ __('Student Course and Quiz Detail') }}</h3>
						<p>
							{{
								selectedCourseName
									? __('Filtered by selected course')
									: __('All courses in this program')
							}}
						</p>
					</div>

					<div class="program-report-course-stack">
						<div
							v-for="course in selectedStudentCourses"
							:key="course.name"
							class="program-report-course-detail"
						>
							<div class="program-report-course-detail-top">
								<div>
									<h4>{{ course.title }}</h4>
									<p>
										{{
											__('{0} of {1} lessons completed').format(
												course.completed_lessons,
												course.lesson_count
											)
										}}
									</p>
								</div>
								<Badge :theme="statusTheme(progressStatus(course.progress))">
									{{ progressStatus(course.progress) }}
								</Badge>
							</div>

							<div class="program-report-course-meta-grid">
								<div>
									<span>{{ __('Progress') }}</span>
									<strong>{{ percent(course.progress) }}</strong>
								</div>
								<div>
									<span>{{ __('Enrollment') }}</span>
									<strong>
										{{ course.enrollment ? __('Enrolled') : __('Not enrolled') }}
									</strong>
								</div>
								<div>
									<span>{{ __('Quizzes') }}</span>
									<strong>{{ course.quizzes.length }}</strong>
								</div>
							</div>
							<div class="program-report-progress">
								<span :style="{ width: percent(course.progress) }"></span>
							</div>
							<div
								v-if="course.current_lesson_title"
								class="program-report-current-lesson"
							>
								<Clock class="h-4 w-4 stroke-1.5" />
								<span>{{ __('Current lesson') }}: {{ course.current_lesson_title }}</span>
							</div>

							<div v-if="course.quizzes.length" class="program-report-quiz-list">
								<div class="program-report-quiz-list-head">
									<span>{{ __('Quiz') }}</span>
									<span>{{ __('Best Score') }}</span>
									<span>{{ __('Attempts') }}</span>
									<span>{{ __('Status') }}</span>
								</div>
								<div
									v-for="quiz in course.quizzes"
									:key="quiz.name"
									class="program-report-quiz-item"
								>
									<div class="program-report-quiz-row">
										<div>
											<strong>{{ quiz.title }}</strong>
											<small>
												{{ __('Pass mark') }} {{ quiz.passing_percentage }}%
												<span v-if="quiz.last_attempt">
													- {{ __('Last') }} {{ quiz.last_attempt }}
												</span>
											</small>
										</div>
										<span>{{ quizScore(quiz) }}</span>
										<span>{{ quiz.attempts }}</span>
										<Badge :theme="statusTheme(quiz.status)">
											{{ quiz.status }}
										</Badge>
									</div>
									<div
										v-if="quiz.submissions?.length"
										class="program-report-attempt-list"
									>
										<div
											v-for="attempt in quiz.submissions"
											:key="attempt.name"
											class="program-report-attempt-row"
										>
											<span>{{ attempt.created }}</span>
											<span>
												{{ attempt.score }} / {{ attempt.score_out_of }}
											</span>
											<span>{{ percent(attempt.percentage) }}</span>
											<Badge :theme="attempt.passed ? 'green' : 'red'">
												{{ attempt.passed ? __('Passed') : __('Failed') }}
											</Badge>
											<Button
												@click="openSubmission(attempt.name)"
											>
												<template #prefix>
													<ExternalLink class="h-4 w-4 stroke-1.5" />
												</template>
												{{ __('Submission') }}
											</Button>
										</div>
									</div>
								</div>
							</div>
							<div v-else class="program-report-empty-small">
								{{ __('No quizzes are linked to this course.') }}
							</div>
						</div>
					</div>
				</div>
				<div v-else class="program-report-empty">
					{{ __('No learner selected.') }}
				</div>
			</section>
		</div>

		<section class="program-report-panel">
			<div class="program-report-panel-header">
				<div>
					<h2>{{ __('Course Performance') }}</h2>
					<p>{{ __('Progress, completion, and quiz health by course') }}</p>
				</div>
			</div>
			<div class="program-report-table program-report-course-table">
				<div class="program-report-table-head">
					<span>{{ __('Course') }}</span>
					<span>{{ __('Learners') }}</span>
					<span>{{ __('Avg Progress') }}</span>
					<span>{{ __('Completed') }}</span>
					<span>{{ __('Not Started') }}</span>
					<span>{{ __('Quiz Pass') }}</span>
					<span>{{ __('Needs Attention') }}</span>
				</div>
				<div
					v-for="course in courses"
					:key="course.name"
					class="program-report-table-row"
				>
					<span>
						<strong>{{ course.title }}</strong>
						<small>
							{{ course.lesson_count }} {{ __('lessons') }} -
							{{ course.quiz_count }} {{ __('quizzes') }}
						</small>
					</span>
					<span>{{ course.enrolled_members }} / {{ course.member_count }}</span>
					<span>{{ percent(course.average_progress) }}</span>
					<span>{{ course.completed_members }}</span>
					<span>{{ course.not_started_members }}</span>
					<span>{{ percent(course.quiz_pass_rate) }}</span>
					<span>{{ course.needs_attention_members }}</span>
				</div>
			</div>
		</section>

		<section class="program-report-panel">
			<div class="program-report-panel-header">
				<div>
					<h2>{{ __('Quiz Performance') }}</h2>
					<p>{{ __('Quiz detail per program course') }}</p>
				</div>
			</div>
			<div class="program-report-quiz-groups">
				<div
					v-for="group in quizzesByCourse"
					:key="group.course"
					class="program-report-quiz-group"
				>
					<h3>{{ group.title }}</h3>
					<div v-if="group.quizzes.length" class="program-report-table program-report-quiz-table">
						<div class="program-report-table-head">
							<span>{{ __('Quiz') }}</span>
							<span>{{ __('Attempted') }}</span>
							<span>{{ __('Passed') }}</span>
							<span>{{ __('Failed') }}</span>
							<span>{{ __('Not Attempted') }}</span>
							<span>{{ __('Avg Best') }}</span>
							<span>{{ __('Pass Rate') }}</span>
						</div>
						<div
							v-for="quiz in group.quizzes"
							:key="quiz.name"
							class="program-report-table-row"
						>
							<span>
								<strong>{{ quiz.title }}</strong>
								<small>{{ __('Pass mark') }} {{ quiz.passing_percentage }}%</small>
							</span>
							<span>
								{{ quiz.attempted_members }} / {{ summary.member_count || 0 }}
							</span>
							<span>{{ quiz.passed_members }}</span>
							<span>{{ quiz.failed_members }}</span>
							<span>{{ notAttemptedMembers(quiz) }}</span>
							<span>{{ percent(quiz.average_best_percentage) }}</span>
							<span>{{ percent(quiz.pass_rate) }}</span>
						</div>
					</div>
					<div v-else class="program-report-empty-small">
						{{ __('No quizzes are linked to this course.') }}
					</div>
				</div>
			</div>
		</section>
	</div>
</template>

<script setup>
import {
	Avatar,
	Badge,
	Breadcrumbs,
	Button,
	createResource,
	usePageMeta,
} from 'frappe-ui'
import { computed, ref, watch } from 'vue'
import {
	Activity,
	ArrowLeft,
	BookOpen,
	CheckCircle2,
	Clock,
	ExternalLink,
	Search,
	Target,
	Trophy,
	Users,
} from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { sessionStore } from '@/stores/session'

const props = defineProps({
	programName: {
		type: String,
		required: true,
	},
})

const router = useRouter()
const { brand } = sessionStore()
const studentSearch = ref('')
const selectedMember = ref('')
const selectedCourseName = ref('')
const selectedStatus = ref('all')

const analytics = createResource({
	url: 'lms.lms.utils.get_program_analytics',
	params: {
		program_name: props.programName,
	},
	auto: true,
})

watch(
	() => props.programName,
	() => {
		selectedMember.value = ''
		selectedCourseName.value = ''
		selectedStatus.value = 'all'
		analytics.update({
			params: {
				program_name: props.programName,
			},
		})
		analytics.reload()
	}
)

const program = computed(() => analytics.data?.program || {})
const summary = computed(() => analytics.data?.summary || {})
const students = computed(() => analytics.data?.students || [])
const courses = computed(() => analytics.data?.courses || [])
const quizzes = computed(() => analytics.data?.quizzes || [])

const summaryMetrics = computed(() => [
	{
		label: __('Learners'),
		value: summary.value.member_count || 0,
		hint: __('Program members'),
		icon: Users,
	},
	{
		label: __('Average Progress'),
		value: percent(summary.value.average_progress),
		hint: __('Across enrolled learners'),
		icon: Activity,
	},
	{
		label: __('Completed'),
		value: summary.value.completed_members || 0,
		hint: __('Learners at 100%'),
		icon: CheckCircle2,
	},
	{
		label: __('Quiz Pass Rate'),
		value: percent(summary.value.quiz_pass_rate),
		hint: `${summary.value.passed_member_quizzes || 0} / ${
			summary.value.attempted_member_quizzes || 0
		} ${__('passed')}`,
		icon: Trophy,
	},
	{
		label: __('Needs Attention'),
		value: summary.value.needs_attention_members || 0,
		hint: __('Below 60% progress or failed quiz'),
		icon: Target,
	},
	{
		label: __('Courses'),
		value: summary.value.course_count || 0,
		hint: `${summary.value.quiz_count || 0} ${__('quizzes')}`,
		icon: BookOpen,
	},
])

const courseOptions = computed(() => courses.value.map((course) => ({
	name: course.name,
	title: course.title,
})))

const filteredStudents = computed(() => {
	const search = studentSearch.value.trim().toLowerCase()
	return students.value.filter((student) => {
		const matchesSearch =
			!search ||
			[student.full_name, student.member, student.email]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
				.includes(search)
		const matchesStatus =
			selectedStatus.value === 'all' ||
			studentStatusKey(student) === selectedStatus.value ||
			(selectedStatus.value === 'needs_attention' && studentNeedsAttention(student))
		return matchesSearch && matchesStatus
	})
})

watch(
	students,
	(rows) => {
		if (!selectedMember.value && rows.length) {
			selectedMember.value = rows[0].member
		}
	},
	{ immediate: true }
)

watch(filteredStudents, (rows) => {
	if (!rows.length) return
	const selectedIsVisible = rows.some((student) => student.member === selectedMember.value)
	if (!selectedIsVisible) {
		selectedMember.value = rows[0].member
	}
})

const selectedStudent = computed(() => {
	return students.value.find((student) => student.member === selectedMember.value)
})

const selectedStudentCourses = computed(() => {
	const rows = selectedStudent.value?.courses || []
	if (!selectedCourseName.value) return rows
	return rows.filter((course) => course.name === selectedCourseName.value)
})

const selectedStudentMetrics = computed(() => {
	if (!selectedStudent.value) return []
	return [
		{
			label: __('Program Progress'),
			value: percent(selectedStudent.value.progress),
		},
		{
			label: __('Courses Done'),
			value: `${selectedStudent.value.completed_courses} / ${selectedStudent.value.course_count}`,
		},
		{
			label: __('Quiz Average'),
			value: percent(selectedStudent.value.average_quiz_percentage),
		},
		{
			label: __('Passed Quizzes'),
			value: `${selectedStudent.value.passed_quizzes} / ${selectedStudent.value.quiz_count}`,
		},
		{
			label: __('Attempted Quizzes'),
			value: `${selectedStudent.value.attempted_quizzes} / ${selectedStudent.value.quiz_count}`,
		},
		{
			label: __('Failed Quizzes'),
			value: selectedStudent.value.failed_quizzes || 0,
		},
	]
})

const quizzesByCourse = computed(() => {
	return courses.value.map((course) => {
		return {
			course: course.name,
			title: course.title,
			quizzes: quizzes.value.filter((quiz) => quiz.course === course.name),
		}
	})
})

const breadcrumbs = computed(() => [
	{ label: __('Programs'), route: { name: 'Programs' } },
	{
		label: program.value.title || props.programName,
		route: {
			name: 'ProgramAnalytics',
			params: { programName: props.programName },
		},
	},
])

const percent = (value) => {
	return `${Math.round(Number(value || 0))}%`
}

const progressStatus = (progress) => {
	const value = Number(progress || 0)
	if (value >= 100) return 'Completed'
	if (value > 0) return 'In Progress'
	return 'Not Started'
}

const statusTheme = (status) => {
	if (status === 'Completed' || status === 'Passed') return 'green'
	if (status === 'In Progress') return 'orange'
	if (status === 'Failed') return 'red'
	return 'gray'
}

const studentCourse = (student) => {
	if (!selectedCourseName.value) return null
	return student.courses?.find((course) => course.name === selectedCourseName.value)
}

const studentProgress = (student) => {
	const course = studentCourse(student)
	return percent(course ? course.progress : student.progress)
}

const studentStatus = (student) => {
	const course = studentCourse(student)
	return progressStatus(course ? course.progress : student.progress)
}

const studentStatusKey = (student) => {
	const status = studentStatus(student)
	if (status === 'Completed') return 'completed'
	if (status === 'In Progress') return 'in_progress'
	return 'not_started'
}

const studentNeedsAttention = (student) => {
	const course = studentCourse(student)
	const progress = Number(course ? course.progress : student.progress || 0)
	if (progress < 60) return true
	if (selectedCourseName.value) {
		return course?.quizzes?.some((quiz) => quiz.status === 'Failed')
	}
	return Number(student.failed_quizzes || 0) > 0
}

const quizScore = (quiz) => {
	if (!quiz.attempts) return '-'
	const outOf = quiz.score_out_of || quiz.total_marks || 0
	if (!outOf) return percent(quiz.best_percentage)
	return `${quiz.best_score} / ${outOf} (${percent(quiz.best_percentage)})`
}

const notAttemptedMembers = (quiz) => {
	if (quiz.not_attempted_members !== undefined) {
		return quiz.not_attempted_members
	}
	return Math.max(Number(summary.value.member_count || 0) - Number(quiz.attempted_members || 0), 0)
}

const openSubmission = (submission) => {
	if (!submission) return
	router.push({
		name: 'QuizSubmission',
		params: { submission },
	})
}

usePageMeta(() => {
	return {
		title: __('Program Report'),
		icon: brand.favicon,
	}
})
</script>

<style scoped>
.program-report-page {
	min-height: calc(100vh - 3.25rem);
	padding: 1.25rem;
	background: #eef5fc;
	color: #0b2854;
}

.program-report-state {
	display: grid;
	min-height: 18rem;
	place-items: center;
	color: #4b5f7a;
	font-size: 1rem;
}

.program-report-state.is-error {
	color: #b42318;
}

.program-report-header {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(18rem, 28rem);
	gap: 1rem;
	align-items: stretch;
	margin-bottom: 1rem;
}

.program-report-title,
.program-report-panel,
.program-report-metric {
	border: 1px solid #d7e2f0;
	border-radius: 0.5rem;
	background: #ffffff;
}

.program-report-title {
	padding: 1rem;
}

.program-report-title h1 {
	margin: 0;
	color: #0b2854;
	font-size: 1.4rem;
	font-weight: 800;
	line-height: 1.2;
}

.program-report-title p {
	margin: 0.35rem 0 0;
	color: #4b5f7a;
	font-size: 1rem;
	line-height: 1.45;
}

.program-report-badges {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	margin-top: 0.85rem;
}

.program-report-cover {
	width: 100%;
	height: 10.5rem;
	object-fit: cover;
	border: 1px solid #d7e2f0;
	border-radius: 0.5rem;
	background: #dbe7f5;
}

.program-report-metrics {
	display: grid;
	grid-template-columns: repeat(6, minmax(0, 1fr));
	gap: 0.75rem;
	margin-bottom: 1rem;
}

.program-report-metric {
	display: flex;
	gap: 0.7rem;
	min-height: 6.25rem;
	padding: 0.85rem;
	color: #0d66c2;
}

.program-report-metric span,
.program-report-metric small,
.program-report-detail-metrics span,
.program-report-course-meta-grid span,
.program-report-table-row small,
.program-report-quiz-row small,
.program-report-attempt-row {
	display: block;
	color: #64748b;
	font-size: 0.78rem;
	line-height: 1.3;
}

.program-report-metric strong {
	display: block;
	margin-top: 0.2rem;
	color: #0b2854;
	font-size: 1.4rem;
	font-weight: 800;
	line-height: 1.1;
}

.program-report-metric small {
	margin-top: 0.25rem;
}

.program-report-main-grid {
	display: grid;
	grid-template-columns: minmax(22rem, 0.85fr) minmax(0, 1.55fr);
	gap: 1rem;
	margin-bottom: 1rem;
}

.program-report-panel {
	min-width: 0;
	padding: 1rem;
}

.program-report-panel + .program-report-panel {
	margin-top: 1rem;
}

.program-report-panel-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	margin-bottom: 0.85rem;
}

.program-report-panel-header h2,
.program-report-detail-header h2,
.program-report-section-header h3,
.program-report-quiz-group h3 {
	margin: 0;
	color: #0b2854;
	font-size: 1.05rem;
	font-weight: 800;
	line-height: 1.25;
}

.program-report-panel-header p,
.program-report-detail-header p,
.program-report-section-header p,
.program-report-course-detail p {
	margin: 0.2rem 0 0;
	color: #64748b;
	font-size: 0.88rem;
	line-height: 1.4;
}

.program-report-filters {
	display: grid;
	grid-template-columns: 1fr;
	gap: 0.65rem;
	margin-bottom: 0.85rem;
}

.program-report-filters label > span {
	display: block;
	margin-bottom: 0.25rem;
	color: #4b5f7a;
	font-size: 0.78rem;
	font-weight: 700;
}

.program-report-input,
.program-report-filters select {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	width: 100%;
	min-height: 2.35rem;
	border: 1px solid #cfdaea;
	border-radius: 0.45rem;
	background: #f8fbff;
	padding: 0 0.6rem;
	color: #0b2854;
	font-size: 0.9rem;
}

.program-report-input input {
	width: 100%;
	border: 0;
	outline: 0;
	background: transparent;
	color: #0b2854;
}

.program-report-student-list {
	display: flex;
	max-height: 55rem;
	flex-direction: column;
	gap: 0.5rem;
	overflow: auto;
	padding-right: 0.15rem;
}

.program-report-student-row {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	gap: 0.75rem;
	align-items: center;
	width: 100%;
	border: 1px solid #e1e9f4;
	border-radius: 0.5rem;
	background: #ffffff;
	padding: 0.7rem;
	text-align: left;
	transition: border-color 0.16s ease, background 0.16s ease;
}

.program-report-student-row.is-active {
	border-color: #0d66c2;
	background: #eef6ff;
}

.program-report-student-name,
.program-report-quiz-row strong,
.program-report-table-row strong {
	overflow: hidden;
	color: #0b2854;
	font-weight: 800;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.program-report-student-email {
	overflow: hidden;
	color: #64748b;
	font-size: 0.82rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.program-report-student-score {
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 0.1rem;
	color: #64748b;
	font-size: 0.78rem;
}

.program-report-student-score strong {
	color: #0b2854;
	font-size: 0.98rem;
}

.program-report-mini-progress,
.program-report-progress {
	height: 0.42rem;
	overflow: hidden;
	border-radius: 999px;
	background: #dbe7f5;
}

.program-report-mini-progress {
	margin-top: 0.45rem;
}

.program-report-mini-progress span,
.program-report-progress span {
	display: block;
	height: 100%;
	border-radius: inherit;
	background: #0d66c2;
}

.program-report-detail-header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	margin-bottom: 1rem;
}

.program-report-detail-metrics {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 0.75rem;
	margin-bottom: 1rem;
}

.program-report-detail-metrics div,
.program-report-course-meta-grid div {
	border: 1px solid #e1e9f4;
	border-radius: 0.45rem;
	background: #f8fbff;
	padding: 0.65rem;
}

.program-report-detail-metrics strong,
.program-report-course-meta-grid strong {
	display: block;
	margin-top: 0.2rem;
	color: #0b2854;
	font-size: 1rem;
	font-weight: 800;
}

.program-report-section-header {
	display: flex;
	align-items: flex-end;
	justify-content: space-between;
	gap: 1rem;
	margin-bottom: 0.75rem;
}

.program-report-course-stack,
.program-report-quiz-groups {
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
}

.program-report-course-detail,
.program-report-quiz-group {
	border: 1px solid #e1e9f4;
	border-radius: 0.5rem;
	background: #ffffff;
	padding: 0.85rem;
}

.program-report-course-detail-top {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 1rem;
	margin-bottom: 0.7rem;
}

.program-report-course-detail h4 {
	margin: 0;
	color: #0b2854;
	font-size: 0.98rem;
	font-weight: 800;
	line-height: 1.3;
}

.program-report-course-meta-grid {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 0.6rem;
	margin-bottom: 0.75rem;
}

.program-report-current-lesson {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	margin-top: 0.65rem;
	color: #4b5f7a;
	font-size: 0.85rem;
}

.program-report-quiz-list {
	margin-top: 0.75rem;
	border: 1px solid #e1e9f4;
	border-radius: 0.45rem;
	overflow: hidden;
}

.program-report-quiz-list-head,
.program-report-quiz-row {
	display: grid;
	grid-template-columns: minmax(0, 1.6fr) minmax(7rem, 0.75fr) 5rem 6.5rem;
	gap: 0.7rem;
	align-items: center;
	padding: 0.65rem 0.75rem;
}

.program-report-quiz-list-head,
.program-report-table-head {
	background: #f3f7fc;
	color: #64748b;
	font-size: 0.76rem;
	font-weight: 800;
}

.program-report-quiz-item {
	border-top: 1px solid #e8eef6;
}

.program-report-quiz-row {
	color: #0b2854;
	font-size: 0.88rem;
}

.program-report-attempt-list {
	border-top: 1px solid #eef3f8;
	background: #fbfdff;
	padding: 0.45rem 0.75rem;
}

.program-report-attempt-row {
	display: grid;
	grid-template-columns: minmax(8rem, 1fr) 5.5rem 4.5rem 5.5rem auto;
	gap: 0.55rem;
	align-items: center;
	padding: 0.25rem 0;
}

.program-report-table {
	overflow: auto;
	border: 1px solid #e1e9f4;
	border-radius: 0.45rem;
}

.program-report-table-head,
.program-report-table-row {
	display: grid;
	gap: 0.75rem;
	align-items: center;
	min-width: 58rem;
	padding: 0.65rem 0.75rem;
}

.program-report-course-table .program-report-table-head,
.program-report-course-table .program-report-table-row {
	grid-template-columns:
		minmax(12rem, 1.5fr) 6rem 7rem 6rem 6rem 6rem
		7rem;
}

.program-report-quiz-table .program-report-table-head,
.program-report-quiz-table .program-report-table-row {
	grid-template-columns:
		minmax(12rem, 1.7fr) 6rem 5rem 5rem 7rem 6rem
		6rem;
}

.program-report-table-row {
	border-top: 1px solid #e8eef6;
	color: #0b2854;
	font-size: 0.88rem;
}

.program-report-empty,
.program-report-empty-small {
	display: grid;
	min-height: 12rem;
	place-items: center;
	color: #64748b;
}

.program-report-empty-small {
	min-height: 4rem;
	border: 1px dashed #d7e2f0;
	border-radius: 0.45rem;
	font-size: 0.88rem;
}

@media (max-width: 1200px) {
	.program-report-metrics {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.program-report-main-grid,
	.program-report-header {
		grid-template-columns: 1fr;
	}
}

@media (max-width: 760px) {
	.program-report-page {
		padding: 0.85rem;
	}

	.program-report-metrics,
	.program-report-detail-metrics,
	.program-report-course-meta-grid {
		grid-template-columns: 1fr;
	}

	.program-report-panel-header,
	.program-report-detail-header,
	.program-report-section-header {
		flex-direction: column;
		align-items: stretch;
	}

	.program-report-quiz-list-head {
		display: none;
	}

	.program-report-quiz-row,
	.program-report-attempt-row {
		grid-template-columns: 1fr;
		gap: 0.35rem;
	}

	.program-report-student-row {
		grid-template-columns: auto minmax(0, 1fr);
	}

	.program-report-student-score {
		grid-column: 2;
		align-items: flex-start;
	}
}
</style>
