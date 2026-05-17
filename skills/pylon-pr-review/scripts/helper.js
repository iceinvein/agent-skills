;(() => {
  let isLive = false
  let focusedIndex = -1

  const filters = { sev: new Set(), domain: new Set(), search: '' }

  function isLikelyArchived() {
    return location.protocol === 'file:' || location.protocol === 'about:'
  }

  function runId() {
    return document.body?.dataset?.runId || 'unknown'
  }

  function selectionKey() {
    return `pr-review:selection:${runId()}`
  }

  function readPersistedSelection() {
    try {
      const raw = localStorage.getItem(selectionKey())
      if (!raw) return new Set()
      return new Set(JSON.parse(raw))
    } catch {
      return new Set()
    }
  }

  function writePersistedSelection(ids) {
    try {
      localStorage.setItem(selectionKey(), JSON.stringify(Array.from(ids)))
    } catch {
      // Quota or denied; non-fatal.
    }
  }

  function allCheckboxes() {
    return Array.from(document.querySelectorAll('input[type="checkbox"][data-finding-id]'))
  }

  function allFindings() {
    return Array.from(document.querySelectorAll('.finding'))
  }

  function visibleFindings() {
    return allFindings().filter((el) => !el.classList.contains('is-hidden'))
  }

  function post(payload) {
    if (!isLive) return Promise.resolve()
    return fetch('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {})
  }

  let statusTimer = null

  function showStatus(message, tone) {
    const el = document.querySelector('[data-role="submit-status"]')
    if (!(el instanceof HTMLElement)) return
    el.textContent = message
    el.hidden = false
    el.dataset.tone = tone || 'info'
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = setTimeout(() => {
      el.hidden = true
    }, 7000)
  }

  function recountSelected() {
    const checked = allCheckboxes().filter((el) => el.checked)
    const n = checked.length
    const node = document.querySelector('[data-role="selected-count"] .num')
    if (node) node.textContent = String(n)
    const btn = document.querySelector('[data-action="submit"]')
    if (btn instanceof HTMLButtonElement) btn.disabled = n === 0
    writePersistedSelection(checked.map((el) => el.dataset.findingId))
  }

  function restoreSelection() {
    const persisted = readPersistedSelection()
    if (persisted.size === 0) return
    for (const cb of allCheckboxes()) {
      if (cb.disabled) continue
      if (persisted.has(cb.dataset.findingId)) cb.checked = true
    }
  }

  function applyFilters() {
    const search = filters.search.trim().toLowerCase()
    const sevSet = filters.sev
    const domainSet = filters.domain
    let visible = 0
    for (const card of allFindings()) {
      const sev = card.dataset.severity
      const dom = card.dataset.domain
      const text = card.dataset.searchText || ''
      const sevOk = sevSet.size === 0 || sevSet.has(sev)
      const domOk = domainSet.size === 0 || domainSet.has(dom)
      const searchOk = !search || text.includes(search)
      const ok = sevOk && domOk && searchOk
      card.classList.toggle('is-hidden', !ok)
      if (ok) visible++
    }
    const total = allFindings().length
    const visibleNode = document.querySelector('[data-role="visible-count"]')
    if (visibleNode) visibleNode.textContent = String(visible)
    const statusNode = document.querySelector('[data-role="filter-status"]')
    if (statusNode?.firstChild) {
      const filtersActive = sevSet.size > 0 || domainSet.size > 0 || !!search
      statusNode.childNodes[0].textContent = filtersActive ? 'showing ' : 'showing all '
    }
    const clearBtn = document.querySelector('[data-action="clear-filters"]')
    if (clearBtn instanceof HTMLButtonElement) {
      const hasFilter = sevSet.size > 0 || domainSet.size > 0 || !!search
      clearBtn.hidden = !hasFilter
    }
    const noMatches = document.querySelector('[data-role="no-matches"]')
    if (noMatches instanceof HTMLElement) noMatches.hidden = visible !== 0 || total === 0
    // Reset focus when filters shift the visible set.
    if (focusedIndex !== -1 && visibleFindings()[focusedIndex] == null) {
      setFocused(-1)
    }
  }

  function toggleFilterChip(button) {
    const group = button.dataset.filterGroup
    const value = button.dataset.filterValue
    if (!group || !value) return
    const bucket = group === 'sev' ? filters.sev : filters.domain
    if (bucket.has(value)) {
      bucket.delete(value)
      button.setAttribute('aria-pressed', 'false')
    } else {
      bucket.add(value)
      button.setAttribute('aria-pressed', 'true')
    }
    applyFilters()
  }

  function clearAllFilters() {
    filters.sev.clear()
    filters.domain.clear()
    filters.search = ''
    for (const btn of document.querySelectorAll('.filter-chip')) {
      btn.setAttribute('aria-pressed', 'false')
    }
    const search = document.querySelector('[data-role="search"]')
    if (search instanceof HTMLInputElement) search.value = ''
    applyFilters()
  }

  function selectMany(predicate) {
    let toggled = false
    for (const cb of allCheckboxes()) {
      if (cb.disabled) continue
      const card = cb.closest('.finding')
      if (!card) continue
      if (predicate(card) && !cb.checked) {
        cb.checked = true
        toggled = true
        post({
          type: 'select',
          findingId: cb.dataset.findingId,
          timestamp: Date.now(),
        })
      }
    }
    if (toggled) recountSelected()
  }

  function selectNone() {
    let toggled = false
    for (const cb of allCheckboxes()) {
      if (cb.disabled) continue
      if (cb.checked) {
        cb.checked = false
        toggled = true
        post({
          type: 'deselect',
          findingId: cb.dataset.findingId,
          timestamp: Date.now(),
        })
      }
    }
    if (toggled) recountSelected()
  }

  function setFocused(index) {
    const all = visibleFindings()
    for (const card of allFindings()) card.classList.remove('is-focused')
    if (index < 0 || index >= all.length) {
      focusedIndex = -1
      return
    }
    focusedIndex = index
    const target = all[index]
    target.classList.add('is-focused')
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function moveFocus(delta) {
    const all = visibleFindings()
    if (all.length === 0) return
    if (focusedIndex === -1) {
      setFocused(delta > 0 ? 0 : all.length - 1)
      return
    }
    const next = Math.min(all.length - 1, Math.max(0, focusedIndex + delta))
    setFocused(next)
  }

  function toggleFocusedSelection() {
    if (focusedIndex === -1) return
    const card = visibleFindings()[focusedIndex]
    if (!card) return
    const cb = card.querySelector('input[type="checkbox"][data-finding-id]')
    if (!(cb instanceof HTMLInputElement) || cb.disabled) return
    cb.checked = !cb.checked
    post({
      type: cb.checked ? 'select' : 'deselect',
      findingId: cb.dataset.findingId,
      timestamp: Date.now(),
    })
    recountSelected()
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

      const chip = target.closest('.filter-chip')
      if (chip instanceof HTMLElement) {
        toggleFilterChip(chip)
        return
      }

      const action = target.closest('[data-action]')
      if (!(action instanceof HTMLElement)) return
      switch (action.dataset.action) {
        case 'submit': {
          const checked = allCheckboxes()
            .filter((el) => el.checked)
            .map((el) => el.dataset.findingId)
          if (checked.length === 0) {
            showStatus('Nothing selected yet. Tick a finding or use `all visible`.', 'info')
            break
          }
          if (!isLive) {
            showStatus(
              `Cannot queue from an archived view. Run \`pr-review serve ${runId()}\` to make this live.`,
              'warn',
            )
            break
          }
          post({ type: 'submit', findingIds: checked, timestamp: Date.now() })
          const noun = checked.length === 1 ? 'finding' : 'findings'
          showStatus(
            `Queued ${checked.length} ${noun}. Reply \`post\` in your terminal to post to the PR.`,
            'ok',
          )
          break
        }
        case 'select-visible':
          selectMany((card) => !card.classList.contains('is-hidden'))
          break
        case 'select-priority':
          selectMany(
            (card) =>
              !card.classList.contains('is-hidden') &&
              (card.dataset.severity === 'blocker' || card.dataset.severity === 'high'),
          )
          break
        case 'select-none':
          selectNone()
          break
        case 'clear-filters':
          clearAllFilters()
          break
      }
    })

    const search = document.querySelector('[data-role="search"]')
    if (search instanceof HTMLInputElement) {
      search.addEventListener('input', () => {
        filters.search = search.value
        applyFilters()
      })
    }

    document.addEventListener('keydown', (event) => {
      const t = event.target
      const isTyping = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
      if (isTyping) {
        if (event.key === 'Escape') t.blur()
        return
      }
      switch (event.key) {
        case 'j':
          event.preventDefault()
          moveFocus(1)
          break
        case 'k':
          event.preventDefault()
          moveFocus(-1)
          break
        case 'x':
        case ' ':
          event.preventDefault()
          toggleFocusedSelection()
          break
        case 'a':
          event.preventDefault()
          selectMany((card) => !card.classList.contains('is-hidden'))
          break
        case 'n':
          event.preventDefault()
          selectNone()
          break
        case '/': {
          event.preventDefault()
          const s = document.querySelector('[data-role="search"]')
          if (s instanceof HTMLInputElement) s.focus()
          break
        }
        case 'Escape':
          event.preventDefault()
          clearAllFilters()
          setFocused(-1)
          break
      }
    })

    restoreSelection()
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
