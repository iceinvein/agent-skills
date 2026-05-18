;(() => {
  let isLive = false

  const fileFindingIdx = new Map()

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

  function cssEscape(s) {
    // Minimal CSS attr-selector escape: backslash-escape backslashes and quotes.
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
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
    writePersistedSelection(activelyChecked.map((el) => el.dataset.findingId))
    updateSelectedCount()
  }

  // ---------------------------------------------------------------------------
  // New Pylon-style selection count
  // ---------------------------------------------------------------------------

  function updateSelectedCount() {
    // Count unique finding ids that have any checked checkbox.
    const ids = new Set()
    for (const cb of document.querySelectorAll('input[type="checkbox"][data-finding-id]')) {
      if (cb.checked && !cb.disabled) ids.add(cb.getAttribute('data-finding-id'))
    }
    const node = document.querySelector('[data-role="selected-count"]')
    if (node) node.textContent = String(ids.size)
    const postSel = document.querySelector('[data-action="post-selected"]')
    if (postSel) postSel.disabled = ids.size === 0
  }

  function restoreSelection() {
    const persisted = readPersistedSelection()
    if (persisted.size === 0) return
    for (const cb of allCheckboxes()) {
      if (cb.disabled) continue
      if (persisted.has(cb.dataset.findingId)) cb.checked = true
    }
  }

  // ---------------------------------------------------------------------------
  // Tab switching
  // ---------------------------------------------------------------------------

  function handleSetView(btn) {
    const view = btn.getAttribute('data-view')
    if (!view) return
    document.body.dataset.view = view
    for (const s of document.querySelectorAll('[data-action="set-view"]')) {
      s.setAttribute('aria-pressed', s.getAttribute('data-view') === view ? 'true' : 'false')
    }
  }

  // ---------------------------------------------------------------------------
  // File selection
  // ---------------------------------------------------------------------------

  function handleSelectFile(btn) {
    const path = btn.getAttribute('data-file') ?? ''
    document.body.dataset.selectedFile = path
    for (const p of document.querySelectorAll('[data-file-pane]')) {
      p.hidden = p.getAttribute('data-file-pane') !== path
    }
    for (const b of document.querySelectorAll('[data-action="select-file"]')) {
      b.classList.toggle('active', b.getAttribute('data-file') === path)
    }
    // Reset finding nav for new file.
    fileFindingIdx.set(path, -1)
  }

  // ---------------------------------------------------------------------------
  // Diff-mode toggle
  // ---------------------------------------------------------------------------

  function handleSetDiffMode(btn) {
    const mode = btn.getAttribute('data-mode')
    if (!mode) return
    document.body.dataset.diffMode = mode
    for (const b of document.querySelectorAll('[data-action="set-diff-mode"]')) {
      b.setAttribute('aria-pressed', b.getAttribute('data-mode') === mode ? 'true' : 'false')
    }
    // Toggle visibility of .diff-unified and .diff-split inside each file pane.
    for (const el of document.querySelectorAll('.diff-unified')) {
      el.hidden = mode !== 'unified'
    }
    for (const el of document.querySelectorAll('.diff-split')) {
      el.hidden = mode !== 'split'
    }
  }

  // ---------------------------------------------------------------------------
  // Finding navigation (per file)
  // ---------------------------------------------------------------------------

  function annotsInActiveFile() {
    const path = document.body.dataset.selectedFile ?? ''
    const pane = document.querySelector(`[data-file-pane="${cssEscape(path)}"]`)
    if (!pane) return []
    // Use the visible diff-mode container so split mode finds its own annotations.
    const mode = document.body.dataset.diffMode ?? 'unified'
    const container = pane.querySelector(`[data-diff-mode="${mode}"]`) || pane
    return Array.from(container.querySelectorAll('.annot'))
  }

  function navigateFinding(direction) {
    const annots = annotsInActiveFile()
    if (annots.length === 0) return
    const path = document.body.dataset.selectedFile ?? ''
    const cur = fileFindingIdx.get(path) ?? -1
    let next
    if (cur === -1) {
      next = direction > 0 ? 0 : annots.length - 1
    } else {
      next = cur + direction
      if (next < 0) next = annots.length - 1
      if (next >= annots.length) next = 0
    }
    fileFindingIdx.set(path, next)
    for (const a of annots) a.classList.remove('is-focused')
    const target = annots[next]
    if (target) {
      target.classList.add('is-focused')
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }

  // ---------------------------------------------------------------------------
  // Suggestions toggle
  // ---------------------------------------------------------------------------

  function handleToggleSuggestions(btn) {
    const cur = document.body.dataset.showSuggestions === 'true'
    document.body.dataset.showSuggestions = cur ? 'false' : 'true'
    btn.setAttribute('aria-pressed', cur ? 'false' : 'true')
  }

  // ---------------------------------------------------------------------------
  // Severity filter (hide-sev-*)
  // ---------------------------------------------------------------------------

  function handleFilterSev(btn) {
    const sev = btn.getAttribute('data-sev')
    if (!sev) return
    const cls = `hide-sev-${sev}`
    const wasHidden = document.body.classList.contains(cls)
    document.body.classList.toggle(cls, !wasHidden)
    btn.setAttribute('aria-pressed', wasHidden ? 'true' : 'false')
  }

  // ---------------------------------------------------------------------------
  // Checkbox helpers
  // ---------------------------------------------------------------------------

  // findAnnotation returns all non-input elements for a given finding id.
  function findAnnotation(id) {
    return Array.from(document.querySelectorAll(`[data-finding-id="${cssEscape(id)}"]:not(input)`))
  }

  function findCheckboxes(id) {
    return Array.from(
      document.querySelectorAll(`input[type="checkbox"][data-finding-id="${cssEscape(id)}"]`),
    )
  }

  function setChecked(id, checked) {
    for (const cb of findCheckboxes(id)) {
      if (cb.disabled) continue
      cb.checked = checked
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk selection
  // ---------------------------------------------------------------------------

  function handleSelectSev(btn) {
    const sev = btn.getAttribute('data-sev')
    if (!sev) return
    const ids = new Set()
    for (const el of document.querySelectorAll(
      `[data-finding-id][data-severity="${sev}"][data-suggestion="false"]`,
    )) {
      if (el.tagName.toLowerCase() === 'input') continue
      if (el.getAttribute('data-posted') === 'true') continue
      ids.add(el.getAttribute('data-finding-id'))
    }
    for (const id of ids) setChecked(id, true)
    updateSelectedCount()
  }

  function handleSelectRecommended() {
    const ids = new Set()
    for (const el of document.querySelectorAll('[data-finding-id][data-suggestion="false"]')) {
      if (el.tagName.toLowerCase() === 'input') continue
      if (el.getAttribute('data-posted') === 'true') continue
      ids.add(el.getAttribute('data-finding-id'))
    }
    for (const id of ids) setChecked(id, true)
    updateSelectedCount()
  }

  // ---------------------------------------------------------------------------
  // Toggle focused finding's checkbox
  // ---------------------------------------------------------------------------

  function toggleFocusedFinding() {
    const path = document.body.dataset.selectedFile ?? ''
    const idx = fileFindingIdx.get(path) ?? -1
    if (idx === -1) return
    const annots = annotsInActiveFile()
    const annot = annots[idx]
    if (!annot) return
    const id = annot.getAttribute('data-finding-id')
    if (!id) return
    const cbs = findCheckboxes(id)
    if (cbs.length === 0) return
    const cb = cbs[0]
    if (cb.disabled) return
    const next = !cb.checked
    setChecked(id, next)
    post({
      type: next ? 'select' : 'deselect',
      findingId: id,
      timestamp: Date.now(),
    })
    updateSelectedCount()
  }

  // ---------------------------------------------------------------------------
  // Pylon-style bulk post via /api/post-review
  // ---------------------------------------------------------------------------

  async function postToReview(findingIds) {
    if (!isLive) {
      showStatus(
        'Cannot post from an archived view. Run `magpie serve <run-dir>` first.',
        'warn',
        true,
      )
      return null
    }
    showStatus(`Posting ${findingIds.length} as a single review...`, 'info', true)
    try {
      const r = await fetch('/api/post-review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ findingIds }),
      })
      const data = await r.json()
      if (!r.ok) {
        showStatus(`Post failed: ${data?.error || `HTTP ${r.status}`}`, 'warn', true)
        return null
      }
      return data
    } catch (err) {
      showStatus(`Post failed: ${err?.message || err}`, 'warn', true)
      return null
    }
  }

  function applyReviewResult(result) {
    if (!result) return
    for (const c of result.comments || []) {
      if (c.status === 'posted') {
        for (const el of findAnnotation(c.id)) {
          el.setAttribute('data-posted', 'true')
        }
        for (const cb of findCheckboxes(c.id)) {
          cb.checked = false
          cb.disabled = true
        }
      } else if (c.status === 'failed') {
        for (const el of findAnnotation(c.id)) {
          el.setAttribute('data-failed', 'true')
        }
      }
    }
    updateSelectedCount()
    const okCount = (result.comments || []).filter((c) => c.status === 'posted').length
    const failCount = (result.comments || []).filter((c) => c.status === 'failed').length
    const reviewBit = result.reviewId ? ` (review ${result.reviewId})` : ''
    if (failCount === 0) {
      showStatus(`Posted ${okCount}${reviewBit}.`, 'ok')
    } else {
      showStatus(`Posted ${okCount}, ${failCount} failed${reviewBit}.`, 'warn', true)
    }
  }

  async function handlePostSelected() {
    const ids = []
    const seen = new Set()
    for (const cb of document.querySelectorAll('input[type="checkbox"][data-finding-id]')) {
      if (!cb.checked || cb.disabled) continue
      const id = cb.getAttribute('data-finding-id')
      if (id && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
    }
    if (ids.length === 0) {
      showStatus('Nothing selected yet.', 'info')
      return
    }
    const result = await postToReview(ids)
    applyReviewResult(result)
  }

  async function handlePostRecommended() {
    const ids = []
    const seen = new Set()
    for (const el of document.querySelectorAll('[data-finding-id][data-suggestion="false"]')) {
      if (el.tagName.toLowerCase() === 'input') continue
      if (el.getAttribute('data-posted') === 'true') continue
      const id = el.getAttribute('data-finding-id')
      if (id && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
    }
    if (ids.length === 0) {
      showStatus('Nothing to post.', 'info')
      return
    }
    const result = await postToReview(ids)
    applyReviewResult(result)
  }

  // ---------------------------------------------------------------------------
  // Event binding
  // ---------------------------------------------------------------------------

  function bind() {
    document.addEventListener('change', (event) => {
      const target = event.target
      if (!(target instanceof HTMLInputElement)) return
      if (target.type !== 'checkbox') return
      if (!target.dataset.findingId) return
      const id = target.dataset.findingId
      // Sync the paired copy (inline .annot and .issue-card share the same id).
      for (const cb of findCheckboxes(id)) {
        if (cb === target) continue
        if (cb.disabled) continue
        cb.checked = target.checked
      }
      updateSelectedCount()
      post({
        type: target.checked ? 'select' : 'deselect',
        findingId: id,
        timestamp: Date.now(),
      })
    })

    document.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return

      // Click outside the confirm popup dismisses it.
      if (isConfirmOpen()) {
        const insidePopup = target.closest('[data-role="confirm-bar"]')
        const onTrigger = target.closest('[data-action="post"]')
        if (!insidePopup && !onTrigger) {
          closeConfirm()
        }
      }

      const action = target.closest('[data-action]')
      if (!(action instanceof HTMLElement)) return
      switch (action.dataset.action) {
        // -----------------------------------------------------------------------
        // New Pylon-style actions
        // -----------------------------------------------------------------------
        case 'set-view':
          handleSetView(action)
          break
        case 'select-file':
          handleSelectFile(action)
          break
        case 'set-diff-mode':
          handleSetDiffMode(action)
          break
        case 'prev-finding':
          navigateFinding(-1)
          break
        case 'next-finding':
          navigateFinding(1)
          break
        case 'toggle-suggestions':
          handleToggleSuggestions(action)
          break
        case 'filter-sev':
          handleFilterSev(action)
          break
        case 'select-sev':
          handleSelectSev(action)
          break
        case 'select-recommended':
          handleSelectRecommended()
          break
        case 'post-selected':
          void handlePostSelected()
          break
        case 'post-recommended':
          void handlePostRecommended()
          break
        case 'post-one': {
          // Legacy per-finding send icon (hover button).
          const id = action.getAttribute('data-finding-id')
          if (id && isLive) {
            openConfirm([id])
          } else if (!isLive) {
            showStatus(
              `Cannot post from an archived view. Run \`magpie serve ${runId()}\` to make this live.`,
              'warn',
            )
          }
          break
        }

        // -----------------------------------------------------------------------
        // Legacy actions (kept so action-key strings remain present for tests;
        // the new markup does not emit these data-action values).
        // -----------------------------------------------------------------------
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
          // Legacy; no-op in new layout.
          break
        case 'select-priority':
          // Legacy; no-op in new layout.
          break
        case 'select-none': {
          // Legacy: deselect all.
          for (const cb of allCheckboxes()) {
            if (cb.disabled) continue
            if (cb.checked) {
              cb.checked = false
              post({ type: 'deselect', findingId: cb.dataset.findingId, timestamp: Date.now() })
            }
          }
          updateSelectedCount()
          break
        }
        case 'clear-filters':
          // Legacy; no-op in new layout (filter-sev handles individual toggles).
          break
      }
    })

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
          navigateFinding(1)
          break
        case 'k':
          event.preventDefault()
          navigateFinding(-1)
          break
        case 'x':
        case ' ':
          event.preventDefault()
          toggleFocusedFinding()
          break
        case 'Escape':
          event.preventDefault()
          if (isConfirmOpen()) {
            closeConfirm()
          } else {
            // Clear focused annotation.
            for (const el of document.querySelectorAll('.annot.is-focused')) {
              el.classList.remove('is-focused')
            }
            const path = document.body.dataset.selectedFile ?? ''
            fileFindingIdx.set(path, -1)
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
