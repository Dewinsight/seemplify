<template>
	<Dialog
		v-model="show"
		:options="{
			size: '2xl',
		}"
	>
		<template #body-title>
			<div class="flex items-center justify-between space-x-2 text-base w-full">
				<div class="text-xl font-semibold text-ink-gray-9">
					{{
						programName === 'new' ? __('Create Program') : __('Edit Program')
					}}
				</div>
				<Badge theme="orange" v-if="dirty">
					{{ __('Not Saved') }}
				</Badge>
			</div>
		</template>
		<template #body-content>
			<div class="text-base">
				<div class="grid grid-cols-1 md:grid-cols-2 gap-5 pb-5">
					<FormControl
						v-model="program.name"
						:label="__('Title')"
						type="text"
						:required="true"
						@change="dirty = true"
					/>
					<div class="flex flex-col space-y-3">
						<FormControl
							v-model="program.published"
							:label="__('Published')"
							type="checkbox"
							@change="dirty = true"
						/>
						<FormControl
							v-model="program.enforce_course_order"
							:label="__('Enforce Course Order')"
							type="checkbox"
							@change="dirty = true"
						/>
					</div>
				</div>
				<div class="pb-5 lms-program-form-image-wrap">
					<div class="text-xs text-ink-gray-5 mb-2">
						{{ __('Program Cover Image') }}
					</div>
					<FileUploader
						v-if="!program.image"
						:fileTypes="['image/*']"
						:validateFile="validateFile"
						@success="(file) => saveImage(file)"
					>
						<template #default="{ progress, uploading, openFileSelector }">
							<div class="lms-program-form-image-upload-shell">
								<div
									class="lms-program-form-image-placeholder"
									@click="openFileSelector"
								>
									<Image class="size-6 stroke-1.5 text-ink-gray-6" />
								</div>
								<div>
									<Button @click="openFileSelector" :loading="uploading">
										{{
											uploading
												? __('Uploading {0}%').format(
														Math.round(progress || 0)
													)
												: __('Upload Cover')
										}}
									</Button>
									<div class="mt-1 text-sm text-ink-gray-6">
										{{ __('Displayed on program cards and detail pages.') }}
									</div>
								</div>
							</div>
						</template>
					</FileUploader>
					<div v-else class="lms-program-form-image-preview-shell">
						<img
							:src="program.image"
							:alt="program.name || __('Program')"
							class="lms-program-form-image-preview"
						/>
						<div>
							<Button @click="removeImage()" variant="outline">
								{{ __('Remove') }}
							</Button>
							<div class="mt-1 text-sm text-ink-gray-6">
								{{ __('Displayed on program cards and detail pages.') }}
							</div>
						</div>
					</div>
				</div>

				<div class="pb-5 border-t pt-5">
					<div class="text-lg font-semibold text-ink-gray-9 mb-4">
						{{ __('Certification') }}
					</div>
					<div class="grid grid-cols-1 md:grid-cols-2 gap-5">
						<div class="space-y-4">
							<FormControl
								v-model="program.enable_certification"
								:label="__('Enable Program Certificate')"
								type="checkbox"
								@change="dirty = true"
							/>
							<Link
								v-if="program.enable_certification"
								v-model="program.certificate_template"
								doctype="Print Format"
								:filters="{ doc_type: 'LMS Certificate' }"
								:label="__('Certificate Template')"
								@change="dirty = true"
							/>
						</div>
						<div v-if="program.enable_certification">
							<div class="text-xs text-ink-gray-5 mb-2">
								{{ __('Certificate Image') }}
							</div>
							<FileUploader
								v-if="!program.certificate_image"
								:fileTypes="['image/*']"
								:validateFile="validateFile"
								@success="(file) => saveCertificateImage(file)"
							>
								<template #default="{ progress, uploading, openFileSelector }">
									<div class="lms-program-form-image-upload-shell">
										<div
											class="lms-program-form-image-placeholder"
											@click="openFileSelector"
										>
											<Image class="size-6 stroke-1.5 text-ink-gray-6" />
										</div>
										<div>
											<Button @click="openFileSelector" :loading="uploading">
												{{
													uploading
														? __('Uploading {0}%').format(
																Math.round(progress || 0)
															)
														: __('Upload Image')
												}}
											</Button>
											<div class="mt-1 text-sm text-ink-gray-6">
												{{ __('Shown on generated program certificates.') }}
											</div>
										</div>
									</div>
								</template>
							</FileUploader>
							<div v-else class="lms-program-form-image-preview-shell">
								<img
									:src="program.certificate_image"
									:alt="__('Certificate Image')"
									class="lms-program-form-certificate-image-preview"
								/>
								<div>
									<Button @click="removeCertificateImage()" variant="outline">
										{{ __('Remove') }}
									</Button>
									<div class="mt-1 text-sm text-ink-gray-6">
										{{ __('Shown on generated program certificates.') }}
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div class="pb-5 border-t pt-5">
					<div class="flex items-center justify-between mt-2 mb-4">
						<div class="text-lg font-semibold text-ink-gray-9">
							{{ __('Schools') }}
						</div>
						<Button @click="openForm('school')">
							<template #prefix>
								<Plus class="h-4 w-4 stroke-1.5" />
							</template>
							<span>
								{{ __('Add') }}
							</span>
						</Button>
					</div>
					<ListView
						v-if="program.program_schools?.length > 0"
						:columns="schoolColumns"
						:rows="program.program_schools"
						:options="{
							selectable: true,
							resizeColumn: true,
							showTooltip: false,
						}"
						rowKey="school"
					>
						<ListHeader
							class="mb-2 grid items-center space-x-4 rounded bg-surface-gray-2 p-2"
						>
							<ListHeaderItem :item="item" v-for="item in schoolColumns" />
						</ListHeader>
						<ListRows>
							<ListRow :row="row" v-for="row in program.program_schools" />
						</ListRows>
						<ListSelectBanner>
							<template #actions="{ unselectAll, selections }">
								<div class="flex gap-2">
									<Button
										variant="ghost"
										@click="remove(selections, unselectAll, 'schools')"
									>
										<Trash2 class="h-4 w-4 stroke-1.5" />
									</Button>
								</div>
							</template>
						</ListSelectBanner>
					</ListView>
					<div v-else class="text-ink-gray-7">
						{{ __('No schools assigned yet. Unassigned programs remain visible to learners without a school assignment.') }}
					</div>
				</div>

				<div class="pb-5">
					<div class="flex items-center justify-between mt-5 mb-4">
						<div class="text-lg font-semibold text-ink-gray-9">
							{{ __('Courses') }}
						</div>
						<Button @click="openForm('course')">
							<template #prefix>
								<Plus class="h-4 w-4 stroke-1.5" />
							</template>
							<span>
								{{ __('Add') }}
							</span>
						</Button>
					</div>
					<ListView
						v-if="program.program_courses?.length > 0"
						:columns="courseColumns"
						:rows="program.program_courses"
						:options="{
							selectable: true,
							resizeColumn: true,
							showTooltip: false,
						}"
						:rowKey="programName === 'new' ? 'course' : 'name'"
					>
						<ListHeader
							class="mb-2 grid items-center space-x-4 rounded bg-surface-gray-2 p-2"
						>
							<ListHeaderItem :item="item" v-for="item in courseColumns" />
						</ListHeader>
						<ListRows>
							<Draggable
								:list="program.program_courses"
								:item-key="programName === 'new' ? 'course' : 'name'"
								group="items"
								@end="updateOrder"
								class="cursor-move"
							>
								<template #item="{ element: row }">
									<ListRow :row="row" />
								</template>
							</Draggable>
						</ListRows>
						<ListSelectBanner>
							<template #actions="{ unselectAll, selections }">
								<div class="flex gap-2">
									<Button
										variant="ghost"
										@click="remove(selections, unselectAll, 'courses')"
									>
										<Trash2 class="h-4 w-4 stroke-1.5" />
									</Button>
								</div>
							</template>
						</ListSelectBanner>
					</ListView>
					<div v-else class="text-ink-gray-7">
						{{ __('No courses added yet.') }}
					</div>
				</div>

				<div>
					<div class="flex items-center justify-between mt-5 mb-4">
						<div class="text-lg font-semibold text-ink-gray-9">
							{{ __('Members') }}
						</div>

						<div class="space-x-2">
							<Button
								v-if="(programMembers.data?.length || 0) > 0"
								@click="
									() => {
										showProgressDialog = true
									}
								"
							>
								<template #prefix>
									<TrendingUp class="size-4 stroke-1.5" />
								</template>
								{{ __('Progress Summary') }}
							</Button>
							<Button @click="openForm('member')">
								<template #prefix>
									<Plus class="h-4 w-4 stroke-1.5" />
								</template>
								{{ __('Add') }}
							</Button>
						</div>
					</div>
					<ListView
						v-if="program.program_members?.length > 0"
						:columns="memberColumns"
						:rows="program.program_members"
						:options="{
							selectable: true,
							resizeColumn: true,
						}"
						:rowKey="programName === 'new' ? 'member' : 'name'"
					>
						<ListHeader
							class="mb-2 grid items-center space-x-4 rounded bg-surface-gray-2 p-2"
						>
							<ListHeaderItem :item="item" v-for="item in memberColumns" />
						</ListHeader>
						<ListRows>
							<ListRow :row="row" v-for="row in program.program_members" />
						</ListRows>
						<ListSelectBanner>
							<template #actions="{ unselectAll, selections }">
								<div class="flex gap-2">
									<Button
										variant="ghost"
										@click="remove(selections, unselectAll, 'members')"
									>
										<Trash2 class="h-4 w-4 stroke-1.5" />
									</Button>
								</div>
							</template>
						</ListSelectBanner>
					</ListView>
					<div v-else class="text-ink-gray-7">
						{{ __('No members added yet.') }}
					</div>
				</div>
			</div>
			<Dialog
				v-model="showFormDialog"
				:options="{
					title: formDialogTitle,
					actions: [
						{
							label: __('Add'),
							variant: 'solid',
							onClick: ({ close }: { close: () => void }) =>
								addCurrentFormItem(close),
						},
					],
				}"
			>
				<template #body-content>
					<div @click.stop>
						<Link
							v-if="currentForm == 'course'"
							v-model="course"
							doctype="LMS Course"
							:label="__('Course')"
						/>

						<Link
							v-if="currentForm == 'member'"
							v-model="member"
							doctype="User"
							:filters="{
								ignore_user_type: 1,
							}"
							:label="__('Program Member')"
							:onCreate="(value: string, close: () => void) => openSettings('Members', close)"
						/>

						<Link
							v-if="currentForm == 'school'"
							v-model="school"
							doctype="LMS School"
							:label="__('School')"
						/>
					</div>
				</template>
			</Dialog>

			<ProgramProgressSummary
				v-model="showProgressDialog"
				:programName="programName"
				:programMembers="programMembers.data"
			/>
		</template>
		<template #actions="{ close }">
			<div class="flex justify-end space-x-2">
				<Button
					v-if="programName != 'new'"
					@click="deleteProgram(close)"
					variant="outline"
					theme="red"
				>
					<template #prefix>
						<Trash2 class="size-4 stroke-1.5" />
					</template>
					{{ __('Delete') }}
				</Button>
				<Button variant="solid" @click="saveProgram(close)">
					{{ __('Save') }}
				</Button>
			</div>
		</template>
	</Dialog>
</template>
<script setup lang="ts">
import {
	Badge,
	Button,
	createListResource,
	call,
	Dialog,
	FileUploader,
	FormControl,
	ListSelectBanner,
	ListView,
	ListHeader,
	ListHeaderItem,
	ListRows,
	ListRow,
	toast,
} from 'frappe-ui'
import { computed, ref, watch, getCurrentInstance } from 'vue'
import { Image, Plus, Trash2, TrendingUp } from 'lucide-vue-next'
import type {
	Program,
	ProgramCourse,
	ProgramMember,
	ProgramSchool,
	Programs,
} from '@/pages/Programs/types'
import { escapeHTML, openSettings, validateFile } from '@/utils'
import Link from '@/components/Controls/Link.vue'
import Draggable from 'vuedraggable'
import ProgramProgressSummary from '@/pages/Programs/ProgramProgressSummary.vue'

const show = defineModel<boolean>()
const programs = defineModel<Programs>('programs')
const showFormDialog = ref(false)
const currentForm = ref<'course' | 'member' | 'school'>('course')
const course = ref<string>('')
const member = ref<string>('')
const school = ref<string>('')
const showProgressDialog = ref(false)
const dirty = ref(false)

const app = getCurrentInstance()
const { $dialog } = app.appContext.config.globalProperties

const props = withDefaults(
	defineProps<{
		programName: string | null
	}>(),
	{
		programName: 'new',
	}
)

const getEmptyProgram = (): Program => ({
	name: '',
	title: '',
	image: '',
	published: false,
	enforce_course_order: false,
	enable_certification: false,
	certificate_template: '',
	certificate_image: '',
	program_courses: [],
	program_members: [],
	program_schools: [],
	course_count: 0,
	member_count: 0,
	school_count: 0,
})

const normalizeProgram = (data?: Partial<Program>): Program => ({
	...getEmptyProgram(),
	...(data || {}),
	program_courses: data?.program_courses || [],
	program_members: data?.program_members || [],
	program_schools: data?.program_schools || [],
})

const program = ref<Program>(getEmptyProgram())

watch(
	() => props.programName,
	() => {
		setProgramData()
		fetchCourses()
		fetchMembers()
		fetchSchools()
	}
)

const setProgramData = () => {
	let isNew = true
	programs.value?.data.forEach((p: Program) => {
		if (p.name === props.programName) {
			isNew = false
			program.value = normalizeProgram(p)
		}
	})

	if (isNew) {
		program.value = getEmptyProgram()
	} else if (props.programName && props.programName !== 'new') {
		void loadProgramImage(props.programName)
	}
	dirty.value = false
}

const getApiData = (response: any) => {
	return response?.message || response || {}
}

const loadProgramImage = async (programName: string) => {
	try {
		const response = await call('lms.lms.utils.get_program_image', {
			program_name: programName,
		})
		const data = getApiData(response)
		program.value.image = data.image || ''
	} catch (error) {
		console.error('Failed to load program image', error)
		program.value.image = ''
	}
}

const persistProgramImage = async (programName: string) => {
	await call('lms.lms.utils.set_program_image', {
		program_name: programName,
		image: program.value.image || '',
	})
}

const programCourses = createListResource({
	doctype: 'LMS Program Course',
	fields: ['course', 'course_title', 'name', 'idx'],
	cache: ['programCourses', props.programName],
	parent: 'LMS Program',
	orderBy: 'idx',
	onSuccess(data: ProgramCourse[]) {
		program.value.program_courses = data
	},
})

const programMembers = createListResource({
	doctype: 'LMS Program Member',
	fields: ['member', 'full_name', 'progress', 'name'],
	cache: ['programMembers', props.programName],
	parent: 'LMS Program',
	orderBy: 'creation desc',
	onSuccess(data: ProgramMember[]) {
		program.value.program_members = data
	},
})

const programSchools = createListResource({
	doctype: 'LMS Program School',
	fields: ['school', 'school_title', 'name', 'idx'],
	cache: ['programSchools', props.programName],
	parent: 'LMS Program',
	orderBy: 'idx',
	onSuccess(data: ProgramSchool[]) {
		program.value.program_schools = data
	},
})

const fetchCourses = () => {
	programCourses.update({
		filters: {
			parent: props.programName,
			parenttype: 'LMS Program',
			parentfield: 'program_courses',
		},
	})
	programCourses.reload()
}

const fetchMembers = () => {
	programMembers.update({
		filters: {
			parent: props.programName,
			parenttype: 'LMS Program',
		},
	})
	programMembers.reload()
}

const fetchSchools = () => {
	programSchools.update({
		filters: {
			parent: props.programName,
			parenttype: 'LMS Program',
			parentfield: 'program_schools',
		},
	})
	programSchools.reload()
}

const validateTitle = () => {
	program.value.name = escapeHTML(program.value.name.trim())
}

const saveProgram = (close: () => void) => {
	validateTitle()
	if (props.programName === 'new') createNewProgram(close)
	else updateProgram(close)
	dirty.value = false
}

const createNewProgram = (close: () => void) => {
	const payload = getProgramPayload()
	programs.value.insert.submit(
		{
			...payload,
			title: payload.name,
		},
		{
			async onSuccess() {
				try {
					await persistProgramImage(payload.name)
				} catch (error) {
					console.error('Failed to save program image', error)
					toast.warning(
						__(
							'Program created, but image could not be saved. Please try uploading again.'
						)
					)
				}
				close()
				programs.value.reload()
				toast.success(__('Program created successfully'))
			},
			onError(err: any) {
				toast.warning(__(err.messages?.[0] || err))
			},
		}
	)
}

const updateProgram = (close: () => void) => {
	const payload = getProgramPayload()
	programs.value.setValue.submit(
		{
			name: props.programName,
			...payload,
		},
		{
			async onSuccess() {
				try {
					if (props.programName) {
						await persistProgramImage(props.programName)
					}
				} catch (error) {
					console.error('Failed to save program image', error)
					toast.warning(
						__(
							'Program updated, but image could not be saved. Please try uploading again.'
						)
					)
				}
				close()
				programs.value.reload()
				toast.success(__('Program updated successfully'))
			},
			onError(err: any) {
				toast.warning(__(err.messages?.[0] || err))
			},
		}
	)
}

const openForm = (formType: 'course' | 'member' | 'school') => {
	currentForm.value = formType
	showFormDialog.value = true
	if (formType === 'course') {
		course.value = ''
	} else if (formType === 'member') {
		member.value = ''
	} else {
		school.value = ''
	}
}

const formDialogTitle = computed(() => {
	if (currentForm.value === 'course') return __('Add Course to Program')
	if (currentForm.value === 'member') return __('Enroll Member to Program')
	return __('Assign Program to School')
})

const addCurrentFormItem = (close: () => void) => {
	if (currentForm.value === 'course') return addCourse(close)
	if (currentForm.value === 'member') return addMember(close)
	return addSchool(close)
}

const addCourse = (close: () => void) => {
	if (!course.value) {
		toast.warning(__('Please select a course'))
		return
	}

	const existingCourse = program.value.program_courses.find(
		(c: any) => c.course === course.value
	)
	if (!existingCourse) {
		program.value.program_courses.push({
			course: course.value,
			idx: program.value.program_courses.length + 1,
		})
		if (props.programName !== 'new') {
			dirty.value = true
		}
		close()
		toast.success(__('Course added to program successfully'))
	} else {
		toast.warning(__('Course already added to program'))
	}
}

const getProgramPayload = () => {
	const payload = { ...program.value }
	delete payload.image
	return payload
}

const saveImage = (file: { file_url: string }) => {
	program.value.image = file.file_url
	dirty.value = true
}

const removeImage = () => {
	program.value.image = ''
	dirty.value = true
}

const saveCertificateImage = (file: { file_url: string }) => {
	program.value.certificate_image = file.file_url
	dirty.value = true
}

const removeCertificateImage = () => {
	program.value.certificate_image = ''
	dirty.value = true
}

const addMember = (close: () => void) => {
	if (!member.value) {
		toast.warning(__('Please select a member'))
		return
	}

	const existingMember = program.value.program_members.find(
		(m) => m.member === member.value
	)
	if (!existingMember) {
		program.value.program_members.push({
			member: member.value,
		})
		if (props.programName !== 'new') {
			dirty.value = true
		}
		close()
		toast.success(__('Member added to program successfully'))
	} else {
		toast.warning(__('Member already added to program'))
	}
}

const addSchool = (close: () => void) => {
	if (!school.value) {
		toast.warning(__('Please select a school'))
		return
	}

	const existingSchool = program.value.program_schools.find(
		(s) => s.school === school.value
	)
	if (!existingSchool) {
		program.value.program_schools.push({
			school: school.value,
			school_title: school.value,
			idx: program.value.program_schools.length + 1,
		})
		if (props.programName !== 'new') {
			dirty.value = true
		}
		close()
		toast.success(__('School assigned to program successfully'))
	} else {
		toast.warning(__('School already assigned to program'))
	}
}

const updateCounts = async (
	type: 'member' | 'course',
	action: 'add' | 'remove'
) => {
	if (!props.programName) return

	let memberCount = programMembers.data?.length || 0
	let courseCount = programCourses.data?.length || 0

	if (type === 'member') {
		memberCount += action === 'add' ? 1 : -1
	} else {
		courseCount += action === 'add' ? 1 : -1
	}

	await programs.value.setValue.submit(
		{
			name: props.programName,
			member_count: memberCount,
			course_count: courseCount,
		},
		{
			onSuccess() {
				setProgramData()
			},
			onError(err: any) {
				toast.warning(__(err.messages?.[0] || err))
			},
		}
	)
}

const updateOrder = async (e: DragEvent) => {
	let sourceIdx = e.from.dataset.idx
	let targetIdx = e.to.dataset.idx

	if (props.programName === 'new') {
		let courses = program.value.program_courses
		courses.splice(targetIdx, 0, courses.splice(sourceIdx, 1)[0])
		courses.forEach((course, index) => {
			course.idx = index + 1
		})
		dirty.value = true
	} else {
		let courses = programCourses.data
		courses.splice(targetIdx, 0, courses.splice(sourceIdx, 1)[0])

		for (const [index, course] of courses.entries()) {
			programCourses.setValue.submit(
				{
					name: course.name,
					idx: index + 1,
				},
				{
					onError(err: any) {
						toast.warning(__(err.messages?.[0] || err))
					},
				}
			)
			await wait(100)
		}
	}
}

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms))

const remove = (
	selections: string[],
	unselectAll: () => void,
	type: string
) => {
	const selectionsArray = Array.from(selections)
	if (type === 'courses') {
		program.value.program_courses = program.value.program_courses.filter(
			(c: any) => !selectionsArray.includes(c.name || c.course)
		)
	} else if (type === 'members') {
		program.value.program_members = program.value.program_members.filter(
			(m: any) => !selectionsArray.includes(m.name || m.member)
		)
	} else {
		program.value.program_schools = program.value.program_schools.filter(
			(s: any) => !selectionsArray.includes(s.name || s.school)
		)
	}
	dirty.value = true
	unselectAll()
}

const deleteProgram = (close: () => void) => {
	if (props.programName == 'new') return
	$dialog({
		title: __('Delete Program'),
		message: __(
			'Are you sure you want to delete this program? This action cannot be undone.'
		),
		actions: [
			{
				label: __('Delete'),
				theme: 'red',
				variant: 'solid',
				onClick(closeDialog) {
					programs.value?.delete.submit(props.programName, {
						onSuccess() {
							toast.success(__('Program deleted successfully'))
							close()
							closeDialog()
						},
						onError(err: any) {
							toast.warning(__(err.messages?.[0] || err))
							closeDialog()
						},
					})
				},
			},
		],
	})
}

const courseColumns = computed(() => {
	return [
		{
			label: 'Title',
			key: props.programName === 'new' ? 'course' : 'course_title',
			width: 1,
		},
	]
})

const memberColumns = computed(() => {
	return [
		{
			label: 'Member',
			key: 'member',
			width: 3,
			align: 'left',
		},
		{
			label: 'Full Name',
			key: 'full_name',
			width: 3,
			align: 'left',
		},
	]
})

const schoolColumns = computed(() => {
	return [
		{
			label: 'School',
			key: 'school_title',
			width: 1,
		},
	]
})
</script>
