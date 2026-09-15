// Lightweight clustering for Workers — token-based agglomerative clustering.
// Replaces sentence-transformers + HDBSCAN (no Python in Workers) with
// Jaccard similarity over content tokens + Union-Find grouping.

const STOPWORDS = new Set(
  'a an the and or but of for to in on with at by from as is are was were be been being do does did have has had i you he she it we they me him her us them my your his its our their this that these those what which who whom when where why how can could will would should shall may might must not no yes vs best top'.split(
    ' '
  )
)

export function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  return [...new Set(tokens)]
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter || 1)
}

class UnionFind {
  parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]
      x = this.parent[x]
    }
    return x
  }
  union(a: number, b: number) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[ra] = rb
  }
}

export interface Cluster {
  members: string[]
  centroidTokens: string[]
}

// excludeTokens: tokens shared by nearly all texts (e.g. the seed keyword itself)
// that would otherwise inflate similarity and merge everything into one cluster.
export function clusterTexts(texts: string[], threshold = 0.3, excludeTokens: string[] = []): Cluster[] {
  const unique = [...new Set(texts.map((t) => t.trim().toLowerCase()).filter(Boolean))]
  if (!unique.length) return []
  const exclude = new Set(excludeTokens)
  const strip = (tokens: string[]) => {
    const kept = tokens.filter((t) => !exclude.has(t))
    return kept.length ? kept : tokens // keep originals if everything was excluded
  }
  const tokenSets = unique.map((t) => new Set(strip(tokenize(t))))
  const uf = new UnionFind(unique.length)

  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const [a, b] = [tokenSets[i], tokenSets[j]]
      if (jaccard(a, b) >= threshold) uf.union(i, j)
    }
  }

  const groups = new Map<number, string[]>()
  for (let i = 0; i < unique.length; i++) {
    const root = uf.find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(unique[i])
  }

  return [...groups.values()].map((members) => {
    const freq = new Map<string, number>()
    for (const m of members) for (const t of tokenize(m)) freq.set(t, (freq.get(t) ?? 0) + 1)
    const centroidTokens = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t)
    return { members, centroidTokens }
  })
}
