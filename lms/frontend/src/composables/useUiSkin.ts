export type UiSkin = 'v1' | 'v2'

const STORAGE_KEY = 'lms_ui_skin'
const UI_PARAM = 'ui'

const hasWindow = () => typeof window !== 'undefined'

const normalizeUiSkin = (value?: string | null): UiSkin | null => {
	if (!value) return null
	if (value === 'v1' || value === 'v2') return value
	return null
}

const readStoredSkin = (): UiSkin | null => {
	if (!hasWindow()) return null
	try {
		return normalizeUiSkin(window.localStorage.getItem(STORAGE_KEY))
	} catch (_error) {
		return null
	}
}

const readSkinFromSearch = (search?: string): UiSkin | null => {
	if (!hasWindow()) return null
	try {
		const params = new URLSearchParams(
			typeof search === 'string' ? search : window.location.search
		)
		return normalizeUiSkin(params.get(UI_PARAM))
	} catch (_error) {
		return null
	}
}

const applyUiSkinToDocument = (skin: UiSkin) => {
	if (!hasWindow()) return
	document.documentElement.setAttribute('data-ui-skin', skin)
}

export const setUiSkin = (skin: UiSkin): UiSkin => {
	if (!hasWindow()) return skin
	try {
		window.localStorage.setItem(STORAGE_KEY, skin)
	} catch (_error) {
		// Non-fatal: continue applying skin to the document.
	}
	applyUiSkinToDocument(skin)
	return skin
}

export const getUiSkin = (search?: string): UiSkin => {
	const urlSkin = readSkinFromSearch(search)
	if (urlSkin) return setUiSkin(urlSkin)

	const storedSkin = readStoredSkin()
	if (storedSkin) return setUiSkin(storedSkin)

	return setUiSkin('v2')
}

export const isV2 = (skin?: UiSkin): boolean => {
	if (skin) return skin === 'v2'
	return getUiSkin() === 'v2'
}
