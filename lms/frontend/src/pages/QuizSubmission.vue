<template>
	<header
		class="sticky top-0 z-10 flex items-center justify-between border-b bg-surface-white px-3 py-2.5 sm:px-5"
	>
		<Breadcrumbs v-if="submissionDetails.doc" :items="breadcrumbs" />
		<div class="space-x-2">
			<Badge
				v-if="submissionDetails.isDirty"
				:label="__('Not Saved')"
				variant="subtle"
				theme="orange"
			/>
			<Button variant="solid" @click="saveSubmission()">
				{{ __('Save') }}
			</Button>
		</div>
	</header>
	<div v-if="submissionDetails.doc" class="lms-quiz-submission-detail w-2/3 border-x mx-auto py-5">
		<div class="px-10 mb-5">
			<div class="text-xl font-semibold text-ink-gray-9">
				{{ submissionDetails.doc.member_name }}
			</div>
			<div class="text-sm text-ink-gray-6 mt-1">
				{{ submissionDetails.doc.quiz_title }}
			</div>
		</div>
		<div class="lms-quiz-submission-summary mx-10 mb-5">
			<div>
				<div class="lms-quiz-submission-summary-label">
					{{ __('Score') }}
				</div>
				<div class="lms-quiz-submission-summary-value">
					{{ submissionDetails.doc.score }} / {{ submissionDetails.doc.score_out_of }}
				</div>
			</div>
			<div>
				<div class="lms-quiz-submission-summary-label">
					{{ __('Percentage') }}
				</div>
				<div class="lms-quiz-submission-summary-value">
					{{ submissionPercentage }}%
				</div>
			</div>
			<div>
				<div class="lms-quiz-submission-summary-label">
					{{ __('Pass Mark') }}
				</div>
				<div class="lms-quiz-submission-summary-value">
					{{ passMark }}%
				</div>
			</div>
			<Badge
				class="self-center justify-self-start"
				:theme="submissionPassed ? 'green' : 'red'"
				:label="submissionPassed ? __('Passed') : __('Try Again')"
			/>
		</div>
		<div class="space-y-4 border-b pb-5 px-10">
			<div class="grid grid-cols-2 gap-5">
				<FormControl
					v-model="submissionDetails.doc.quiz_title"
					:label="__('Quiz')"
					:disabled="true"
				/>
				<FormControl
					v-model="submissionDetails.doc.member_name"
					:label="__('Member')"
					:disabled="true"
				/>
			</div>

			<div class="grid grid-cols-2 gap-5">
				<FormControl
					v-model="submissionDetails.doc.score"
					:label="__('Score')"
					:disabled="true"
				/>
				<FormControl
					v-model="submissionDetails.doc.percentage"
					:label="__('Percentage')"
					:disabled="true"
				/>
			</div>
		</div>

		<div class="divide-y">
			<div
				v-for="(row, index) in submissionDetails.doc.result"
				class="py-5 px-10 space-y-4"
			>
				<div class="text-ink-gray-9">
					<span class="font-semibold"> {{ __('Question') }}: </span>
					<span class="leading-5" v-html="row.question"> </span>
				</div>
				<div class="text-ink-gray-9">
					<span class="font-semibold"> {{ __('Answer') }}: </span>
					<span class="leading-5" v-html="row.answer"></span>
				</div>
				<div class="grid grid-cols-2 gap-5">
					<FormControl v-model="row.marks" :label="__('Marks')" />
					<FormControl
						v-model="row.marks_out_of"
						:label="__('Marks out of')"
						:disabled="true"
					/>
				</div>
			</div>
		</div>
	</div>
</template>
<script setup>
import {
	createDocumentResource,
	Breadcrumbs,
	FormControl,
	Button,
	Badge,
	usePageMeta,
	toast,
} from 'frappe-ui'
import { computed, onBeforeUnmount, onMounted, inject } from 'vue'
import { useRouter } from 'vue-router'
import { sessionStore } from '@/stores/session'

const { brand } = sessionStore()
const router = useRouter()
const user = inject('$user')

onMounted(() => {
	if (!user.data?.is_instructor && !user.data?.is_moderator)
		router.push({ name: 'Courses' })

	window.addEventListener('keydown', keyboardShortcut)
})

onBeforeUnmount(() => {
	window.removeEventListener('keydown', keyboardShortcut)
})

const keyboardShortcut = (e) => {
	if (
		e.key === 's' &&
		(e.ctrlKey || e.metaKey) &&
		!e.target.classList.contains('ProseMirror')
	) {
		saveSubmission()
		e.preventDefault()
	}
}

const props = defineProps({
	submission: {
		type: String,
		required: true,
	},
})

const submissionDetails = createDocumentResource({
	doctype: 'LMS Quiz Submission',
	name: props.submission,
	auto: true,
})

const passMark = computed(() => {
	return Number(submissionDetails.doc?.passing_percentage) || 60
})

const submissionPercentage = computed(() => {
	return Math.max(0, Math.ceil(Number(submissionDetails.doc?.percentage || 0)))
})

const submissionPassed = computed(() => {
	return submissionPercentage.value >= passMark.value
})

const breadcrumbs = computed(() => {
	return [
		{
			label: __('Quiz Submissions'),
			route: {
				name: 'QuizSubmissionList',
				params: {
					quizID: submissionDetails.doc.quiz,
				},
			},
		},
		{
			label: submissionDetails.doc.quiz_title,
		},
	]
})

const saveSubmission = () => {
	submissionDetails.save.submit(
		{},
		{
			onError(err) {
				toast.error(err.messages?.[0] || err)
			},
		}
	)
}

usePageMeta(() => {
	return {
		title: `${submissionDetails.doc?.quiz_title}`,
		icon: brand.favicon,
	}
})
</script>
