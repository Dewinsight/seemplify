<template>
	<header
		class="sticky top-0 z-10 flex items-center justify-between border-b bg-surface-white px-3 py-2.5 sm:px-5"
	>
		<Breadcrumbs :items="breadcrumbs" />
	</header>
	<div
		v-if="groupedSubmissions.length"
		class="lms-quiz-submissions-page md:w-3/4 md:mx-auto py-5 mx-5"
	>
		<div class="lms-quiz-submissions-title text-xl font-semibold mb-2 text-ink-gray-9">
			{{ submissions.data[0].quiz_title }}
		</div>
		<div class="lms-quiz-submissions-copy mb-5 text-ink-gray-6">
			{{
				__(
					'Learners are grouped below. The latest attempt is the score used for review, and previous attempts remain available.'
				)
			}}
		</div>

		<div class="space-y-4">
			<section
				v-for="group in groupedSubmissions"
				:key="group.member"
				class="lms-submission-group"
			>
				<div class="lms-submission-group-header">
					<div>
						<div class="lms-submission-member">
							{{ group.member_name }}
						</div>
						<div class="lms-submission-meta">
							{{
								__('{0} attempt(s) recorded. Latest attempt: {1}.').format(
									group.attempts.length,
									group.latest.display_creation
								)
							}}
						</div>
					</div>
					<div
						class="lms-submission-latest-score"
						:class="{ 'is-pass': group.latest.is_pass, 'is-fail': !group.latest.is_pass }"
					>
						<strong>{{ group.latest.percentage }}%</strong>
						<span>{{ __('Latest score') }}</span>
					</div>
				</div>

				<div class="lms-submission-attempts">
					<router-link
						v-for="(attempt, index) in group.attempts"
						:key="attempt.name"
						class="lms-submission-attempt-row"
						:to="{
							name: 'QuizSubmission',
							params: {
								submission: attempt.name,
							},
						}"
					>
						<div>
							<div class="lms-submission-attempt-title">
								{{
									index == 0
										? __('Latest Attempt')
										: __('Attempt {0}').format(group.attempts.length - index)
								}}
							</div>
							<div class="lms-submission-meta">
								{{ attempt.display_creation }}
							</div>
						</div>
						<div class="lms-submission-attempt-score">
							<span>{{ attempt.score }} / {{ attempt.score_out_of }}</span>
							<Badge
								:theme="attempt.is_pass ? 'green' : 'red'"
								:label="attempt.is_pass ? __('Passed') : __('Try Again')"
							/>
						</div>
					</router-link>
				</div>
			</section>
		</div>

		<div class="flex justify-center my-5">
			<Button v-if="submissions.hasNextPage" @click="submissions.next()">
				{{ __('Load More') }}
			</Button>
		</div>
	</div>
	<EmptyState v-else type="Quiz Submissions" />
</template>
<script setup>
import {
	createListResource,
	Breadcrumbs,
	Button,
	Badge,
	usePageMeta,
} from 'frappe-ui'
import { computed, onMounted, inject } from 'vue'
import { sessionStore } from '../stores/session'
import { useRouter } from 'vue-router'
import EmptyState from '@/components/EmptyState.vue'

const { brand } = sessionStore()
const router = useRouter()
const user = inject('$user')
const dayjs = inject('$dayjs')
const defaultPassingPercentage = 60

onMounted(() => {
	if (!user.data?.is_instructor && !user.data?.is_moderator)
		router.push({ name: 'Courses' })
})

const props = defineProps({
	quizID: {
		type: String,
		required: true,
	},
})

const submissions = createListResource({
	doctype: 'LMS Quiz Submission',
	filters: {
		quiz: props.quizID,
	},
	fields: [
		'name',
		'member',
		'member_name',
		'score',
		'score_out_of',
		'percentage',
		'passing_percentage',
		'quiz_title',
		'creation',
	],
	orderBy: 'creation desc',
	auto: true,
	pageLength: 500,
	transform(data) {
		return data.map((submission) => {
			const percentage = Math.max(0, Math.ceil(Number(submission.percentage || 0)))
			const passMark =
				Number(submission.passing_percentage) || defaultPassingPercentage
			return {
				...submission,
				percentage,
				is_pass: percentage >= passMark,
				display_creation: dayjs(submission.creation).format('D MMM YYYY, h:mm A'),
			}
		})
	},
})

const groupedSubmissions = computed(() => {
	const groups = new Map()
	;(submissions.data || []).forEach((submission) => {
		const key = submission.member || submission.member_name || submission.name
		if (!groups.has(key)) {
			groups.set(key, {
				member: key,
				member_name: submission.member_name || submission.member,
				latest: submission,
				attempts: [],
			})
		}
		groups.get(key).attempts.push(submission)
	})

	return Array.from(groups.values())
})

const breadcrumbs = computed(() => {
	return [{ label: __('Quiz Submissions') }]
})

usePageMeta(() => {
	return {
		title: __('Quiz Submissions'),
		icon: brand.favicon,
	}
})
</script>
