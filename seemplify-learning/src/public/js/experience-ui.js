/* Shared shell behavior. Authentication and course actions remain server owned. */
(() => {
  const account = document.querySelector('.ui-account')
  if (account) {
    document.addEventListener('click', (event) => {
      if (!account.contains(event.target)) account.open = false
    })
    account.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { account.open = false; account.querySelector('summary')?.focus() }
    })
  }
  let previousFocus = null
  const drawer = document.querySelector('[data-ui-drawer]')
  const trigger = document.querySelector('[data-ui-menu]')
  const backdrop = document.querySelector('[data-ui-backdrop]')
  if (!drawer || !trigger || !backdrop) return
  const media = window.matchMedia('(min-width: 768px)')
  const setOpen = (open) => {
    if (open) previousFocus = document.activeElement
    document.body.classList.toggle('ui-drawer-open', open)
    trigger.setAttribute('aria-expanded', String(open))
    backdrop.hidden = !open
    if (!media.matches) drawer.inert = !open
    if (open) drawer.setAttribute('aria-modal', 'true')
    else drawer.removeAttribute('aria-modal')
    if (open) {
      drawer.setAttribute('role', 'dialog')
      drawer.querySelector('button, a')?.focus()
    } else {
      drawer.removeAttribute('role')
      if (previousFocus) previousFocus.focus()
    }
  }
  if (!media.matches) drawer.inert = true
  trigger.addEventListener('click', () => setOpen(!document.body.classList.contains('ui-drawer-open')))
  backdrop.addEventListener('click', () => setOpen(false))
  drawer.querySelector('[data-ui-close]')?.addEventListener('click', () => setOpen(false))
  document.addEventListener('keydown', (event) => {
    if (!document.body.classList.contains('ui-drawer-open')) return
    if (event.key === 'Escape') setOpen(false)
    if (event.key !== 'Tab') return
    const focusable = [...drawer.querySelectorAll('a[href], button:not([disabled]), summary')].filter((element) => element.getClientRects().length)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  })
  media.addEventListener('change', () => {
    setOpen(false)
    drawer.inert = !media.matches
  })
})()

// The lesson curriculum uses its existing checkbox-driven layout, with keyboard
// accessible controls and focus management matching the application drawer.
;(() => {
  const checkbox = document.querySelector('#player-curriculum-toggle')
  const panel = document.querySelector('#course-curriculum')
  const trigger = document.querySelector('[data-curriculum-open]')
  const backdrop = document.querySelector('.player-curriculum-overlay')
  if (!checkbox || !panel || !trigger) return
  const media = window.matchMedia('(min-width: 1081px)')
  const setOpen = (open) => {
    checkbox.checked = open
    if (backdrop) backdrop.hidden = !open
    trigger.setAttribute('aria-expanded', String(open))
    panel.inert = !open && !media.matches
    if (open) panel.setAttribute('aria-modal', 'true')
    else panel.removeAttribute('aria-modal')
    document.body.classList.toggle('ui-curriculum-open', open)
    if (open) { panel.setAttribute('role', 'dialog'); panel.querySelector('button, a')?.focus() }
    else { panel.removeAttribute('role'); trigger.focus() }
  }
  panel.inert = !media.matches
  trigger.addEventListener('click', () => setOpen(!checkbox.checked))
  document.querySelectorAll('[data-curriculum-close]').forEach((button) => button.addEventListener('click', () => setOpen(false)))
  document.addEventListener('keydown', (event) => {
    if (!checkbox.checked) return
    if (event.key === 'Escape') setOpen(false)
    if (event.key !== 'Tab') return
    const controls = [...panel.querySelectorAll('button, a[href]')].filter((element) => element.getClientRects().length)
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  })
  media.addEventListener('change', () => { setOpen(false); panel.inert = !media.matches })
})()
