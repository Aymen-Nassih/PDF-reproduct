// Market-intent analysis + sellability scoring + PDF product-idea generation.
//
// "Will this actually sell?" is proxied from *marketplace demand keywords*:
// when buyers look for PDF products they type format words (printable,
// template, digital download, pdf, planner pages...). If those keywords are
// confirmed by TWO independent engines (Google + Bing), the demand is real.

export const FORMAT_KEYWORDS = [
  'printable', 'template', 'pdf', 'digital download', 'digital', 'planner',
  'workbook', 'worksheet', 'checklist', 'tracker', 'bundle', 'kit',
  'ebook', 'guide', 'journal', 'calendar', 'spreadsheet', 'excel', 'notion'
]

const AUDIENCE_KEYWORDS: [RegExp, string][] = [
  [/\b(for )?(beginners?|newbie|starter)\b/, 'Beginners'],
  [/\b(for )?(kids?|children|toddler)\b/, 'Kids & Parents'],
  [/\b(for )?(teens?|students?|college)\b/, 'Students'],
  [/\b(for )?(teachers?|educators?|classroom)\b/, 'Teachers'],
  [/\b(for )?(small business|entrepreneurs?|business owners?)\b/, 'Small Business'],
  [/\b(for )?(nurses?|nursing|medical)\b/, 'Healthcare Workers'],
  [/\b(for )?(couples?|wedding|brides?)\b/, 'Couples & Weddings'],
  [/\b(for )?(moms?|dads?|parents?)\b/, 'Parents'],
  [/\b(for )?(seniors?|elderly|retirees?)\b/, 'Seniors'],
  [/\b(for )?(women|men)\b/, 'Gender-specific'],
  [/\b(adhd|autism|special needs)\b/, 'Neurodivergent'],
  [/\b(for )?(realtors?|real estate)\b/, 'Real Estate Pros']
]

const FORMAT_PRODUCT: [RegExp, { format: string; product: string; price: [number, number] }][] = [
  [/budget|finance|debt|savings|money/, { format: 'Budget Planner', product: 'Printable budget planner pack with monthly trackers, debt payoff sheets and savings challenges', price: [4, 12] }],
  [/meal|recipe|food|grocery|cooking/, { format: 'Meal Planner', product: 'Weekly meal-planning printable with grocery lists and recipe cards', price: [3, 9] }],
  [/fitness|workout|exercise|gym|weight/, { format: 'Fitness Tracker', product: 'Workout-log workbook with progress trackers and 12-week program sheets', price: [4, 11] }],
  [/wedding|bridal|bride/, { format: 'Wedding Planner', product: 'Complete wedding-planning binder (checklists, budget, timeline, vendor trackers)', price: [8, 25] }],
  [/teacher|classroom|lesson|homeschool/, { format: 'Teaching Resource', product: 'Lesson-plan templates + printable classroom activity worksheets', price: [3, 10] }],
  [/pregnancy|baby|newborn/, { format: 'Pregnancy Journal', product: 'Pregnancy & new-baby journal with milestone trackers and checklists', price: [5, 15] }],
  [/habit|productivity|adhd|focus/, { format: 'Habit Tracker', product: 'Daily habit-tracker bundle with routines, mood log and weekly reviews', price: [3, 9] }],
  [/clean|organiz|declutter|chore/, { format: 'Home Organization Kit', product: 'Cleaning-schedule printables, decluttering checklists and home-management binder', price: [4, 12] }],
  [/travel|trip|vacation|itinerary/, { format: 'Travel Planner', product: 'Trip-planning printable pack: itineraries, packing lists, budget sheets', price: [4, 10] }],
  [/business|marketing|social media|content/, { format: 'Business Planner', product: 'Small-business planner: content calendar, goal trackers, client worksheets', price: [7, 19] }],
  [/dog|puppy|pet|cat/, { format: 'Pet Care Pack', product: 'Pet-care printables: training log, vet records, feeding schedule', price: [3, 9] }],
  [/garden|plant/, { format: 'Garden Planner', product: 'Garden-planning workbook with planting calendars and harvest trackers', price: [4, 11] }],
  [/journal|self care|mental health|anxiety|gratitude/, { format: 'Wellness Journal', product: 'Guided wellness journal: prompts, mood trackers, self-care planners', price: [4, 12] }],
  [/resume|job|interview|career/, { format: 'Career Kit', product: 'Resume templates + interview-prep workbook and job-search tracker', price: [5, 15] }]
]

const GENERIC_PRODUCT = { format: 'Niche Guide', product: 'Step-by-step PDF guide with checklists, worksheets and a printable quick-reference', price: [4, 14] }

export interface MarketSignals {
  googleFormats: number // format-keyword hits across Google suggestions
  bingFormats: number // format-keyword hits across Bing suggestions
  crossEngineFormats: string[] // format keywords confirmed by BOTH engines
  bingSuggestions: number
  audiences: string[]
}

export function analyzeMarket(
  seed: string,
  googleTexts: string[],
  bingTexts: string[],
  clusterTexts: string[]
): MarketSignals {
  const seedFormats = FORMAT_KEYWORDS.filter((f) => !seed.includes(f))
  const hits = (texts: string[]) =>
    texts.filter((t) => seedFormats.some((f) => t.includes(f))).length

  const googleFormats = hits(googleTexts)
  const bingFormats = hits(bingTexts)

  // Which specific format words appear in both engines' suggestions?
  const gSet = new Set(googleTexts)
  const cross = new Set<string>()
  for (const b of bingTexts) {
    for (const f of seedFormats) {
      if (b.includes(f) && [...gSet].some((g) => g.includes(f))) cross.add(f)
    }
  }

  const audienceSet = new Set<string>()
  for (const t of clusterTexts) {
    for (const [re, label] of AUDIENCE_KEYWORDS) if (re.test(t)) audienceSet.add(label)
  }

  return {
    googleFormats,
    bingFormats,
    crossEngineFormats: [...cross],
    bingSuggestions: bingTexts.length,
    audiences: [...audienceSet]
  }
}

export interface Sellability {
  score: number // 0-100
  grade: 'A' | 'B' | 'C' | 'D'
  label: string
  reasons: string[]
}

// Sellability = will a PDF in this niche actually convert browsers into buyers?
export function computeSellability(
  market: MarketSignals,
  clusterTexts: string[],
  demand: number,
  buyerIntent: number
): Sellability {
  const reasons: string[] = []

  // Format demand: format words confirmed across engines (0-40)
  const fmtCount = market.googleFormats + market.bingFormats
  const fmtScore = Math.min(40, (fmtCount / 40) * 40)
  reasons.push(`${market.googleFormats} Google + ${market.bingFormats} Bing suggestions contain marketplace format words (printable/template/pdf…)`)

  // Cross-engine confirmation bonus (0-25)
  const crossScore = Math.min(25, market.crossEngineFormats.length * 5)
  if (market.crossEngineFormats.length)
    reasons.push(`Cross-engine confirmed formats: ${market.crossEngineFormats.join(', ')}`)

  // Buyer intent carried over (0-20)
  const intentScore = (buyerIntent / 100) * 20

  // Audience specificity (0-15): a defined audience = a defined buyer
  const audienceScore = Math.min(15, market.audiences.length * 7.5)
  if (market.audiences.length) reasons.push(`Clear buyer audience: ${market.audiences.join(', ')}`)

  const score = Math.round(Math.min(100, fmtScore + crossScore + intentScore + audienceScore))
  const grade: Sellability['grade'] = score >= 70 ? 'A' : score >= 50 ? 'B' : score >= 30 ? 'C' : 'D'
  const label =
    grade === 'A' ? 'Strong seller' : grade === 'B' ? 'Likely seller' : grade === 'C' ? 'Niche bet' : 'Research more'

  return { score, grade, label, reasons }
}

export interface ProductIdea {
  format: string
  product: string
  priceRange: [number, number]
  audiences: string[]
  titleSuggestions: string[]
  marketplaceLinks: { name: string; url: string }[]
}

const titleCaseLocal = (s: string) =>
  s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(And|Or|For|To|In|On|With|A|An|The|Of|Vs)\b/g, (w) => w.toLowerCase())

export function generateProductIdea(title: string, clusterTexts: string[], market: MarketSignals): ProductIdea {
  const hay = clusterTexts.join(' ')
  const match = FORMAT_PRODUCT.find(([re]) => re.test(hay))
  const base = match ? match[1] : GENERIC_PRODUCT

  const lowerTitle = title.toLowerCase()
  const audienceWord = market.audiences[0] ?? ''
  // Avoid duplicating words already present in the idea title
  const audienceSuffix =
    audienceWord && !lowerTitle.includes(audienceWord.split(' ')[0].toLowerCase()) ? ` for ${audienceWord}` : ''
  const formatSuffix = lowerTitle.includes(base.format.toLowerCase()) ? '' : ` ${base.format}`
  const titleSuggestions = [
    `${titleCaseLocal(title)}${audienceSuffix}: The Complete Guide`,
    `The Ultimate ${titleCaseLocal(title)}${formatSuffix} (Printable PDF)`,
    `${titleCaseLocal(title)} Made Simple — Step-by-Step + Checklists`
  ]

  const q = encodeURIComponent(title.replace(/…$/, '') + ' printable')
  const marketplaceLinks = [
    { name: 'Etsy', url: `https://www.etsy.com/search?q=${q}` },
    { name: 'Amazon KDP', url: `https://www.amazon.com/s?k=${encodeURIComponent(title + ' book')}` },
    { name: 'Gumroad', url: `https://gumroad.com/discover?query=${q}` },
    { name: 'Creative Market', url: `https://creativemarket.com/search?q=${q}` }
  ]

  return {
    format: base.format,
    product: base.product + (market.audiences.length ? ` — targeted at ${market.audiences.join(' & ').toLowerCase()}` : ''),
    priceRange: base.price,
    audiences: market.audiences,
    titleSuggestions,
    marketplaceLinks
  }
}
