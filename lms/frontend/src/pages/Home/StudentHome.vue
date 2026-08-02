<template>
	<div class="lms-home-content">
		<div v-if="enrolledPrograms.length" class="lms-home-section mt-10">
			<div class="lms-home-section-header flex items-center justify-between mb-3">
				<span class="lms-home-section-title font-semibold text-lg text-ink-gray-9">
					{{ __('My Programs') }}
				</span>
				<router-link
					:to="{
						name: 'Programs',
					}"
				>
					<span class="lms-home-section-link flex items-center space-x-1 text-ink-gray-5 text-xs">
						<span>
							{{ __('See all') }}
						</span>
						<MoveRight class="size-3 stroke-1.5" />
					</span>
				</router-link>
			</div>
			<div class="lms-home-card-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
				<router-link
					v-for="program in enrolledPrograms"
					:key="program.name"
					:to="{ name: 'ProgramDetail', params: { programName: program.name } }"
				>
					<div class="lms-program-card border rounded-md cursor-pointer">
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
							</div>
							<div class="mt-5 lms-student-program-progress">
								<ProgressBar :progress="program.progress || 0" />
								<div class="text-sm text-ink-gray-7 mt-1">
									{{ Math.ceil(program.progress || 0) }}% {{ __('completed') }}
								</div>
							</div>
						</div>
					</div>
				</router-link>
			</div>
		</div>

		<div v-if="myBatches.data?.length" class="lms-home-section mt-10">
			<div class="lms-home-section-header flex items-center justify-between mb-3">
				<span class="lms-home-section-title font-semibold text-lg text-ink-gray-9">
					{{
						myBatches.data?.[0].students.includes(user.data?.name)
							? __('My Batches')
							: __('Our Upcoming Batches')
					}}
				</span>
				<router-link
					:to="{
						name: 'Batches',
					}"
				>
					<span class="lms-home-section-link flex items-center space-x-1 text-ink-gray-5 text-xs">
						<span>
							{{ __('See all') }}
						</span>
						<MoveRight class="size-3 stroke-1.5" />
					</span>
				</router-link>
			</div>
			<div class="lms-home-card-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
				<router-link
					v-for="batch in myBatches.data"
					:to="{ name: 'BatchDetail', params: { batchName: batch.name } }"
				>
					<BatchCard :batch="batch" />
				</router-link>
			</div>
		</div>

		<div class="lms-home-section grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-5 mt-10">
			<UpcomingEvaluations :forHome="true" class="lms-home-subsection" />
			<div v-if="myLiveClasses.data?.length" class="lms-home-subsection">
				<div class="lms-home-section-title font-semibold text-lg mb-3 text-ink-gray-9">
					{{ __('Upcoming Live Classes') }}
				</div>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-5">
					<div
						v-for="cls in myLiveClasses.data"
						class="lms-live-card border rounded-md hover:border-outline-gray-3 p-2"
					>
						<div class="font-semibold text-ink-gray-9 text-lg leading-5 mb-1">
							{{ cls.title }}
						</div>
						<div class="text-ink-gray-7 text-sm leading-5 mb-4">
							{{ cls.description }}
						</div>
						<div class="mt-auto space-y-3 text-ink-gray-7 text-sm">
							<div class="flex items-center space-x-2">
								<Calendar class="w-4 h-4 stroke-1.5" />
								<span>
									{{ dayjs(cls.date).format('DD MMMM YYYY') }}
								</span>
							</div>
							<div class="flex items-center space-x-2">
								<Clock class="w-4 h-4 stroke-1.5" />
								<span>
									{{ formatTime(cls.time) }} -
									{{ dayjs(getClassEnd(cls)).format('HH:mm A') }}
								</span>
							</div>
							<div
								v-if="canAccessClass(cls)"
								class="flex items-center space-x-2 text-ink-gray-9 mt-auto"
							>
								<a
									v-if="user.data?.is_moderator || user.data?.is_evaluator"
									:href="cls.start_url"
									target="_blank"
									class="cursor-pointer inline-flex items-center justify-center gap-2 transition-colors focus:outline-none text-ink-gray-8 bg-surface-gray-2 hover:bg-surface-gray-3 active:bg-surface-gray-4 focus-visible:ring focus-visible:ring-outline-gray-3 h-7 text-base px-2 rounded"
									:class="cls.join_url ? 'w-full' : 'w-1/2'"
								>
									<Monitor class="h-4 w-4 stroke-1.5" />
									{{ __('Start') }}
								</a>
								<a
									:href="cls.join_url"
									target="_blank"
									class="w-full cursor-pointer inline-flex items-center justify-center gap-2 transition-colors focus:outline-none text-ink-gray-8 bg-surface-gray-2 hover:bg-surface-gray-3 active:bg-surface-gray-4 focus-visible:ring focus-visible:ring-outline-gray-3 h-7 text-base px-2 rounded"
								>
									<Video class="h-4 w-4 stroke-1.5" />
									{{ __('Join') }}
								</a>
							</div>
							<Tooltip
								v-else-if="hasClassEnded(cls)"
								:text="__('This class has ended')"
								placement="right"
							>
								<div class="flex items-center space-x-2 text-ink-amber-3 w-fit">
									<Info class="w-4 h-4 stroke-1.5" />
									<span>
										{{ __('Ended') }}
									</span>
								</div>
							</Tooltip>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>
<script setup lang="ts">
import { computed, inject } from 'vue'
import { createResource, Tooltip } from 'frappe-ui'
import { formatTime } from '@/utils'
import {
	BookOpen,
	Calendar,
	Clock,
	Info,
	Monitor,
	MoveRight,
	Video,
} from 'lucide-vue-next'
import BatchCard from '@/components/BatchCard.vue'
import ProgressBar from '@/components/ProgressBar.vue'
import UpcomingEvaluations from '@/components/UpcomingEvaluations.vue'

const dayjs = inject<any>('$dayjs')
const user = inject<any>('$user')

const props = defineProps<{
	myLiveClasses: any
}>()

const programs = createResource({
	url: 'lms.lms.utils.get_programs',
	auto: true,
})

const enrolledPrograms = computed(() => {
	return programs.data?.enrolled || []
})

const myBatches = createResource({
	url: 'lms.lms.api.get_my_batches',
	auto: true,
})

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

const getClassEnd = (cls: { date: string; time: string; duration: number }) => {
	const classStart = new Date(`${cls.date}T${cls.time}`)
	return new Date(classStart.getTime() + cls.duration * 60000)
}

const canAccessClass = (cls: {
	date: string
	time: string
	duration: number
}) => {
	if (cls.date < dayjs().format('YYYY-MM-DD')) return false
	if (cls.date > dayjs().format('YYYY-MM-DD')) return false
	if (hasClassEnded(cls)) return false
	return true
}

const hasClassEnded = (cls: {
	date: string
	time: string
	duration: number
}) => {
	const classEnd = getClassEnd(cls)
	const now = new Date()
	return now > classEnd
}
</script>
