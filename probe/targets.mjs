// Probe matrix for status.xyloconnect.com.
// Each public component maps to one or more probes; the component's state is
// the worst probe state. A probe with `everyMin` runs at a slower cadence than
// the 5-minute cron (the NocoDB check performs a real admin sign-in).
//
// The monitoring endpoint is called on the QA stage on purpose: its connect
// functions hardcode PROD infrastructure, and the PROD stage alias is broken
// (BUG-E41556). Switch MONITOR_STAGE to PROD once that bug is resolved.

export const MONITOR_STAGE = 'QA'
export const MONITOR_BASE = `https://uu8janobz6.execute-api.us-east-1.amazonaws.com/${MONITOR_STAGE}/monitoring/load`

// kind: 'http'    expect an HTTP answer; `expect` narrows which codes are healthy
//       'monitor' /monitoring/load JSON: healthy = 200 + ok !== false + timeout !== true
// slowMs: answered but slower than this = degraded
// timeoutMs: no answer within this = failed attempt (retried once before counting)
export const components = [
  {
    id: 'app',
    name: 'Web app',
    desc: 'xyloconnect.com',
    probes: [
      { id: 'app', kind: 'http', url: 'https://xyloconnect.com/', expect: '2xx', slowMs: 4000, timeoutMs: 10000 },
    ],
  },
  {
    id: 'api',
    name: 'API',
    desc: 'core requests + auth',
    probes: [
      { id: 'api-mon', kind: 'monitor', url: `${MONITOR_BASE}?interface=lambda`, slowMs: 6000, timeoutMs: 15000 },
      // Any HTTP answer (403 included) proves the main gateway edge is alive.
      { id: 'api-gw', kind: 'http', url: 'https://uksnvgu9yk.execute-api.us-east-1.amazonaws.com/PROD/status-probe', expect: 'any', slowMs: 4000, timeoutMs: 10000 },
    ],
  },
  {
    id: 'db',
    name: 'Database',
    desc: 'primary data store',
    probes: [
      // innerSlowS: the Lambda-reported processing_time; the DB check itself
      // normally completes in ~0.2s, so 3s of inner time means real trouble.
      { id: 'db-mon', kind: 'monitor', url: `${MONITOR_BASE}?interface=rds`, innerSlowS: 3, slowMs: 8000, timeoutMs: 25000 },
    ],
  },
  {
    id: 'tables',
    name: 'Tables',
    desc: 'grid views + records',
    probes: [
      { id: 'tables-http', kind: 'http', url: 'https://tables-api.xyloconnect.com/', expect: '2xx3xx', slowMs: 4000, timeoutMs: 10000 },
      { id: 'tables-ec2', kind: 'monitor', url: `${MONITOR_BASE}?interface=ec2`, innerSlowS: 3, slowMs: 8000, timeoutMs: 25000 },
      { id: 'tables-noco', kind: 'monitor', url: `${MONITOR_BASE}?interface=nocodb`, innerSlowS: 5, slowMs: 10000, timeoutMs: 25000, everyMin: 30 },
    ],
  },
  {
    id: 'docs',
    name: 'Documents',
    desc: 'docs workspace',
    probes: [
      { id: 'docs', kind: 'http', url: 'https://xylodocs.xyloconnect.com/', expect: '2xx', slowMs: 5000, timeoutMs: 12000 },
    ],
  },
  {
    id: 'support',
    name: 'Support',
    desc: 'help desk + ticketing',
    probes: [
      { id: 'support', kind: 'http', url: 'https://bugs.xyloconnect.com/', expect: '2xx3xx', slowMs: 5000, timeoutMs: 12000 },
    ],
  },
  {
    id: 'media',
    name: 'Media & assets',
    desc: 'images, files, map layers',
    probes: [
      { id: 'media', kind: 'http', method: 'HEAD', url: 'https://media.xyloconnect.com/frontend/assets/layers/counties_minified.json', expect: '2xx', slowMs: 5000, timeoutMs: 12000 },
    ],
  },
]
