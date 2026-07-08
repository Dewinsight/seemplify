<template>
	<header
		class="lms-program-detail-header sticky top-0 z-10 flex items-center justify-between border-b bg-surface-white px-3 py-2.5 sm:px-5"
	>
		<Breadcrumbs :items="breadcrumbs" />
	</header>
	<div v-if="program.data" class="lms-program-detail-page pt-5 px-5 pb-10 mx-auto">
		<div class="lms-program-detail-hero mb-8">
			<div class="lms-program-detail-cover">
				<img
					v-if="program.data.image"
					:src="program.data.image"
					:alt="program.data.title || program.data.name"
					class="lms-program-detail-cover-image"
				/>
				<div
					v-else
					class="lms-program-detail-cover-fallback"
					:style="{ background: getProgramGradient(program.data.name) }"
				></div>
				<div class="lms-program-detail-cover-overlay"></div>
				<div class="lms-program-detail-cover-title">
					{{ program.data.title || program.data.name }}
				</div>
			</div>
			<div class="lms-program-detail-meta">
				<div class="flex items-center flex-wrap gap-2">
					<Badge :theme="(program.data.progress || 0) < 100 ? 'orange' : 'green'">
						{{ program.data.progress || 0 }}% {{ __('completed') }}
					</Badge>
					<Tooltip
						v-if="program.data.enforce_course_order"
						placement="right"
						:text="
							__(
								'Courses must be completed in order. You can only start the next course after completing the previous one.'
							)
						"
					>
						<Info class="size-3 cursor-pointer" />
					</Tooltip>
				</div>
				<div class="lms-program-detail-meta-copy mt-3">
					{{
						__('{0} courses | {1} members').format(
							program.data.course_count || 0,
							program.data.member_count || 0
						)
					}}
				</div>
				<div
					v-if="program.data.enable_certification && (program.data.progress || 0) >= 100"
					class="mt-4 flex flex-wrap items-center gap-3"
				>
					<Button
						variant="solid"
						:loading="programCertificate.loading"
						@click="openProgramCertificate"
					>
						<template #prefix>
							<Award class="size-4 stroke-1.5" />
						</template>
						{{
							program.data.certificate
								? __('View Program Certificate')
								: __('Get Program Certificate')
						}}
					</Button>
				</div>
			</div>
		</div>
		<div class="lms-program-detail-section-title text-lg font-semibold text-ink-gray-9 mb-4">
			{{ __('Courses in this Program') }}
		</div>
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-5">
			<div
				v-for="course in program.data.courses"
				:key="course.name"
				class="relative group"
				:class="
					(course.eligible && program.data.enforce_course_order) ||
					!program.data.enforce_course_order
						? 'cursor-pointer'
						: 'cursor-default'
				"
			>
				<CourseCard
					:course="course"
					@click="openCourse(course, program.data.enforce_course_order)"
				/>
				<div
					v-if="!course.eligible && program.data.enforce_course_order"
					class="absolute inset-0 flex flex-col items-center justify-center space-y-2 text-ink-white rounded-md invisible group-hover:visible"
					:style="{
						background: 'radial-gradient(circle, darkgray 0%, lightgray 100%)',
					}"
				>
					<LockKeyhole class="size-5" />
					<span class="font-medium text-center leading-5 px-10">
						{{ __('Please complete the previous course to unlock this one.') }}
					</span>
				</div>
			</div>
		</div>
	</div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
	Badge,
	Breadcrumbs,
	Button,
	call,
	createResource,
	Tooltip,
	toast,
	usePageMeta,
} from 'frappe-ui'
import { sessionStore } from '@/stores/session'
import { Award, LockKeyhole, Info } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import CourseCard from '@/components/CourseCard.vue'

const { brand } = sessionStore()
const router = useRouter()
const enrollmentCheckComplete = ref(false)
const enrollmentCheckInProgress = ref(false)

const props = defineProps<{
	programName: string
}>()

const wait = (delay: number) => {
	return new Promise((resolve) => setTimeout(resolve, delay))
}

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

const isProgramEnrolled = (data: any) => {
	const enrolledPrograms = data?.enrolled || data?.message?.enrolled || []
	return enrolledPrograms.some((program: { name: string }) => {
		return program.name === props.programName
	})
}

const getProgramMembership = async () => {
	const retryDelays = [0, 200, 400]
	for (const delay of retryDelays) {
		if (delay) {
			await wait(delay)
		}
		try {
			const data = await call('lms.lms.utils.get_programs')
			if (isProgramEnrolled(data)) {
				return props.programName
			}
		} catch (error) {
			if (delay === retryDelays[retryDelays.length - 1]) {
				throw error
			}
		}
	}
	return null
}

const checkIfEnrolled = async () => {
	if (enrollmentCheckInProgress.value || enrollmentCheckComplete.value) return
	if (!props.programName) return

	enrollmentCheckInProgress.value = true
	try {
		const membershipName = await getProgramMembership()
		if (!membershipName) {
			router.push({ name: 'Programs' })
			return
		}
		await program.reload()
		enrollmentCheckComplete.value = true
	} catch (error) {
		console.error('Failed to verify program enrollment', error)
		router.push({ name: 'Programs' })
	} finally {
		enrollmentCheckInProgress.value = false
	}
}

const program = createResource({
	url: 'lms.lms.utils.get_program_details',
	params: {
		program_name: props.programName,
	},
})

const programCertificate = createResource({
	url: 'lms.lms.doctype.lms_certificate.lms_certificate.create_program_certificate',
})

watch(
	() => props.programName,
	() => {
		enrollmentCheckComplete.value = false
		checkIfEnrolled()
	},
	{ immediate: true }
)

const openCourse = (course: any, enforceCourseOrder: boolean) => {
	if (!course.eligible && enforceCourseOrder) return
	router.push({
		name: 'CourseDetail',
		params: { courseName: course.name },
	})
}

const openProgramCertificate = () => {
	if (program.data?.certificate) {
		openCertificate(program.data.certificate)
		return
	}

	programCertificate.submit(
		{
			program: props.programName,
		},
		{
			onSuccess(data: any) {
				const certificate = data?.message || data
				if (certificate?.name) {
					program.data.certificate = certificate
					openCertificate(certificate)
				}
			},
			onError(err: any) {
				toast.warning(__(err.messages?.[0] || err))
			},
		}
	)
}

const openCertificate = (certificate: any) => {
	window.open(
		`/api/method/frappe.utils.print_format.download_pdf?doctype=LMS+Certificate&name=${
			certificate.name
		}&format=${encodeURIComponent(certificate.template)}`
	)
}

const breadcrumbs = computed(() => {
	return [
		{ label: __('Programs'), route: { name: 'Programs' } },
		{
			label: props.programName,
			route: {
				name: 'ProgramDetail',
				params: { programName: props.programName },
			},
		},
	]
})

usePageMeta(() => {
	return {
		title: program.data?.title || props.programName,
		icon: brand.favicon,
	}
})
</script>
