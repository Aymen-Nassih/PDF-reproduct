import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import { api } from './api/routes'

type Bindings = { DB: D1Database }

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

app.route('/api', api)

// Static assets: public/static/* -> /static/*
app.use('/static/*', serveStatic({ root: './' }))
// No binary favicon shipped — avoid a 500 from serveStatic on a missing file
app.get('/favicon.ico', (c) => c.body(null, 204))

// SPA-ish shell: dashboard + idea detail render client-side
app.get('*', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PDF Trend Lab — Find questions people actually search for</title>
  <meta name="description" content="Real-time trending questions and pain points, scored for opportunity. Discover profitable PDF guide ideas.">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg">
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/dayjs.min.js"></script>
  <link href="/static/styles.css" rel="stylesheet">
  <script>
    tailwind.config = { theme: { extend: { colors: { ink: '#0f172a', accent: '#6366f1' } } } }
  </script>
</head>
<body class="bg-slate-50 text-slate-800 min-h-screen">
  <header id="app-header" class="bg-white border-b border-slate-200 sticky top-0 z-40">
    <div class="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
      <a href="/" class="flex items-center gap-2 font-bold text-lg text-ink">
        <span class="w-8 h-8 rounded-lg bg-accent text-white grid place-items-center"><i class="fas fa-file-pdf"></i></span>
        PDF Trend Lab
      </a>
      <nav class="ml-auto flex items-center gap-2 text-sm">
        <a href="/" class="px-3 py-1.5 rounded-md hover:bg-slate-100"><i class="fas fa-gauge-high mr-1"></i>Dashboard</a>
        <a href="/?view=trending" class="px-3 py-1.5 rounded-md hover:bg-slate-100"><i class="fas fa-arrow-trend-up mr-1"></i>Trending</a>
        <a href="/?view=favorites" class="px-3 py-1.5 rounded-md hover:bg-slate-100"><i class="fas fa-star mr-1"></i>Favorites</a>
      </nav>
    </div>
  </header>

  <main id="app" class="max-w-6xl mx-auto px-4 py-6"></main>

  <footer class="max-w-6xl mx-auto px-4 py-8 text-center text-xs text-slate-400">
    Scores are computed transparently from Google Autocomplete, Google Trends &amp; Reddit signals.
    Click any score for the full breakdown.
  </footer>

  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <script src="/static/app.js"></script>
</body>
</html>`)
})

export default app
