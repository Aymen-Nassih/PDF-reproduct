/* PDF Trend Lab — frontend SPA */
(() => {
  const app = document.getElementById('app')
  const state = {
    q: '', category: '', difficulty: '', rising: false, min: 0,
    sort: 'opportunity', view: 'dashboard', ideaId: null, favorites: new Set()
  }

  const DIFF_CLASS = { Easy: 'badge-easy', Medium: 'badge-medium', Hard: 'badge-hard' }
  const DIFF_ICON = { Easy: 'fa-face-smile', Medium: 'fa-face-meh', Hard: 'fa-fire' }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))

  function route() {
    const params = new URLSearchParams(location.search)
    state.view = params.get('view') || 'dashboard'
    const path = location.pathname
    const m = path.match(/^\/idea\/([a-f0-9]+)/)
    state.ideaId = m ? m[1] : null
    if (state.ideaId) state.view = 'idea'
    render()
  }

  function go(url) {
    history.pushState({}, '', url)
    route()
  }
  window.addEventListener('popstate', route)

  // ---------- components ----------
  function scoreRing(score) {
    const color = score >= 70 ? '#16a34a' : score >= 45 ? '#6366f1' : score >= 30 ? '#d97706' : '#94a3b8'
    return `<div class="score-ring" style="--score:${score};--ring-color:${color}" data-tip="Opportunity = 0.30·demand + 0.25·momentum\n+ 0.20·competition + 0.15·buyer intent + 0.10·interest">
      <span>${score}</span></div>`
  }

  function badge(label, value, tip, cls) {
    return `<span class="badge ${cls}" data-tip="${esc(tip)}">${label}: <b>${value}</b></span>`
  }

  function ideaCard(idea) {
    const fav = state.favorites.has(idea.id)
    return `
    <article class="idea-card fade-up bg-white rounded-xl border border-slate-200 p-4 flex gap-4" data-id="${idea.id}">
      ${scoreRing(idea.opportunity)}
      <div class="min-w-0 flex-1">
        <div class="flex items-start gap-2">
          <a href="/idea/${idea.id}" class="nav font-semibold text-ink hover:text-accent leading-snug">${esc(idea.title)}</a>
          ${idea.rising ? '<span class="badge badge-rising"><i class="fas fa-arrow-trend-up"></i>Rising</span>' : ''}
        </div>
        <p class="text-xs text-slate-500 mt-0.5">
          <i class="fas fa-tag mr-1"></i>${esc(idea.category)} · seed: <code class="bg-slate-100 px-1 rounded">${esc(idea.seed)}</code>
        </p>
        <div class="flex flex-wrap gap-1.5 mt-2">
          <span class="badge ${DIFF_CLASS[idea.difficulty]}" data-tip="Difficulty from competition score.\n${idea.competition} >= 70 = Easy, >= 40 = Medium, else Hard"><i class="fas ${DIFF_ICON[idea.difficulty]}"></i>${idea.difficulty}</span>
          ${badge('Interest', idea.interest, 'Average Google Trends interest over trailing 12 months (0-100).', 'badge-neutral')}
          ${badge('Competition', idea.competition, 'Inverse of query crowding + cluster breadth.\nHigher = less competition.', 'badge-neutral')}
          ${badge('Momentum', idea.momentum, 'Last-90d trend vs prior-90d trend.\n>50 = growing.', 'badge-neutral')}
        </div>
        <p class="text-xs text-slate-400 mt-2 truncate">${esc((idea.sample_questions || [])[0] || idea.example_keywords.slice(0, 4).join(', '))}</p>
      </div>
      <button class="fav-btn no-print self-start text-lg ${fav ? 'text-amber-400' : 'text-slate-300 hover:text-amber-300'}" data-id="${idea.id}" title="Favorite">
        <i class="fas fa-star"></i>
      </button>
    </article>`
  }

  function statCard(label, value, icon, color) {
    return `<div class="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
      <span class="w-10 h-10 rounded-lg grid place-items-center text-white" style="background:${color}"><i class="fas ${icon}"></i></span>
      <div><div class="text-2xl font-bold text-ink">${value}</div><div class="text-xs text-slate-500">${label}</div></div>
    </div>`
  }

  // ---------- views ----------
  async function renderDashboard() {
    const [statsRes, ideasRes] = await Promise.all([
      axios.get('/api/stats'),
      axios.get(buildIdeasUrl())
    ])
    const stats = statsRes.data
    const ideas = ideasRes.data.ideas || []
    await syncFavorites()

    app.innerHTML = `
      <section class="mb-6">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          ${statCard('Ideas discovered', stats.ideas, 'fa-lightbulb', '#6366f1')}
          ${statCard('Rising now', stats.rising, 'fa-arrow-trend-up', '#8b5cf6')}
          ${statCard('Seeds mined', stats.seeds, 'fa-seedling', '#0ea5e9')}
          ${statCard('Categories', stats.categories.length, 'fa-layer-group', '#10b981')}
        </div>
        <form id="seed-form" class="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row gap-3">
          <div class="flex-1 relative">
            <i class="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
            <input id="seed-input" type="text" placeholder="Enter a niche seed keyword — e.g. dog training, menopause, budget planner…"
              class="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-300 focus:border-accent focus:ring-2 focus:ring-indigo-100 outline-none" value="${esc(state.q)}">
          </div>
          <button type="submit" id="seed-btn" class="px-5 py-2.5 rounded-lg bg-accent text-white font-semibold hover:bg-indigo-500 disabled:opacity-50 flex items-center justify-center gap-2 min-w-[150px]">
            <i class="fas fa-bolt"></i> Discover Ideas
          </button>
        </form>
      </section>

      <section class="mb-4 flex flex-wrap items-center gap-2">
        <span class="chip ${!state.category ? 'active' : ''}" data-cat=""><i class="fas fa-border-all"></i>All</span>
        ${stats.categories.map((c) => `<span class="chip ${state.category === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</span>`).join('')}
      </section>

      <section class="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <select id="f-difficulty" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">
          <option value="">Any difficulty</option>
          ${['Easy', 'Medium', 'Hard'].map((d) => `<option ${state.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}
        </select>
        <label class="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" id="f-rising" ${state.rising ? 'checked' : ''} class="accent-indigo-600"> Rising only
        </label>
        <label class="flex items-center gap-1.5">
          Min opportunity
          <input type="range" id="f-min" min="0" max="100" step="5" value="${state.min}" class="accent-indigo-600 w-28">
          <span id="f-min-val" class="w-8 text-slate-600">${state.min}</span>
        </label>
        <select id="f-sort" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white">
          ${[['opportunity', 'Opportunity'], ['momentum', 'Momentum'], ['interest', 'Interest'], ['demand', 'Demand'], ['updated_at', 'Newest']]
            .map(([v, l]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>Sort: ${l}</option>`).join('')}
        </select>
        <a href="/api/export.csv?min=${state.min}${state.q ? '&q=' + encodeURIComponent(state.q) : ''}"
           class="ml-auto px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-600">
          <i class="fas fa-file-csv mr-1"></i>Export CSV</a>
      </section>

      <section id="ideas-list" class="grid gap-3">
        ${ideas.length ? ideas.map(ideaCard).join('') : emptyState()}
      </section>`

    bindDashboard()
    lazyRefresh()
  }

  function emptyState() {
    return `<div class="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-500">
      <i class="fas fa-telescope text-3xl text-slate-300 mb-3"></i>
      <p class="font-medium">No ideas yet for these filters.</p>
      <p class="text-sm mt-1">Enter a seed keyword above — the engine mines Google Autocomplete, Trends &amp; Reddit, then clusters and scores real questions.</p>
      <p class="text-sm mt-3">Try: <button class="quick-seed text-accent hover:underline">dog training</button> ·
        <button class="quick-seed text-accent hover:underline">budget planner</button> ·
        <button class="quick-seed text-accent hover:underline">menopause</button> ·
        <button class="quick-seed text-accent hover:underline">notion templates</button></p>
    </div>`
  }

  function buildIdeasUrl() {
    const p = new URLSearchParams()
    if (state.q) p.set('q', state.q)
    if (state.category) p.set('category', state.category)
    if (state.difficulty) p.set('difficulty', state.difficulty)
    if (state.rising) p.set('rising', '1')
    if (state.min) p.set('min', state.min)
    if (state.sort) p.set('sort', state.sort)
    return '/api/ideas?' + p.toString()
  }

  function bindDashboard() {
    document.getElementById('seed-form')?.addEventListener('submit', onSeedSubmit)
    document.querySelectorAll('.chip[data-cat]').forEach((el) =>
      el.addEventListener('click', () => { state.category = el.dataset.cat; renderDashboard() })
    )
    document.getElementById('f-difficulty')?.addEventListener('change', (e) => { state.difficulty = e.target.value; renderDashboard() })
    document.getElementById('f-rising')?.addEventListener('change', (e) => { state.rising = e.target.checked; renderDashboard() })
    document.getElementById('f-min')?.addEventListener('input', (e) => {
      document.getElementById('f-min-val').textContent = e.target.value
      state.min = +e.target.value
      clearTimeout(window.__minT)
      window.__minT = setTimeout(renderDashboard, 300)
    })
    document.getElementById('f-sort')?.addEventListener('change', (e) => { state.sort = e.target.value; renderDashboard() })
    document.querySelectorAll('.quick-seed').forEach((b) =>
      b.addEventListener('click', () => {
        document.getElementById('seed-input').value = b.textContent
        onSeedSubmit(new Event('submit'))
      })
    )
    bindCards()
  }

  function bindCards() {
    document.querySelectorAll('a.nav').forEach((a) =>
      a.addEventListener('click', (e) => { e.preventDefault(); go(a.getAttribute('href')) })
    )
    document.querySelectorAll('.fav-btn').forEach((b) =>
      b.addEventListener('click', async (e) => {
        e.stopPropagation()
        const id = b.dataset.id
        if (state.favorites.has(id)) {
          await axios.delete(`/api/ideas/${id}/favorite`)
          state.favorites.delete(id)
          b.className = 'fav-btn no-print self-start text-lg text-slate-300 hover:text-amber-300'
        } else {
          await axios.post(`/api/ideas/${id}/favorite`)
          state.favorites.add(id)
          b.className = 'fav-btn no-print self-start text-lg text-amber-400'
        }
      })
    )
  }

  async function onSeedSubmit(e) {
    e.preventDefault?.()
    const input = document.getElementById('seed-input')
    const btn = document.getElementById('seed-btn')
    const seed = input.value.trim()
    if (!seed) return
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Mining…'
    try {
      const res = await axios.post('/api/search', { seed }, { timeout: 120000 })
      if (res.data.error && res.data.error !== 'Fresh data already exists') {
        btn.innerHTML = '<i class="fas fa-triangle-exclamation"></i> ' + esc(res.data.error)
        setTimeout(() => { btn.disabled = false; btn.innerHTML = '<i class="fas fa-bolt"></i> Discover Ideas' }, 2500)
        return
      }
      state.q = seed
      await renderDashboard()
      if (res.data.ideas === 0) {
        const list = document.getElementById('ideas-list')
        if (list) list.insertAdjacentHTML('afterbegin',
          `<div class="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">Seed processed but no clusters formed — try a broader niche (e.g. "home fitness" instead of "7-minute ab finisher").</div>`)
      }
    } catch (err) {
      btn.innerHTML = '<i class="fas fa-triangle-exclamation"></i> Failed — retry'
      setTimeout(() => { btn.innerHTML = '<i class="fas fa-bolt"></i> Discover Ideas' }, 2500)
    } finally {
      btn.disabled = false
      if (!btn.innerHTML.includes('retry')) btn.innerHTML = '<i class="fas fa-bolt"></i> Discover Ideas'
    }
  }

  // ---------- idea detail ----------
  let chart = null
  async function renderIdea() {
    const res = await axios.get(`/api/ideas/${state.ideaId}`).catch(() => null)
    if (!res) { app.innerHTML = '<p class="text-slate-500">Idea not found. <a href="/" class="nav text-accent">Back to dashboard</a></p>'; bindCards(); return }
    const idea = res.data.idea
    if (idea.favorited) state.favorites.add(idea.id)
    const ex = idea.explain || {}
    const src = idea.sources || {}

    app.innerHTML = `
      <nav class="mb-4 text-sm"><a href="/" class="nav text-accent hover:underline"><i class="fas fa-arrow-left mr-1"></i>All ideas</a></nav>
      <article class="fade-up">
        <header class="bg-white rounded-xl border border-slate-200 p-5 mb-4">
          <div class="flex flex-wrap items-start gap-4">
            ${scoreRing(idea.opportunity)}
            <div class="flex-1 min-w-[240px]">
              <h1 class="text-2xl font-bold text-ink">${esc(idea.title)}</h1>
              <p class="text-sm text-slate-500 mt-1">
                <i class="fas fa-tag mr-1"></i>${esc(idea.category)} · seed <code class="bg-slate-100 px-1.5 py-0.5 rounded">${esc(idea.seed)}</code>
                · ${idea.cluster_size} related queries · updated ${dayjs(idea.updated_at + 'Z').fromNow ? dayjs(idea.updated_at + 'Z').fromNow() : idea.updated_at}
              </p>
              <div class="flex flex-wrap gap-1.5 mt-3">
                <span class="badge ${DIFF_CLASS[idea.difficulty]}" data-tip="${esc(ex.difficultyRule || '')}"><i class="fas ${DIFF_ICON[idea.difficulty]}"></i>${idea.difficulty}</span>
                ${idea.rising ? '<span class="badge badge-rising"><i class="fas fa-arrow-trend-up"></i>Rising</span>' : ''}
                ${badge('Interest', idea.interest, 'Avg Google Trends interest, trailing 12 months.', 'badge-neutral')}
                ${badge('Momentum', idea.momentum, `Trend momentum: ${ex.momentumPctChange ?? 0}% change, last 90d vs prior 90d.`, 'badge-neutral')}
                ${badge('Competition', idea.competition, ex.competitionNote || 'Inverse crowding score.', 'badge-neutral')}
                ${badge('Buyer intent', idea.buyer_intent, 'Share of queries matching purchase-intent phrasing:\nhow to, guide, checklist, printable, template, planner…', 'badge-neutral')}
                ${badge('Demand', idea.demand, ex.demandNote || 'Distinct queries discovered.', 'badge-neutral')}
              </div>
            </div>
            <div class="flex gap-2 no-print">
              <button id="fav-toggle" class="px-3 py-2 rounded-lg border ${idea.favorited ? 'border-amber-300 bg-amber-50 text-amber-600' : 'border-slate-300 text-slate-600'} text-sm">
                <i class="fas fa-star mr-1"></i>${idea.favorited ? 'Saved' : 'Save'}
              </button>
              <button id="outline-btn" class="px-3 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-indigo-500">
                <i class="fas fa-wand-magic-sparkles mr-1"></i>Generate PDF Outline
              </button>
            </div>
          </div>
          <div class="mt-4 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-600">
            <b>Why this score:</b> opportunity = ${esc(ex.formula || '')}.
            Demand: ${esc(ex.demandNote || '')}. ${esc(ex.competitionNote || '')}
            Sources: ${src.autocomplete ?? 0} autocomplete suggestions, ${src.redditPosts ?? 0} Reddit posts${src.trendsOk ? ', Google Trends live' : ''}.
          </div>
        </header>

        <div class="grid md:grid-cols-2 gap-4 mb-4">
          <section class="bg-white rounded-xl border border-slate-200 p-5">
            <h2 class="font-semibold text-ink mb-3"><i class="fas fa-chart-line mr-1 text-accent"></i>12-month interest</h2>
            ${idea.trend_series?.length ? '<canvas id="trend-chart" height="160"></canvas>' : '<p class="text-sm text-slate-400">No trend data for this seed.</p>'}
          </section>
          <section class="bg-white rounded-xl border border-slate-200 p-5">
            <h2 class="font-semibold text-ink mb-3"><i class="fas fa-key mr-1 text-accent"></i>Example keywords</h2>
            <ul class="flex flex-wrap gap-2">
              ${idea.example_keywords.map((k) => `<li class="text-xs bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full">${esc(k)}</li>`).join('')}
            </ul>
          </section>
        </div>

        <div class="grid md:grid-cols-2 gap-4 mb-4">
          <section class="bg-white rounded-xl border border-slate-200 p-5">
            <h2 class="font-semibold text-ink mb-3"><i class="fas fa-circle-question mr-1 text-accent"></i>Real questions people ask</h2>
            <ul class="space-y-2 text-sm text-slate-700">
              ${idea.sample_questions.map((q) => `<li class="flex gap-2"><i class="fas fa-quote-left text-slate-300 mt-1"></i><span>${esc(q)}</span></li>`).join('') || '<li class="text-slate-400">No questions captured.</li>'}
            </ul>
          </section>
          <section class="bg-white rounded-xl border border-slate-200 p-5">
            <h2 class="font-semibold text-ink mb-3"><i class="fab fa-reddit-alien mr-1 text-orange-500"></i>Reddit pain points</h2>
            <ul class="space-y-2 text-sm text-slate-700">
              ${(src.redditSample || []).map((p) => `<li class="flex gap-2"><span class="text-xs text-slate-400 whitespace-nowrap mt-0.5">r/${esc(p.subreddit)}</span><span>${esc(p.title)} <span class="text-xs text-slate-400">▲${p.score}</span></span></li>`).join('') || '<li class="text-slate-400">No Reddit posts captured.</li>'}
            </ul>
          </section>
        </div>

        <section id="outline-section" class="hidden bg-white rounded-xl border border-slate-200 p-5 mb-4"></section>
      </article>`

    bindCards()
    document.querySelector('nav a.nav')?.addEventListener('click', (e) => { e.preventDefault(); go('/') })
    document.getElementById('fav-toggle')?.addEventListener('click', async () => {
      if (state.favorites.has(idea.id)) { await axios.delete(`/api/ideas/${idea.id}/favorite`); state.favorites.delete(idea.id) }
      else { await axios.post(`/api/ideas/${idea.id}/favorite`); state.favorites.add(idea.id) }
      renderIdea()
    })
    document.getElementById('outline-btn')?.addEventListener('click', () => renderOutline(idea))

    if (idea.trend_series?.length) {
      const ctx = document.getElementById('trend-chart')
      chart?.destroy()
      const s = idea.trend_series
      chart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: s.map((_, i) => (i === s.length - 1 ? 'now' : `${s.length - 1 - i}w ago`)),
          datasets: [{ data: s, borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', fill: true, tension: 0.3, pointRadius: 0 }]
        },
        options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 8 } }, y: { min: 0, max: 100 } } }
      })
    }
  }

  // ---------- PDF outline generator (algorithmic, no LLM needed) ----------
  function renderOutline(idea) {
    const section = document.getElementById('outline-section')
    const qs = idea.sample_questions || []
    const kws = idea.example_keywords || []
    const chapters = qs.slice(0, 6).map((q, i) => `
      <div class="border-l-2 border-indigo-200 pl-4 py-1">
        <h4 class="font-semibold text-ink">Chapter ${i + 2}: ${esc(q.replace(/\?$/, ''))}</h4>
        <p class="text-sm text-slate-600 mt-1">Answer this question step by step. Include a checklist and one worked example using keywords like <em>${esc(kws[i % kws.length] || idea.seed)}</em>.</p>
      </div>`).join('')

    section.classList.remove('hidden')
    section.innerHTML = `
      <div class="flex items-start justify-between mb-4">
        <h2 class="font-semibold text-ink"><i class="fas fa-file-pdf mr-1 text-red-500"></i>PDF Guide Outline — “${esc(idea.title)}: The Complete Guide”</h2>
        <button onclick="window.print()" class="no-print px-3 py-1.5 rounded-lg border border-slate-300 text-sm hover:bg-slate-50"><i class="fas fa-print mr-1"></i>Print / Save as PDF</button>
      </div>
      <div class="space-y-4 text-sm">
        <div class="border-l-2 border-indigo-400 pl-4 py-1">
          <h4 class="font-semibold text-ink">Chapter 1: Introduction — Why ${esc(idea.seed)} matters right now</h4>
          <p class="text-slate-600 mt-1">Hook with the momentum stat (${idea.momentum}/100) and the most common pain point below. Promise: by the end, the reader can answer every question in this guide.</p>
        </div>
        ${chapters}
        <div class="border-l-2 border-indigo-200 pl-4 py-1">
          <h4 class="font-semibold text-ink">Chapter ${qs.length + 2}: Printable checklist &amp; templates</h4>
          <p class="text-sm text-slate-600 mt-1">One-page printable summary + worksheet targeting: ${kws.slice(0, 5).map(esc).join(', ')}.</p>
        </div>
        <div class="border-l-2 border-indigo-200 pl-4 py-1">
          <h4 class="font-semibold text-ink">Bonus: Resources &amp; next steps</h4>
          <p class="text-sm text-slate-600 mt-1">Curated tools list + upsell page for your next guide in the ${esc(idea.category)} niche.</p>
        </div>
      </div>`
    section.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ---------- trending & favorites views ----------
  async function renderList(title, icon, url) {
    const res = await axios.get(url)
    const ideas = res.data.ideas || []
    await syncFavorites()
    app.innerHTML = `
      <nav class="mb-4 text-sm"><a href="/" class="nav text-accent hover:underline"><i class="fas fa-arrow-left mr-1"></i>Dashboard</a></nav>
      <h1 class="text-xl font-bold text-ink mb-4"><i class="fas ${icon} mr-2 text-accent"></i>${title}</h1>
      <section class="grid gap-3">${ideas.length ? ideas.map(ideaCard).join('') : '<p class="text-slate-500">Nothing here yet.</p>'}</section>`
    bindCards()
    app.querySelector('nav a.nav')?.addEventListener('click', (e) => { e.preventDefault(); go('/') })
  }

  async function syncFavorites() {
    try {
      const res = await axios.get('/api/favorites')
      state.favorites = new Set((res.data.ideas || []).map((i) => i.id))
    } catch { /* ignore */ }
  }

  let refreshed = false
  function lazyRefresh() {
    if (refreshed) return
    refreshed = true
    axios.get('/api/refresh-stale').catch(() => {})
  }

  // ---------- router ----------
  function render() {
    chart?.destroy(); chart = null
    if (state.view === 'idea' && state.ideaId) renderIdea()
    else if (state.view === 'trending') renderList('Trending Now', 'fa-arrow-trend-up', '/api/trending')
    else if (state.view === 'favorites') renderList('Favorites', 'fa-star', '/api/favorites')
    else renderDashboard()
  }

  route()
})()
