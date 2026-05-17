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
    return `magpie:selection:${runId()}`
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
  let pendingPostIds = []

  function showStatus(message, tone, sticky) {
    const el = document.querySelector('[data-role="submit-status"]')
    if (!(el instanceof HTMLElement)) return
    el.textContent = message
    el.hidden = false
    el.dataset.tone = tone || 'info'
    if (statusTimer) {
      clearTimeout(statusTimer)
      statusTimer = null
    }
    if (!sticky) {
      statusTimer = setTimeout(() => {
        el.hidden = true
      }, 7000)
    }
  }

  function targetLabel() {
    // Best-effort: derive from runId or fall back to "the PR".
    const id = runId()
    const m = id.match(/^pr-(\d+)-/)
    return m ? `PR #${m[1]}` : 'the PR'
  }

  function openConfirm(ids) {
    pendingPostIds = ids
    const bar = document.querySelector('[data-role="confirm-bar"]')
    const text = document.querySelector('[data-role="confirm-text"]')
    const submit = document.querySelector('[data-action="post"]')
    if (!(bar instanceof HTMLElement) || !(text instanceof HTMLElement)) return
    const noun = ids.length === 1 ? 'comment' : 'comments'
    text.textContent = `Post ${ids.length} ${noun} to ${targetLabel()}? Visible to the author.`
    bar.hidden = false
    if (submit instanceof HTMLButtonElement) submit.disabled = true
  }

  function closeConfirm() {
    const bar = document.querySelector('[data-role="confirm-bar"]')
    if (bar instanceof HTMLElement) bar.hidden = true
    pendingPostIds = []
    recountSelected() // re-enables the submit button if any selections remain
  }

  function isConfirmOpen() {
    const bar = document.querySelector('[data-role="confirm-bar"]')
    return bar instanceof HTMLElement && !bar.hidden
  }

  function badgeHtml(result) {
    if (result.status === 'posted') return '<span class="badge posted">posted</span>'
    if (result.status === 'already-posted')
      return '<span class="badge posted">already posted</span>'
    if (result.status === 'unknown-id')
      return '<span class="badge failed">failed: unknown id</span>'
    const msg = result.message || 'gh failed'
    const span = document.createElement('span')
    span.className = 'badge failed'
    span.textContent = `failed: ${msg}`
    return span.outerHTML
  }

  function applyResult(result) {
    const card = document.getElementById(`finding-${result.id}`)
    if (!(card instanceof HTMLElement)) return
    const head = card.querySelector('.finding-head')
    if (!head) return
    // Remove any pre-existing badge in this head.
    const existing = head.querySelector('.badge')
    if (existing) existing.remove()
    head.insertAdjacentHTML('beforeend', badgeHtml(result))
    if (result.status === 'posted' || result.status === 'already-posted') {
      const cb = card.querySelector('input[type="checkbox"][data-finding-id]')
      if (cb instanceof HTMLInputElement) {
        cb.checked = true
        cb.disabled = true
      }
    }
  }

  async function performPost(idsArg) {
    // Accept ids explicitly (preferred) but fall back to the global queue
    // for any legacy caller.
    const ids = Array.isArray(idsArg) && idsArg.length > 0 ? idsArg.slice() : pendingPostIds.slice()
    pendingPostIds = []
    if (ids.length === 0) return
    showStatus(`Posting ${ids.length}...`, 'info', /*sticky*/ true)
    let response
    try {
      const r = await fetch('/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingIds: ids }),
      })
      response = await r.json()
      if (!r.ok && !response.results) {
        showStatus(`Post failed: ${response.error || `HTTP ${r.status}`}`, 'warn', /*sticky*/ true)
        return
      }
    } catch (err) {
      showStatus(`Post failed: ${err?.message || err}`, 'warn', true)
      return
    }
    let ok = 0
    let failed = 0
    let summaryStatus = null
    for (const result of response.results || []) {
      if (result.id === '__summary__') {
        summaryStatus = result.status
        continue
      }
      applyResult(result)
      if (result.status === 'posted' || result.status === 'already-posted') ok++
      else failed++
    }
    const summaryNote =
      summaryStatus === 'posted'
        ? ' + summary'
        : summaryStatus === 'already-posted'
          ? ' (summary already posted)'
          : summaryStatus === 'failed'
            ? ' (summary failed)'
            : ''
    if (failed === 0) {
      showStatus(`Posted ${ok}${summaryNote}. Done.`, 'ok')
    } else {
      showStatus(
        `Posted ${ok}${summaryNote}, failed ${failed}. See per-finding badges.`,
        'warn',
        true,
      )
    }
    recountSelected()
  }

  function recountSelected() {
    // Posted findings are checked+disabled; they're permanent state, not an
    // active selection. Exclude them so "clear" actually clears, the counter
    // reflects only what's actionable, and localStorage doesn't pin them.
    const activelyChecked = allCheckboxes().filter((el) => el.checked && !el.disabled)
    const n = activelyChecked.length
    const node = document.querySelector('[data-role="selected-count"] .num')
    if (node) node.textContent = String(n)
    const btn = document.querySelector('[data-action="post"]')
    if (btn instanceof HTMLButtonElement) btn.disabled = n === 0
    writePersistedSelection(activelyChecked.map((el) => el.dataset.findingId))
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

      // Click outside the confirm popup (and not on the Post to PR trigger)
      // dismisses the popup, matching GitHub's small-popup behavior.
      if (isConfirmOpen()) {
        const insidePopup = target.closest('[data-role="confirm-bar"]')
        const onTrigger = target.closest('[data-action="post"]')
        if (!insidePopup && !onTrigger) {
          closeConfirm()
        }
      }

      const chip = target.closest('.filter-chip')
      if (chip instanceof HTMLElement) {
        toggleFilterChip(chip)
        return
      }

      const action = target.closest('[data-action]')
      if (!(action instanceof HTMLElement)) return
      switch (action.dataset.action) {
        case 'post': {
          const checked = allCheckboxes()
            .filter((el) => el.checked)
            .map((el) => el.dataset.findingId)
          if (checked.length === 0) {
            showStatus('Nothing selected yet. Tick a finding or use `all visible`.', 'info')
            break
          }
          if (!isLive) {
            showStatus(
              `Cannot post from an archived view. Run \`magpie serve ${runId()}\` to make this live.`,
              'warn',
            )
            break
          }
          openConfirm(checked)
          break
        }
        case 'cancel-post':
          closeConfirm()
          break
        case 'confirm-post': {
          // Capture ids BEFORE closeConfirm wipes the queue, then post.
          const ids = pendingPostIds.slice()
          closeConfirm()
          performPost(ids)
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
          if (isConfirmOpen()) {
            closeConfirm()
          } else {
            clearAllFilters()
            setFocused(-1)
          }
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
