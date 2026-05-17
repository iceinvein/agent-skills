;(() => {
  let isLive = false

  function isLikelyArchived() {
    return location.protocol === 'file:' || location.protocol === 'about:'
  }

  function post(payload) {
    if (!isLive) return Promise.resolve()
    return fetch('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {})
  }

  function recountSelected() {
    const n = document.querySelectorAll('input[type="checkbox"][data-finding-id]:checked').length
    const node = document.querySelector('[data-role="selected-count"] .num')
    if (node) node.textContent = String(n)
    const btn = document.querySelector('[data-action="submit"]')
    if (btn instanceof HTMLButtonElement) btn.disabled = n === 0
  }

  function bind() {
    document.addEventListener('change', (event) => {
      const target = event.target
      if (!(target instanceof HTMLInputElement)) return
      if (target.type !== 'checkbox') return
      if (!target.dataset.findingId) return
      recountSelected()
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
      const checked = Array.from(
        document.querySelectorAll('input[type="checkbox"][data-finding-id]'),
      )
        .filter((el) => el.checked)
        .map((el) => el.dataset.findingId)
      post({ type: 'submit', findingIds: checked, timestamp: Date.now() })
    })

    recountSelected()
  }

  function probeAndStart() {
    if (isLikelyArchived()) {
      document.documentElement.dataset.mode = 'archived'
      bind()
      return
    }
    fetch('/heartbeat', { method: 'POST' })
      .then((r) => {
        isLive = r.ok
        if (!isLive) document.documentElement.dataset.mode = 'archived'
        bind()
        if (isLive) {
          setInterval(() => {
            fetch('/heartbeat', { method: 'POST' }).catch(() => {})
          }, 30_000)
        }
      })
      .catch(() => {
        document.documentElement.dataset.mode = 'archived'
        bind()
      })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', probeAndStart)
  } else {
    probeAndStart()
  }
})()
