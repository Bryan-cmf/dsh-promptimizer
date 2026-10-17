/**
 * dsh-promptimizer — host half.
 *
 * Registers a same-origin HTTP route (POST /api/promptimizer/optimize) so the
 * client half can optimize prompts WITHOUT any user-provided key or endpoint:
 * the call flows through the app's own `llm` service — the same providers,
 * credentials, and the CURRENTLY SELECTED model the session already uses.
 * (Client-side direct fetch to external APIs dies on CORS + missing keys;
 * this bridge is the zero-config path. A custom endpoint+key in the client
 * settings still takes precedence when the user configures one.)
 *
 * Model resolution order (per request):
 *   1. explicit "provider/model" from client settings
 *   2. the model display name parsed from the app's model selector, matched
 *      against the llm service's provider catalogs (cached)
 *   3. agentDefaultModel.currentSelection() — the app's selected model
 */

export const name = 'promptimizer'
export const inject = ['webServer', 'llm', 'agentDefaultModel']

const ROUTE = '/api/promptimizer/optimize'
const MAX_TEXT = 16000
const MAX_CONCURRENT = 2

/** Prompt engineering system prompts, one per strength level (1/2/3). */
function systemFor(level) {
  const base = '[DSH-PROMPTIMIZER] level=' + level + ' '
  if (level === 1) return base + 'You lightly improve the user prompt: keep their wording, only clarify ambiguity and make the deliverable explicit. Reply with the improved prompt ONLY, in the user language, no commentary.'
  if (level === 2) return base + 'You restructure the user prompt into 任務/要求/驗收 (task/requirements/acceptance) sections, enrich constraints with proven engineering practices. Reply with the improved prompt ONLY, in the user language.'
  return base + 'You deeply engineer the user prompt into a professional spec: role, task, deliverables, constraints, edge cases, acceptance criteria. Reply with the improved prompt ONLY, in the user language.'
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = []
    req.on('data', (c) => parts.push(c))
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export function apply(ctx) {
  /** displayName(lower) -> {provider, model}; built lazily, cached. */
  let indexPromise = null
  function modelIndex() {
    if (!indexPromise) {
      indexPromise = (async () => {
        const map = new Map()
        const providers = await ctx.llm.listProviders()
        for (const p of providers) {
          const pid = String(typeof p === 'string' ? p : (p.id ?? p.provider ?? ''))
          if (!pid) continue
          let models = []
          try { models = await ctx.llm.listModels(pid) } catch (e) { continue }
          for (const m of models) {
            const mid = String(typeof m === 'string' ? m : (m.id ?? m.model ?? ''))
            if (mid) map.set(mid.toLowerCase(), { provider: pid, model: mid })
          }
        }
        return map
      })()
      indexPromise.catch(() => { indexPromise = null })
    }
    return indexPromise
  }

  /** Resolve {provider, model} for one optimize request. */
  async function resolveTarget(displayName) {
    const wanted = String(displayName || '').trim().toLowerCase()
    if (wanted) {
      const split = wanted.split(/[:/]/)
      if (split.length === 2 && split[0] && split[1]) {
        return { provider: split[0], model: split[1] }
      }
      const map = await modelIndex()
      const hit = map.get(wanted)
      if (hit) return hit
    }
    try {
      const sel = ctx.agentDefaultModel.currentSelection()
      const provider = String(sel?.provider ?? sel?.providerId ?? '')
      const model = String(sel?.model ?? sel?.modelId ?? '')
      if (provider && model) return { provider, model }
    } catch (e) { /* no default-model service */ }
    throw new Error('no usable model: selector name not recognized and no default model configured')
  }

  let active = 0
  const queue = []
  function acquire() {
    if (active < MAX_CONCURRENT) { active += 1; return Promise.resolve(true) }
    return new Promise((resolve) => { queue.push(() => { active += 1; resolve(true) }) })
  }
  function leave() {
    active -= 1
    const next = queue.shift()
    if (next !== undefined) next()
  }

  const disposeRoute = ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return }
        const raw = await readBody(req)
        let args = {}
        try { args = JSON.parse(raw || '{}') } catch (e) { sendJson(res, 400, { error: 'invalid JSON' }); return }
        const text = typeof args.text === 'string' ? args.text.slice(0, MAX_TEXT) : ''
        if (!text.trim()) { sendJson(res, 400, { error: 'prompt is empty' }); return }
        const strength = [1, 2, 3].includes(args.strength) ? args.strength : 2
        await acquire()
        let out = ''
        let used = ''
        let finished = false
        try {
          const target = await resolveTarget(args.model)
          used = target.provider + '/' + target.model
          for await (const chunk of ctx.llm.stream({
            provider: target.provider,
            model: target.model,
            system: systemFor(strength),
            messages: [{
              id: 'pmz-1', role: 'user',
              content: [{ type: 'text', text }],
              source: { kind: 'user' },
            }],
            maxTokens: 4000,
            temperature: 0.3,
          })) {
            if (chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
            if (chunk.type === 'finish') finished = true
          }
        } finally {
          leave()
        }
        if (!out.trim()) { sendJson(res, 502, { error: 'model stream produced no output' }); return }
        sendJson(res, 200, { text: out.trim(), model: used, complete: finished })
      } catch (e) {
        const msg = String(e && e.message ? e.message : e)
        if (/MISSING_CREDENTIAL|no API key|API key|credential/i.test(msg)) {
          sendJson(res, 200, { error: 'missing API key — add it in Settings → Models for the selected provider' })
          return
        }
        sendJson(res, 200, { error: msg })
      }
    },
  })

  return () => {
    try { disposeRoute?.() } catch (e) { /* noop */ }
  }
}
