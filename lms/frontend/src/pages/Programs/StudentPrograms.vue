<template>
	<div class="lms-student-programs-page py-6 px-4 md:px-6">
		<div class="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
			<div>
				<div class="lms-programs-overline text-xs font-semibold uppercase mb-1">
					{{ __('Stanbic IBTC STEM Series') }}
				</div>
				<div class="lms-student-programs-heading text-lg text-ink-gray-9 font-semibold">
					{{ __('Choose Your Learning Level') }}
				</div>
				<div class="lms-student-programs-subtitle text-sm text-ink-gray-7 mt-1">
					{{ __('Start with Primary, JSS, or Senior Secondary, then continue into the mapped AI learning courses.') }}
				</div>
			</div>
			<TabButtons v-model="currentTab" :buttons="tabs" class="w-fit" />
		</div>
		<div v-for="(data, category) in programs.data" :key="category">
			<div v-if="category == currentTab">
				<div
					v-if="data.length > 0"
					class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
				>
					<div
						v-for="program in data"
						:key="program.name"
						@click="openDetails(program.name, category)"
						class="lms-program-card border rounded-md cursor-pointer"
					>
						<div class="lms-program-card-cover">
							<img
								v-if="program.image"
								:src="program.image"
								:alt="program.title || program.name"
								class="lms-program-card-image"
							/>
							<div
								v-else
								class="lms-program-card-cover-fallback"
								:style="{ background: getProgramGradient(program.name) }"
							></div>
							<div class="lms-program-card-cover-overlay"></div>
							<div class="lms-program-card-title">
								{{ program.title || program.name }}
							</div>
						</div>
						<div class="lms-program-card-body">
							<div class="flex items-center space-x-5 text-sm text-ink-gray-7">
								<div class="flex items-center space-x-1">
									<BookOpen class="size-3 stroke-1.5" />
									<span>
										{{ program.course_count }}
										{{
											program.course_count == 1 ? __('course') : __('courses')
										}}
									</span>
								</div>
								<div class="flex items-center space-x-1">
									<User class="size-4 stroke-1.5" />
									<span>
										{{ program.member_count || 0 }}
										{{
											program.member_count == 1
												? __('member')
												: __('members')
										}}
									</span>
								</div>
							</div>

							<div
								v-if="Object.keys(program).includes('progress')"
								class="mt-5 lms-student-program-progress"
							>
								<ProgressBar :progress="program.progress" />
								<div class="text-sm text-ink-gray-7 mt-1">
									{{ Math.ceil(program.progress) }}% {{ __('completed') }}
								</div>
							</div>
							<div v-else class="lms-program-card-cta">
								{{ __('Start Learning') }}
							</div>
						</div>
					</div>
				</div>
				<EmptyState v-else :type="getEmptyStateType(category)" />
				<!-- <div v-else class="col-span-3 text-center text-ink-gray-5">
                    {{ __('No programs found in this category.') }}
                </div> -->
			</div>
		</div>
	</div>
	<ProgramEnrollment
		v-model="showEnrollmentConfirmation"
		:programName="enrollmentProgram"
	/>
</template>
<script setup lang="ts">
import { createResource, TabButtons } from 'frappe-ui'
import { computed, ref, watch } from 'vue'
import { BookOpen, User } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { convertToTitleCase } from '@/utils'
import ProgressBar from '@/components/ProgressBar.vue'
import ProgramEnrollment from '@/pages/Programs/ProgramEnrollment.vue'
import EmptyState from '@/components/EmptyState.vue'

const currentTab = ref('published')
const router = useRouter()
const showEnrollmentConfirmation = ref(false)
const enrollmentProgram = ref(null)

const programs = createResource({
	url: 'lms.lms.utils.get_programs',
	auto: true,
})

watch(
	() => programs.data,
	(data) => {
		if (!data) return
		currentTab.value = data.enrolled?.length ? 'enrolled' : 'published'
	},
	{ immediate: true }
)

const getProgramGradient = (programName = '') => {
	const gradients = [
		'linear-gradient(135deg, #5f63ea 0%, #3b82f6 45%, #35b3f5 100%)',
		'linear-gradient(135deg, #f97316 0%, #ef4444 50%, #ec4899 100%)',
		'linear-gradient(135deg, #0ea5e9 0%, #6366f1 50%, #a855f7 100%)',
		'linear-gradient(135deg, #22c55e 0%, #14b8a6 50%, #06b6d4 100%)',
	]
	let seed = 0
	for (let i = 0; i < programName.length; i++) {
		seed += programName.charCodeAt(i)
	}
	return gradients[seed % gradients.length]
}

const openDetails = (programName: any, category: string) => {
	if (category === 'enrolled') {
		router.push({
			name: 'ProgramDetail',
			params: { programName: programName },
		})
	} else {
		showEnrollmentConfirmation.value = true
		enrollmentProgram.value = programName
	}
}

const tabs = computed(() => {
	return [
		{
			label: __('Available Levels'),
			value: 'published',
		},
		{
			label: __('My Levels'),
			value: 'enrolled',
		},
	]
})

const getEmptyStateType = (category: string) => {
	if (category === 'published') return __('Available Learning Levels')
	if (category === 'enrolled') return __('Enrolled Learning Levels')
	return convertToTitleCase(category) + ' ' + __('Programs')
}
</script>
