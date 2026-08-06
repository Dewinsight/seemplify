<template>
	<header
		class="sticky top-0 z-10 flex items-center justify-between border-b bg-surface-white px-3 py-2.5 sm:px-5"
	>
		<Breadcrumbs :items="breadcrumbs" />
		<Button variant="solid" @click="openSchoolForm('new')">
			<template #prefix>
				<Plus class="h-4 w-4 stroke-1.5" />
			</template>
			{{ __('New School') }}
		</Button>
	</header>

	<div class="p-5">
		<div v-if="schools.data?.length" class="overflow-hidden rounded-md border bg-surface-white">
			<div class="grid grid-cols-[minmax(0,1fr)_9rem_8rem_8rem] gap-4 border-b bg-surface-gray-2 px-4 py-2 text-sm font-medium text-ink-gray-7">
				<span>{{ __('School') }}</span>
				<span>{{ __('Code') }}</span>
				<span>{{ __('Members') }}</span>
				<span>{{ __('Status') }}</span>
			</div>
			<button
				v-for="schoolRow in schools.data"
				:key="schoolRow.name"
				class="grid w-full grid-cols-[minmax(0,1fr)_9rem_8rem_8rem] gap-4 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-surface-menu-bar"
				@click="openSchoolForm(schoolRow.name)"
			>
				<span class="min-w-0 truncate font-medium text-ink-gray-9">
					{{ schoolRow.title || schoolRow.name }}
				</span>
				<span class="text-ink-gray-7">{{ schoolRow.school_code || '-' }}</span>
				<span class="text-ink-gray-7">{{ schoolRow.member_count || 0 }}</span>
				<span>
					<Badge :theme="schoolRow.published ? 'green' : 'orange'">
						{{ schoolRow.published ? __('Published') : __('Draft') }}
					</Badge>
				</span>
			</button>
		</div>
		<EmptyState v-else type="Schools" />
	</div>

	<Dialog
		v-model="showSchoolDialog"
		:options="{ size: '2xl' }"
	>
		<template #body-title>
			<div class="text-xl font-semibold text-ink-gray-9">
				{{ currentSchool === 'new' ? __('Create School') : __('Edit School') }}
			</div>
		</template>
		<template #body-content>
			<div class="space-y-5 text-base">
				<div class="grid grid-cols-1 gap-5 md:grid-cols-2">
					<FormControl
						v-model="school.title"
						:label="__('School Name')"
						type="text"
						:required="true"
					/>
					<FormControl
						v-model="school.school_code"
						:label="__('School Code')"
						type="text"
					/>
					<FormControl
						v-model="school.published"
						:label="__('Published')"
						type="checkbox"
					/>
				</div>
				<label class="block">
					<span class="mb-1 block text-sm text-ink-gray-7">
						{{ __('Description') }}
					</span>
					<textarea
						v-model="school.description"
						class="min-h-20 w-full rounded border border-outline-gray-2 bg-surface-white px-3 py-2 text-base text-ink-gray-9 outline-none focus:border-outline-gray-4"
					></textarea>
				</label>

				<div>
					<div class="mb-4 flex items-center justify-between">
						<div class="text-lg font-semibold text-ink-gray-9">
							{{ __('School Members') }}
						</div>
						<Button @click="openMemberDialog">
							<template #prefix>
								<Plus class="h-4 w-4 stroke-1.5" />
							</template>
							{{ __('Add') }}
						</Button>
					</div>
					<ListView
						v-if="school.school_members?.length"
						:columns="memberColumns"
						:rows="school.school_members"
						:options="{ selectable: true, resizeColumn: true }"
						:rowKey="currentSchool === 'new' ? 'member' : 'name'"
					>
						<ListHeader
							class="mb-2 grid items-center space-x-4 rounded bg-surface-gray-2 p-2"
						>
							<ListHeaderItem :item="item" v-for="item in memberColumns" />
						</ListHeader>
						<ListRows>
							<ListRow :row="row" v-for="row in school.school_members" />
						</ListRows>
						<ListSelectBanner>
							<template #actions="{ unselectAll, selections }">
								<Button
									variant="ghost"
									@click="removeMembers(selections, unselectAll)"
								>
									<Trash2 class="h-4 w-4 stroke-1.5" />
								</Button>
							</template>
						</ListSelectBanner>
					</ListView>
					<div v-else class="text-ink-gray-7">
						{{ __('No members assigned yet.') }}
					</div>
				</div>
			</div>
		</template>
		<template #actions="{ close }">
			<div class="flex justify-end space-x-2">
				<Button
					v-if="currentSchool !== 'new'"
					variant="outline"
					theme="red"
					@click="deleteSchool(close)"
				>
					<template #prefix>
						<Trash2 class="h-4 w-4 stroke-1.5" />
					</template>
					{{ __('Delete') }}
				</Button>
				<Button variant="solid" @click="saveSchool(close)">
					{{ __('Save') }}
				</Button>
			</div>
		</template>
	</Dialog>

	<Dialog
		v-model="showMemberDialog"
		:options="{
			title: __('Add School Member'),
			actions: [
				{
					label: __('Add'),
					variant: 'solid',
					onClick: ({ close }) => addMember(close),
				},
			],
		}"
	>
		<template #body-content>
			<div class="space-y-4">
				<Link
					v-model="member"
					doctype="User"
					:filters="{ ignore_user_type: 1 }"
					:label="__('Member')"
				/>
				<FormControl
					v-model="memberAllSchools"
					:label="__('Give access to all schools')"
					type="checkbox"
				/>
			</div>
		</template>
	</Dialog>
</template>

<script setup>
import {
	Badge,
	Breadcrumbs,
	Button,
	createListResource,
	Dialog,
	FormControl,
	ListHeader,
	ListHeaderItem,
	ListRow,
	ListRows,
	ListSelectBanner,
	ListView,
	toast,
	usePageMeta,
} from 'frappe-ui'
import { computed, ref } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import EmptyState from '@/components/EmptyState.vue'
import Link from '@/components/Controls/Link.vue'
import { escapeHTML } from '@/utils'
import { sessionStore } from '@/stores/session'

const { brand } = sessionStore()
const showSchoolDialog = ref(false)
const showMemberDialog = ref(false)
const currentSchool = ref('new')
const member = ref('')
const memberAllSchools = ref(false)

const school = ref({
	title: '',
	school_code: '',
	published: true,
	description: '',
	school_members: [],
})

const schools = createListResource({
	doctype: 'LMS School',
	fields: ['name', 'title', 'school_code', 'published', 'member_count', 'description'],
	orderBy: 'creation desc',
	cache: ['schools'],
	auto: true,
})

const schoolMembers = createListResource({
	doctype: 'LMS School Member',
	fields: ['member', 'full_name', 'all_schools', 'name'],
	parent: 'LMS School',
	orderBy: 'idx',
	onSuccess(data) {
		school.value.school_members = data
	},
})

const openSchoolForm = (schoolName) => {
	currentSchool.value = schoolName
	if (schoolName === 'new') {
		school.value = {
			title: '',
			school_code: '',
			published: true,
			description: '',
			school_members: [],
		}
	} else {
		const existing = schools.data?.find((row) => row.name === schoolName)
		school.value = {
			...existing,
			school_members: [],
		}
		fetchMembers(schoolName)
	}
	showSchoolDialog.value = true
}

const fetchMembers = (schoolName) => {
	schoolMembers.update({
		filters: {
			parent: schoolName,
			parenttype: 'LMS School',
			parentfield: 'school_members',
		},
	})
	schoolMembers.reload()
}

const openMemberDialog = () => {
	member.value = ''
	memberAllSchools.value = false
	showMemberDialog.value = true
}

const addMember = (close) => {
	if (!member.value) {
		toast.warning(__('Please select a member'))
		return
	}

	const existingMember = school.value.school_members.find(
		(row) => row.member === member.value
	)
	if (existingMember) {
		toast.warning(__('Member already assigned to this school'))
		return
	}

	school.value.school_members.push({
		member: member.value,
		all_schools: memberAllSchools.value ? 1 : 0,
	})
	close()
	toast.success(__('Member added to school'))
}

const removeMembers = (selections, unselectAll) => {
	const selected = Array.from(selections)
	school.value.school_members = school.value.school_members.filter(
		(row) => !selected.includes(row.name || row.member)
	)
	unselectAll()
}

const getPayload = () => {
	return {
		title: escapeHTML((school.value.title || '').trim()),
		school_code: escapeHTML((school.value.school_code || '').trim()),
		published: school.value.published ? 1 : 0,
		description: school.value.description || '',
		school_members: school.value.school_members || [],
	}
}

const saveSchool = (close) => {
	const payload = getPayload()
	if (!payload.title) {
		toast.warning(__('Please enter a school name'))
		return
	}

	if (currentSchool.value === 'new') {
		schools.insert.submit(payload, {
			onSuccess() {
				close()
				schools.reload()
				toast.success(__('School created successfully'))
			},
			onError(err) {
				toast.warning(__(err.messages?.[0] || err))
			},
		})
	} else {
		schools.setValue.submit(
			{
				name: currentSchool.value,
				...payload,
			},
			{
				onSuccess() {
					close()
					schools.reload()
					toast.success(__('School updated successfully'))
				},
				onError(err) {
					toast.warning(__(err.messages?.[0] || err))
				},
			}
		)
	}
}

const deleteSchool = (close) => {
	schools.delete.submit(currentSchool.value, {
		onSuccess() {
			close()
			schools.reload()
			toast.success(__('School deleted successfully'))
		},
		onError(err) {
			toast.warning(__(err.messages?.[0] || err))
		},
	})
}

const memberColumns = computed(() => [
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
	{
		label: 'All Schools',
		key: 'all_schools',
		width: 1,
		align: 'left',
	},
])

const breadcrumbs = computed(() => [
	{
		label: __('Schools'),
	},
])

usePageMeta(() => {
	return {
		title: __('Schools'),
		icon: brand.favicon,
	}
})
</script>
