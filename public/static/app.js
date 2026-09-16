/* PDF Trend Lab — frontend SPA */
(() => {
  const app = document.getElementById('app')
  const state = {
    q: '', category: '', difficulty: '', rising: false, min: 0,
    sort: 'opportunity', view: 'dashboard', ideaId: null, favorites: new Set()
  }

  const DIFF_CLASS = { Easy: 'badge-easy', Medium: 'badge-medium', Hard: 'badge-hard' }
  const DIFF_ICON = { Easy: 'fa-face-smile', Medium: 'fa-face-meh', Hard: 'fa-fire' }
  const GRADE_CLASS = { A: 'badge-easy', B: 'badge-rising', C: 'badge-medium', D: 'badge-hard' }

  function sellBadge(idea) {
    if (!idea.sell_grade) return ''
    const tip = (idea.sell_reasons || []).join('\n') || 'Sellability score'
    return `<span class="badge ${GRADE_CLASS[idea.sell_grade] || 'badge-neutral'}" data-tip="Sellability ${idea.sellability}/100 — will a PDF here actually sell?\n${esc(tip)}"><i class="fas fa-cart-shopping"></i>Sell ${idea.sell_grade} · ${idea.sellability}</span>`
  }

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
          ${sellBadge(idea)}
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
          ${[['opportunity', 'Opportunity'], ['sellability', 'Sellability'], ['momentum', 'Momentum'], ['interest', 'Interest'], ['demand', 'Demand'], ['updated_at', 'Newest']]
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
                ${sellBadge(idea)}
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

        ${renderProductPanel(idea)}

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

  // ---------- PDF product panel (market-driven product idea) ----------
  function renderProductPanel(idea) {
    const p = idea.product_idea || {}
    if (!p.format) return ''
    const price = p.priceRange ? `$${p.priceRange[0]}–$${p.priceRange[1]}` : ''
    return `
      <section class="bg-gradient-to-br from-indigo-50 to-white rounded-xl border border-indigo-200 p-5 mb-4">
        <h2 class="font-semibold text-ink mb-1"><i class="fas fa-box-open mr-1 text-accent"></i>PDF Product Idea — sellability ${idea.sellability}/100 (${esc(idea.sell_grade)})</h2>
        <p class="text-sm text-slate-600 mb-3">${esc(p.product || '')}</p>
        <div class="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-3">
          <span><i class="fas fa-file-lines text-slate-400 mr-1"></i>Format: <b>${esc(p.format)}</b></span>
          <span><i class="fas fa-dollar-sign text-slate-400 mr-1"></i>Typical price: <b>${price}</b></span>
          ${(p.audiences || []).length ? `<span><i class="fas fa-users text-slate-400 mr-1"></i>Audience: <b>${esc(p.audiences.join(', '))}</b></span>` : ''}
        </div>
        ${(idea.cross_formats || []).length ? `<p class="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3"><i class="fas fa-check-double mr-1"></i>Buyer-format keywords confirmed by Google + Bing: <b>${esc(idea.cross_formats.join(', '))}</b></p>` : ''}
        <details class="text-sm">
          <summary class="cursor-pointer text-accent font-medium">Title suggestions & marketplace competition check</summary>
          <ul class="mt-2 space-y-1 text-slate-700 list-disc list-inside">
            ${(p.titleSuggestions || []).map((t) => `<li>${esc(t)}</li>`).join('')}
          </ul>
          <div class="flex flex-wrap gap-2 mt-3">
            ${(p.marketplaceLinks || []).map((m) => `<a href="${esc(m.url)}" target="_blank" rel="noopener" class="text-xs px-3 py-1.5 rounded-full bg-white border border-slate-300 hover:border-accent hover:text-accent"><i class="fas fa-arrow-up-right-from-square mr-1"></i>Check ${esc(m.name)} competition</a>`).join('')}
          </div>
        </details>
      </section>`
  }

  // ---------- trending words analytics ----------
  async function renderWords() {
    const res = await axios.get('/api/trending-words')
    const { formatWords = [], topicWords = [] } = res.data
    const maxCount = Math.max(1, ...topicWords.map((w) => w.ideas))

    const wordChip = (w, isFormat) => {
      const size = 0.75 + (w.ideas / maxCount) * 0.9
      const heat = w.avgSellability >= 50 ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
        : w.avgOpportunity >= 45 ? 'text-indigo-700 bg-indigo-50 border-indigo-200'
        : 'text-slate-600 bg-white border-slate-200'
      return `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${heat}" style="font-size:${size}rem"
        data-tip="Appears in ${w.ideas} ideas across ${w.seeds} seeds\nAvg opportunity ${w.avgOpportunity} · avg sellability ${w.avgSellability}">
        ${isFormat ? '<i class="fas fa-tag text-[0.65em]"></i>' : ''}${esc(w.word)} <b class="text-[0.7em] opacity-70">${w.ideas}</b></span>`
    }

    app.innerHTML = `
      <nav class="mb-4 text-sm"><a href="/" class="nav text-accent hover:underline"><i class="fas fa-arrow-left mr-1"></i>Dashboard</a></nav>
      <h1 class="text-xl font-bold text-ink mb-1"><i class="fas fa-cloud mr-2 text-accent"></i>Trending Search Words</h1>
      <p class="text-sm text-slate-500 mb-5">Words dominating the mined ideas. <span class="text-emerald-700 font-medium">Green = high sellability</span>, indigo = high opportunity. Format words carry buyer intent.</p>

      <section class="bg-white rounded-xl border border-slate-200 p-5 mb-4">
        <h2 class="font-semibold text-ink mb-3"><i class="fas fa-tag mr-1 text-emerald-600"></i>Marketplace format words <span class="text-xs font-normal text-slate-400">— what PDF buyers search for</span></h2>
        <div class="flex flex-wrap gap-2">${formatWords.length ? formatWords.map((w) => wordChip(w, true)).join('') : '<p class="text-sm text-slate-400">No format words yet — mine more seeds.</p>'}</div>
      </section>

      <section class="bg-white rounded-xl border border-slate-200 p-5 mb-4">
        <h2 class="font-semibold text-ink mb-3"><i class="fas fa-fire mr-1 text-orange-500"></i>Topic words</h2>
        <div class="flex flex-wrap gap-2">${topicWords.length ? topicWords.map((w) => wordChip(w, false)).join('') : '<p class="text-sm text-slate-400">Mine some seeds first.</p>'}</div>
      </section>`
    app.querySelector('nav a.nav')?.addEventListener('click', (e) => { e.preventDefault(); go('/') })
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

  // ---------- global discover view ----------
  const SOURCE_META = {
    google: { label: 'Google Trends', icon: 'fab fa-google', color: '#4285f4' },
    twitter: { label: 'X / Twitter', icon: 'fab fa-x-twitter', color: '#0f172a' },
    youtube: { label: 'YouTube', icon: 'fab fa-youtube', color: '#ff0000' },
    hackernews: { label: 'Hacker News', icon: 'fab fa-hacker-news', color: '#ff6600' },
    wikipedia: { label: 'Wikipedia', icon: 'fab fa-wikipedia-w', color: '#334155' },
    github: { label: 'GitHub', icon: 'fab fa-github', color: '#24292f' },
    stackoverflow: { label: 'Stack Overflow', icon: 'fab fa-stack-overflow', color: '#f48024' },
    googlenews: { label: 'Google News', icon: 'fas fa-newspaper', color: '#0f9d58' },
    applepodcasts: { label: 'Podcasts', icon: 'fas fa-podcast', color: '#872ec4' },
    medium: { label: 'Medium', icon: 'fab fa-medium', color: '#000000' }
  }

  function trendCard(t) {
    const srcs = (t.extra.sources || [t.source])
    const score = t.pdf_potential
    const m = t.metrics || {}
    const color = score >= 70 ? '#16a34a' : score >= 50 ? '#6366f1' : score >= 35 ? '#d97706' : '#94a3b8'
    const searches = [...new Set([...(m.googleSuggestions || []), ...(m.bingSuggestions || [])])].slice(0, 5)
    return `
    <article class="idea-card fade-up bg-white rounded-xl border border-slate-200 p-4 flex gap-4 items-start">
      <div class="score-ring" style="--score:${score};--ring-color:${color}" data-tip="PDF potential ${score}/100\n${esc((t.reasons || []).join('\n'))}"><span>${score}</span></div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <h3 class="font-semibold text-ink leading-snug">${esc(t.term)}</h3>
          ${srcs.map((s) => `<span class="badge badge-neutral" style="color:${SOURCE_META[s]?.color}"><i class="${SOURCE_META[s]?.icon || 'fas fa-circle'}"></i>${SOURCE_META[s]?.label || s}</span>`).join('')}
          ${t.buyer_formats > 0 ? `<span class="badge badge-easy"><i class="fas fa-cart-shopping"></i>Buyer-verified ×${t.buyer_formats}</span>` : ''}
        </div>
        <p class="text-xs text-slate-500 mt-1">
          ${t.traffic ? `<i class="fas fa-signal mr-1"></i>${esc(t.traffic)} · ` : ''}
          first seen ${esc((t.first_seen || '').slice(5, 16))} · seen ${t.seen_count}×
        </p>
        ${m.probed ? `
        <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-600">
          <span data-tip="Distinct real searches containing this term, found live on Google + Bing autocomplete"><i class="fas fa-magnifying-glass mr-1 text-slate-400"></i><b>${m.breadth}</b> real searches</span>
          <span data-tip="Real questions people ask about this trend"><i class="fas fa-circle-question mr-1 text-slate-400"></i><b>${m.questionCount}</b> questions</span>
          <span data-tip="Marketplace format words (printable/template/pdf…) confirmed on BOTH Google and Bing — real buyer demand"><i class="fas fa-tag mr-1 text-slate-400"></i><b>${(m.buyerFormats || []).length}</b> buyer formats</span>
          ${(m.youtubeSuggestions || []).length ? `<span data-tip="People search this on YouTube: ${esc((m.youtubeSuggestions || []).slice(0, 3).join('; '))}"><i class="fab fa-youtube mr-1 text-red-500"></i><b>${m.youtubeSuggestions.length}</b> video searches</span>` : ''}
          ${(m.ebaySuggestions || []).length ? `<span data-tip="People search this on eBay: ${esc((m.ebaySuggestions || []).slice(0, 3).join('; '))}"><i class="fas fa-bag-shopping mr-1 text-blue-500"></i><b>${m.ebaySuggestions.length}</b> commerce searches</span>` : ''}
        </div>` : `<p class="text-xs text-slate-400 mt-2 italic">Not market-probed yet — preliminary score. <button class="probe-btn text-accent hover:underline font-medium not-italic" data-id="${t.id}"><i class="fas fa-satellite-dish mr-1"></i>Probe market data</button></p>`}
        ${(m.buyerFormats || []).length ? `<div class="flex flex-wrap gap-1 mt-2">${m.buyerFormats.map((f) => `<span class="text-[0.6875rem] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">+ ${esc(f)}</span>`).join('')}</div>` : ''}
        ${searches.length ? `<details class="mt-2 text-xs"><summary class="cursor-pointer text-slate-400 hover:text-slate-600">What people actually search (${m.breadth || searches.length})</summary><ul class="mt-1 space-y-0.5 text-slate-600">${searches.map((s) => `<li class="flex gap-1.5"><i class="fas fa-angle-right text-slate-300 mt-0.5"></i>${esc(s)}</li>`).join('')}</ul></details>` : ''}
        ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" class="text-xs text-accent hover:underline"><i class="fas fa-arrow-up-right-from-square mr-1"></i>Source link</a>` : ''}
      </div>
      <button class="mine-btn no-print shrink-0 px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-indigo-500 disabled:opacity-50" data-term="${esc(t.term)}">
        <i class="fas fa-bolt mr-1"></i>Mine this trend
      </button>
    </article>`
  }

  async function renderDiscover(source = '', min = 0, q = '', verified = false) {
    const res = await axios.get(`/api/discover?source=${encodeURIComponent(source)}&min=${min}&q=${encodeURIComponent(q)}${verified ? '&verified=1' : ''}`)
    const { trends = [], refreshing } = res.data
    app.innerHTML = `
      <nav class="mb-4 text-sm flex items-center gap-3">
        <a href="/" class="nav text-accent hover:underline"><i class="fas fa-arrow-left mr-1"></i>Dashboard</a>
        ${refreshing ? '<span class="text-slate-400 flex items-center gap-2"><span class="spinner" style="width:12px;height:12px;border-width:2px"></span>Refreshing global sources…</span>' : ''}
        <button id="discover-refresh" class="ml-auto px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 text-xs"><i class="fas fa-rotate mr-1"></i>Refresh now</button>
      </nav>
      <h1 class="text-xl font-bold text-ink mb-1"><i class="fas fa-globe mr-2 text-accent"></i>Discover — Global Trends</h1>
      <p class="text-sm text-slate-500 mb-4">What the world is searching & talking about right now. Each score is computed from <b>live market data</b> — real searches, real questions, and buyer-format demand verified on both Google &amp; Bing. Click <b>Mine this trend</b> to run the full idea pipeline on it.</p>

      <div class="mb-4 bg-white rounded-xl border border-slate-200 p-3 flex flex-col sm:flex-row gap-3">
        <div class="flex-1 relative">
          <i class="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input id="d-search" type="text" placeholder="Search trends…" value="${esc(q)}"
            class="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 focus:border-accent focus:ring-2 focus:ring-indigo-100 outline-none text-sm">
        </div>
        <label class="flex items-center gap-1.5 text-sm cursor-pointer whitespace-nowrap" title="Only trends with buyer-format demand (printable/template/pdf…) confirmed on BOTH Google and Bing">
          <input type="checkbox" id="d-verified" ${verified ? 'checked' : ''} class="accent-emerald-600">
          <i class="fas fa-cart-shopping text-emerald-600"></i> Market-verified only
        </label>
      </div>

      <div class="mb-4 flex flex-wrap items-center gap-2">
        <span class="chip ${!source ? 'active' : ''}" data-src=""><i class="fas fa-border-all"></i>All</span>
        ${Object.entries(SOURCE_META).map(([k, m]) => `<span class="chip ${source === k ? 'active' : ''}" data-src="${k}"><i class="${m.icon}"></i>${m.label}</span>`).join('')}
        <label class="flex items-center gap-1.5 text-sm ml-auto">
          Min potential
          <input type="range" id="d-min" min="0" max="100" step="5" value="${min}" class="accent-indigo-600 w-24">
          <span class="w-8 text-slate-600">${min}</span>
        </label>
      </div>

      <section class="grid gap-3">
        ${trends.length ? trends.map(trendCard).join('') : `<div class="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500"><i class="fas fa-satellite-dish text-3xl text-slate-300 mb-3"></i><p>No trends match these filters${verified ? ' — try turning off Market-verified' : ''}. Hit Refresh now to fetch the latest.</p></div>`}
      </section>`

    app.querySelector('nav a.nav')?.addEventListener('click', (e) => { e.preventDefault(); go('/') })
    document.getElementById('discover-refresh')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget
      btn.disabled = true
      btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block"></span> Fetching…'
      await axios.post('/api/discover/refresh', {}, { timeout: 90000 }).catch(() => {})
      renderDiscover(source, min, q, verified)
    })
    document.querySelectorAll('.chip[data-src]').forEach((el) =>
      el.addEventListener('click', () => renderDiscover(el.dataset.src, min, q, verified))
    )
    document.getElementById('d-verified')?.addEventListener('change', (e) => renderDiscover(source, min, q, e.target.checked))
    document.getElementById('d-search')?.addEventListener('input', (e) => {
      clearTimeout(window.__dqT)
      window.__dqT = setTimeout(() => renderDiscover(source, min, e.target.value, verified), 350)
    })
    document.getElementById('d-min')?.addEventListener('input', (e) => {
      clearTimeout(window.__dminT)
      window.__dminT = setTimeout(() => renderDiscover(source, +e.target.value, q, verified), 300)
    })
    document.querySelectorAll('.probe-btn').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true
        b.innerHTML = '<span class="spinner" style="width:10px;height:10px;border-width:2px;display:inline-block"></span> Probing…'
        try {
          await axios.post(`/api/trends/${b.dataset.id}/probe`, {}, { timeout: 60000 })
          renderDiscover(source, min, q, verified)
        } catch {
          b.innerHTML = '<i class="fas fa-triangle-exclamation mr-1"></i>Failed'
          setTimeout(() => { b.disabled = false; b.innerHTML = '<i class="fas fa-satellite-dish mr-1"></i>Probe market data' }, 2500)
        }
      })
    )
    document.querySelectorAll('.mine-btn').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true
        b.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block"></span> Mining…'
        try {
          const res = await axios.post('/api/search', { seed: b.dataset.term }, { timeout: 120000 })
          if (res.data.error && res.data.error !== 'Fresh data already exists') throw new Error(res.data.error)
          b.innerHTML = '<i class="fas fa-check mr-1"></i>Mined! View →'
          b.classList.remove('bg-accent', 'hover:bg-indigo-500')
          b.classList.add('bg-emerald-600')
          b.addEventListener('click', () => { state.q = b.dataset.term; go('/') }, { once: true })
        } catch (err) {
          b.innerHTML = '<i class="fas fa-triangle-exclamation mr-1"></i>Failed'
          setTimeout(() => { b.disabled = false; b.innerHTML = '<i class="fas fa-bolt mr-1"></i>Mine this trend' }, 2500)
        }
      })
    )
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
    // Show which API integrations are live (booleans only — values never leave the server)
    axios.get('/api/keys/status').then((res) => {
      const k = res.data.integrations || {}
      const active = Object.entries(k).filter(([, v]) => v).map(([n]) => n)
      if (!active.length) return
      const el = document.createElement('div')
      el.className = 'fixed bottom-3 right-3 bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2 text-xs text-slate-600 z-50 no-print'
      el.innerHTML = `<i class="fas fa-plug text-emerald-500 mr-1"></i>API live: ${active.join(', ')}`
      document.body.appendChild(el)
    }).catch(() => {})
  }

  // ---------- router ----------
  function render() {
    chart?.destroy(); chart = null
    if (state.view === 'idea' && state.ideaId) renderIdea()
    else if (state.view === 'discover') renderDiscover()
    else if (state.view === 'words') renderWords()
    else if (state.view === 'trending') renderList('Trending Now', 'fa-arrow-trend-up', '/api/trending')
    else if (state.view === 'favorites') renderList('Favorites', 'fa-star', '/api/favorites')
    else renderDashboard()
  }

  route()
})()
