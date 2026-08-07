// Runs the probe matrix and folds results into history.json.
// Usage: node probe/probe.mjs <path-to-history.json>
// Zero dependencies; Node 20+.
//
// History shape:
// {
//   updatedAt: ISO string,
//   components: {
//     [id]: {
//       state: 'operational' | 'degraded' | 'down' | 'unknown',
//       lastMs: number,            // latency of the slowest healthy probe this run
//       lastRun: { [probeId]: epochSec },
//       lastResult: { [probeId]: 'o' | 'd' | 'x' },
//       samples: [[epochSec, 'o'|'d'|'x', ms], ...],   // last 24h of runs
//       daily: { 'YYYY-MM-DD': { o, d, x, ms } },      // 92-day rollup, ms = avg
//     }
//   }
// }

import { readFileSync, writeFileSync } from 'node:fs'
import { components } from './targets.mjs'

const HISTORY_PATH = process.argv[2]
if (!HISTORY_PATH) {
  console.error('usage: node probe/probe.mjs <history.json>')
  process.exit(1)
}

const DAY_KEEP = 92
const SAMPLE_KEEP_SEC = 24 * 3600

function classifyHttp(status, expect) {
  if (expect === 'any') return true
  if (expect === '2xx') return status >= 200 && status < 300
  if (expect === '2xx3xx') return status >= 200 && status < 400
  return status === expect
}

async function attempt(probe) {
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), probe.timeoutMs)
  try {
    const res = await fetch(probe.url, {
      method: probe.method ?? 'GET',
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { 'user-agent': 'xyloconnect-status-probe/1' },
    })
    const ms = Date.now() - started
    if (probe.kind === 'monitor') {
      if (res.status !== 200) return { state: 'x', ms, note: `http ${res.status}` }
      let body = null
      try { body = await res.json() } catch { /* non-JSON 200 still proves liveness */ }
      if (body?.timeout === true) return { state: 'd', ms, note: 'inner timeout' }
      // Expanded payload (api PR): ok:false means the inner check actually failed.
      if (body?.ok === false) return { state: 'x', ms, note: body?.error ?? 'check failed' }
      if (probe.innerSlowS && typeof body?.processing_time === 'number' && body.processing_time > probe.innerSlowS) {
        return { state: 'd', ms, note: `inner ${body.processing_time.toFixed(1)}s` }
      }
      return { state: ms > probe.slowMs ? 'd' : 'o', ms }
    }
    if (!classifyHttp(res.status, probe.expect)) return { state: 'x', ms, note: `http ${res.status}` }
    return { state: ms > probe.slowMs ? 'd' : 'o', ms }
  } catch (err) {
    return { state: 'x', ms: Date.now() - started, note: err?.cause?.code ?? err?.name ?? 'fetch failed' }
  } finally {
    clearTimeout(timer)
  }
}

async function runProbe(probe) {
  const first = await attempt(probe)
  if (first.state !== 'x') return first
  // One retry before believing a failure; CI runners hiccup.
  await new Promise((r) => setTimeout(r, 2000))
  const second = await attempt(probe)
  return second.state === 'x' ? { ...second, note: `${second.note} (x2)` } : second
}

function worst(states) {
  if (states.includes('x')) return 'x'
  if (states.includes('d')) return 'd'
  return 'o'
}

const STATE_NAME = { o: 'operational', d: 'degraded', x: 'down' }

let history
try {
  history = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'))
} catch {
  history = { components: {} }
}
history.components ??= {}

const nowSec = Math.floor(Date.now() / 1000)
const today = new Date().toISOString().slice(0, 10)

for (const comp of components) {
  const entry = (history.components[comp.id] ??= {})
  entry.lastRun ??= {}
  entry.lastResult ??= {}
  entry.samples ??= []
  entry.daily ??= {}

  const states = []
  let slowestHealthyMs = 0
  const notes = []

  for (const probe of comp.probes) {
    if (probe.everyMin && entry.lastRun[probe.id] && nowSec - entry.lastRun[probe.id] < (probe.everyMin - 2) * 60) {
      // Not due yet; carry the previous result forward.
      states.push(entry.lastResult[probe.id] ?? 'o')
      continue
    }
    const result = await runProbe(probe)
    entry.lastRun[probe.id] = nowSec
    entry.lastResult[probe.id] = result.state
    states.push(result.state)
    if (result.state !== 'x') slowestHealthyMs = Math.max(slowestHealthyMs, result.ms)
    if (result.note) notes.push(`${probe.id}: ${result.note}`)
    console.log(`${comp.id}/${probe.id} ${STATE_NAME[result.state]} ${result.ms}ms${result.note ? ` (${result.note})` : ''}`)
  }

  let runState = worst(states)
  // A failure only reads as "down" when the previous run failed too; a single
  // bad run (runner hiccup, cold start pile-up) reads as degraded.
  const prevSample = entry.samples[entry.samples.length - 1]
  if (runState === 'x' && prevSample?.[1] !== 'x') runState = 'd'

  entry.state = STATE_NAME[runState]
  entry.lastMs = slowestHealthyMs
  if (notes.length) entry.lastNote = notes.join('; ')
  else delete entry.lastNote

  entry.samples.push([nowSec, runState, slowestHealthyMs])
  entry.samples = entry.samples.filter(([t]) => nowSec - t <= SAMPLE_KEEP_SEC)

  const day = (entry.daily[today] ??= { o: 0, d: 0, x: 0, ms: 0 })
  const runsToday = day.o + day.d + day.x
  day.ms = Math.round((day.ms * runsToday + slowestHealthyMs) / (runsToday + 1))
  day[runState] += 1

  const days = Object.keys(entry.daily).sort()
  for (const key of days.slice(0, Math.max(0, days.length - DAY_KEEP))) delete entry.daily[key]
}

history.updatedAt = new Date().toISOString()
writeFileSync(HISTORY_PATH, JSON.stringify(history))
console.log(`history written to ${HISTORY_PATH}`)
