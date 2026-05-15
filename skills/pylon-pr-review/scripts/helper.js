;(() => {
  function post(payload) {
    return fetch('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {})
  }

  document.addEventListener('change', (event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return
    if (target.type !== 'checkbox') return
    if (!target.dataset.findingId) return
    post({
      type: target.checked ? 'select' : 'deselect',
      findingId: target.dataset.findingId,
      timestamp: Date.now(),
    })
  })

  document.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (!target.matches('[data-action="submit"]')) return
    const checked = Array.from(document.querySelectorAll('input[type="checkbox"][data-finding-id]'))
      .filter((el) => el.checked)
      .map((el) => el.dataset.findingId)
    post({ type: 'submit', findingIds: checked, timestamp: Date.now() })
  })

  setInterval(() => {
    fetch('/heartbeat', { method: 'POST' }).catch(() => {})
  }, 30_000)
})()
