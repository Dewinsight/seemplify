(() => {
  const byId = (id) => document.getElementById(id)
  const fileInput = byId('avatarFile')
  const overlay = byId('cropOverlay')
  const viewport = byId('cropViewport')
  const image = byId('cropImage')
  const zoomInput = byId('cropZoom')
  const errorNode = byId('cropError')
  const applyButton = byId('applyCrop')
  let objectUrl = ''
  let sourceName = 'profile-picture'
  let zoom = 1
  let baseWidth = 0
  let baseHeight = 0
  let offsetX = 0
  let offsetY = 0
  let drag = null
  let previousBodyOverflow = ''

  const showMessage = (kind, message) => {
    const target = byId(kind === 'success' ? 'avatarSuccess' : 'avatarError')
    const other = byId(kind === 'success' ? 'avatarError' : 'avatarSuccess')
    other.classList.remove('show')
    target.textContent = message
    target.classList.add('show')
  }

  const setCropError = (message = '') => {
    errorNode.textContent = message
    errorNode.hidden = !message
    applyButton.disabled = Boolean(message)
  }

  const clampPosition = () => {
    const size = viewport.clientWidth
    const width = baseWidth * zoom
    const height = baseHeight * zoom
    offsetX = Math.max((size - width) / 2, Math.min((width - size) / 2, offsetX))
    offsetY = Math.max((size - height) / 2, Math.min((height - size) / 2, offsetY))
    image.style.width = `${width}px`
    image.style.height = `${height}px`
    image.style.transform = `translate(-50%, -50%) translate(${offsetX}px, ${offsetY}px)`
  }

  const resetCrop = () => {
    zoom = 1
    zoomInput.value = '1'
    offsetX = 0
    offsetY = 0
    clampPosition()
  }

  const closeCrop = () => {
    overlay.hidden = true
    document.body.style.overflow = previousBodyOverflow
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = ''
    image.removeAttribute('src')
    drag = null
    byId('chooseAvatar').focus()
  }

  const openFile = (file) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      showMessage('error', 'Choose a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      showMessage('error', 'Choose an image smaller than 5 MB.')
      return
    }
    objectUrl = URL.createObjectURL(file)
    sourceName = file.name.replace(/\.[^.]+$/u, '') || 'profile-picture'
    setCropError('')
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    overlay.hidden = false
    image.src = objectUrl
    byId('closeCrop').focus()
  }

  image.addEventListener('load', () => {
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 60_000_000) {
      setCropError('This picture is too large to crop safely. Choose a smaller image.')
      return
    }
    const size = viewport.clientWidth
    const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight)
    baseWidth = image.naturalWidth * scale
    baseHeight = image.naturalHeight * scale
    resetCrop()
  })
  image.addEventListener('error', () => setCropError('This picture could not be opened. Try another JPEG, PNG, or WebP image.'))
  byId('chooseAvatar').addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; fileInput.value = ''; if (file) openFile(file) })
  ;['closeCrop', 'cancelCrop', 'cropBackdrop'].forEach((id) => byId(id).addEventListener('click', closeCrop))
  byId('resetCrop').addEventListener('click', resetCrop)
  zoomInput.addEventListener('input', () => { zoom = Number(zoomInput.value) || 1; clampPosition() })
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !baseWidth) return
    viewport.setPointerCapture(event.pointerId)
    drag = { x: event.clientX, y: event.clientY, offsetX, offsetY }
  })
  viewport.addEventListener('pointermove', (event) => {
    if (!drag) return
    offsetX = drag.offsetX + event.clientX - drag.x
    offsetY = drag.offsetY + event.clientY - drag.y
    clampPosition()
  })
  ;['pointerup', 'pointercancel'].forEach((name) => viewport.addEventListener(name, (event) => {
    drag = null
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
  }))
  viewport.addEventListener('keydown', (event) => {
    const movement = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[event.key]
    if (!movement) return
    event.preventDefault()
    offsetX += movement[0]
    offsetY += movement[1]
    clampPosition()
  })

  applyButton.addEventListener('click', async () => {
    if (!baseWidth || applyButton.disabled) return
    applyButton.disabled = true
    applyButton.textContent = 'Uploading…'
    setCropError('')
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 512
      const context = canvas.getContext('2d')
      const factor = 512 / viewport.clientWidth
      context.drawImage(image, 256 - (baseWidth * zoom * factor) / 2 + offsetX * factor, 256 - (baseHeight * zoom * factor) / 2 + offsetY * factor, baseWidth * zoom * factor, baseHeight * zoom * factor)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .9))
      if (!blob) throw new Error('The cropped picture could not be created.')
      const body = new FormData()
      body.append('picture', new File([blob], `${sourceName}.jpg`, { type: 'image/jpeg' }))
      const response = await fetch('/api/profile/picture', { method: 'POST', body })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'The profile picture could not be uploaded.')
      closeCrop()
      showMessage('success', 'Profile picture updated. Seemplify apps will receive it through your Identity profile.')
      window.setTimeout(() => window.location.reload(), 700)
    } catch (error) {
      setCropError(error.message || 'The profile picture could not be uploaded.')
    } finally {
      applyButton.disabled = Boolean(errorNode.textContent)
      applyButton.textContent = 'Apply and upload'
    }
  })

  byId('removeAvatar')?.addEventListener('click', async () => {
    if (!window.confirm('Remove your profile picture from your Seemplify identity?')) return
    const button = byId('removeAvatar')
    button.disabled = true
    try {
      const response = await fetch('/api/profile/picture', { method: 'DELETE' })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'The profile picture could not be removed.')
      showMessage('success', 'Profile picture removed.')
      window.setTimeout(() => window.location.reload(), 500)
    } catch (error) {
      showMessage('error', error.message || 'The profile picture could not be removed.')
      button.disabled = false
    }
  })
})()
