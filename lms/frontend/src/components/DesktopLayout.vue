<template>
	<div class="lms-desktop-shell flex h-screen w-screen">
		<div class="lms-desktop-sidebar-wrap h-full border-r bg-surface-menu-bar">
			<AppSidebar />
		</div>
		<div class="lms-desktop-content flex-1 flex flex-col h-full overflow-auto bg-surface-white">
			<slot />
		</div>
	</div>
</template>
<script setup>
import AppSidebar from '@/components/Sidebar/AppSidebar.vue'
</script>
