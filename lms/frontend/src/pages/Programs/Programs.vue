<template>
	<header
		class="lms-programs-header sticky top-0 z-10 border-b bg-surface-white px-3 py-2.5 sm:px-5"
	>
		<div class="flex items-center justify-between gap-3 w-full">
			<Breadcrumbs :items="breadcrumbs" />
			<Button
				v-if="canCreateProgram()"
				@click="openForm('new')"
				variant="solid"
				class="lms-programs-new-btn"
			>
				<template #prefix>
					<Plus class="h-4 w-4 stroke-1.5" />
				</template>
				{{ __('New Program') }}
			</Button>
		</div>
	</header>
	<div v-if="programCards.data?.length && !isStudent" class="lms-programs-page p-5 pb-10">
		<section class="lms-programs-hero mb-8">
			<div>
				<div class="lms-programs-overline text-sm font-semibold">
					{{ __('Program Studio') }}
				</div>
				<div class="lms-programs-title text-3xl font-semibold mt-1">
					{{ __('Build Learning Paths') }}
				</div>
				<div class="lms-programs-subtitle mt-2">
					{{
						__(
							'Design polished programs with courses, members, and clear structure.'
						)
					}}
				</div>
			</div>
			<div class="lms-programs-count-pill">
				{{
					__('{0} {1}').format(
						programCards.data.length,
						programCards.data.length == 1 ? __('Program') : __('Programs')
					)
				}}
			</div>
		</section>
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-8 lms-programs-grid">
			<div
				v-for="program in programCards.data"
				:key="program.name"
				@click="openProgramAnalytics(program.name)"
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
					<div class="flex items-center space-x-4 text-ink-gray-7">
						<div class="flex items-center space-x-1">
							<BookOpen class="h-4 w-4 stroke-1.5" />
							<span>
								{{ program.course_count }}
								{{ program.course_count == 1 ? __('Course') : __('Courses') }}
							</span>
						</div>
						<div class="flex items-center space-x-1">
							<User class="h-4 w-4 stroke-1.5" />
							<span>
								{{ program.member_count || 0 }}
								{{ program.member_count == 1 ? __('member') : __('members') }}
							</span>
						</div>
						<div class="flex items-center space-x-1">
							<School class="h-4 w-4 stroke-1.5" />
							<span>
								{{ program.school_count || 0 }}
								{{ program.school_count == 1 ? __('school') : __('schools') }}
							</span>
						</div>
					</div>
					<div class="mt-4 flex items-center justify-between">
						<div
							class="lms-program-status-chip"
							:class="program.published ? 'is-published' : 'is-draft'"
						>
							{{
								program.published ? __('Published') : __('Draft')
							}}
						</div>
						<div class="text-xs text-ink-gray-6">
							{{
								program.enforce_course_order
									? __('Ordered Path')
									: __('Flexible Path')
							}}
						</div>
					</div>
					<div class="lms-program-card-actions">
						<Button variant="solid" @click.stop="openProgramAnalytics(program.name)">
							<template #prefix>
								<Eye class="h-4 w-4 stroke-1.5" />
							</template>
							{{ __('View Program') }}
						</Button>
						<Button @click.stop="openForm(program.name)">
							<template #prefix>
								<Pencil class="h-4 w-4 stroke-1.5" />
							</template>
							{{ __('Edit') }}
						</Button>
					</div>
				</div>
			</div>
		</div>
	</div>
	<StudentPrograms v-else-if="isStudent" />
	<EmptyState v-else type="Programs" />
	<ProgramForm
		v-model="showForm"
		:programName="currentProgram"
		v-model:programs="programs"
	/>
</template>
<script setup>
import {
	Breadcrumbs,
	Button,
	createListResource,
	createResource,
	usePageMeta,
} from 'frappe-ui'
import { computed, inject, onMounted, ref, watch } from 'vue'
import { BookOpen, Eye, Pencil, Plus, School, User } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { sessionStore } from '@/stores/session'
import ProgramForm from '@/pages/Programs/ProgramForm.vue'
import EmptyState from '@/components/EmptyState.vue'
import StudentPrograms from '@/pages/Programs/StudentPrograms.vue'

const { brand } = sessionStore()
const router = useRouter()
const user = inject('$user')
const showForm = ref(false)
const currentProgram = ref(null)
const readOnlyMode = window.read_only_mode

onMounted(() => {
	if (!user.data) {
		window.location.href = '/lms-login'
	}
	if (user.data?.is_moderator || user.data?.is_instructor) {
		programs.reload()
		programCards.reload()
	}
})

const programCards = createResource({
	url: 'lms.lms.utils.get_program_cards',
	auto: false,
})

const programs = createListResource({
	doctype: 'LMS Program',
	cache: ['program'],
	fields: [
		'name',
		'title',
		'member_count',
		'course_count',
		'school_count',
		'published',
		'enforce_course_order',
		'enable_certification',
		'certificate_template',
		'certificate_image',
	],
	auto: false,
	orderBy: 'creation desc',
})

const canCreateProgram = () => {
	if (readOnlyMode) return false
	if (user.data?.is_moderator || user.data?.is_instructor) return true
	return false
}

const canViewProgramAnalytics = () => {
	if (user.data?.is_moderator || user.data?.is_instructor) return true
	return false
}

const openForm = (programName) => {
	if (!canCreateProgram()) return
	currentProgram.value = programName
	showForm.value = true
}

const openProgramAnalytics = (programName) => {
	if (!canViewProgramAnalytics()) return
	router.push({
		name: 'ProgramAnalytics',
		params: { programName },
	})
}

watch(showForm, (isOpen) => {
	if (!isOpen && canCreateProgram()) {
		programs.reload()
		programCards.reload()
	}
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

const isStudent = computed(() => {
	return user.data?.is_student || false
})

const breadcrumbs = computed(() => [
	{
		label: __('Programs'),
	},
])

usePageMeta(() => {
	return {
		title: __('Programs'),
		icon: brand.favicon,
	}
})
</script>
