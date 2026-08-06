function createNoopSocket() {
	return {
		on() {
			return this
		},
		once() {
			return this
		},
		off() {
			return this
		},
		emit() {
			return false
		},
		disconnect() {
			return this
		},
	}
}

export function initSocket() {
	return createNoopSocket()
}
