<template>
	<FrappeUIProvider>
		<Layout class="isolate text-base lms-app-root" :class="uiSkinClass">
			<router-view />
		</Layout>
		<InstallPrompt v-if="isMobile && !settings.data?.disable_pwa" />
		<Dialogs />
	</FrappeUIProvider>
</template>
<script setup>
import { FrappeUIProvider } from 'frappe-ui'
import { Dialogs } from '@/utils/dialogs'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useScreenSize } from './utils/composables'
import { usersStore } from '@/stores/user'
import { useSettings } from '@/stores/settings'
import { useRoute, useRouter } from 'vue-router'
import { posthogSettings } from '@/telemetry'
import DesktopLayout from './components/DesktopLayout.vue'
import MobileLayout from './components/MobileLayout.vue'
import NoSidebarLayout from './components/NoSidebarLayout.vue'
import InstallPrompt from './components/InstallPrompt.vue'
import { getUiSkin, isV2 } from '@/composables/useUiSkin'

const { isMobile } = useScreenSize()
const router = useRouter()
const route = useRoute()
const noSidebar = ref(false)
const { userResource } = usersStore()
const { settings } = useSettings()
const uiSkin = ref(
	typeof window !== 'undefined' ? getUiSkin(window.location.search) : 'v2'
)

const syncUiSkin = () => {
	uiSkin.value = getUiSkin(window.location.search)
}

onMounted(() => {
	syncUiSkin()
})

router.beforeEach((to, from, next) => {
	if (to.query.fromLesson || to.path === '/persona') {
		noSidebar.value = true
	} else {
		noSidebar.value = false
	}
	next()
})

const Layout = computed(() => {
	if (noSidebar.value) {
		return NoSidebarLayout
	}
	if (isMobile.value) {
		return MobileLayout
	}
	return DesktopLayout
})

const uiSkinClass = computed(() => {
	return {
		'ui-skin-v1': !isV2(uiSkin.value),
		'ui-skin-v2': isV2(uiSkin.value),
	}
})

onUnmounted(() => {
	noSidebar.value = false
})

watch(userResource, () => {
	if (userResource.data) {
		posthogSettings.reload()
	}
})

watch(
	() => route.fullPath,
	() => {
		syncUiSkin()
	}
)
</script>
