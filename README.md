# XyloConnect Status

Public status page for XyloConnect, served by GitHub Pages at
[status.xyloconnect.com](https://status.xyloconnect.com).

## How it works

- `.github/workflows/probe.yml` runs every 5 minutes and executes
  `probe/probe.mjs` against the probe matrix in `probe/targets.mjs`.
- Results fold into `history.json` on the `data` branch: raw samples for
  24 hours, daily rollups for 92 days. The page fetches it from
  raw.githubusercontent.com.
- `index.html` is the whole site (no build step). It renders the banner,
  90-day uptime bars, and incidents, and re-checks the CORS-open
  monitoring probes live from the visitor's browser.
- Status updates and past incidents come from XyloDesk:
  `GET https://bugs.xyloconnect.com/api/v1/status-updates`. Team members
  post updates from the Status tab in XyloDesk; an update linked to a bug
  resolves automatically when the bug is resolved.

## Status model

- **Operational**: expected answer within the latency budget.
- **Degraded**: answered but slow, inner check timed out, or a single
  failed run (one bad run never reads as down).
- **Down**: failure on two consecutive runs.

The banner shows the worst of component states and active update
severities.

## Notes

- The monitoring endpoint is called on its QA stage on purpose: its
  connect functions probe PROD infrastructure regardless of stage, and
  the PROD stage alias is currently broken (BUG-E41556). Flip
  `MONITOR_STAGE` in `probe/targets.mjs` when that bug is resolved.
- The NocoDB sign-in probe runs every 30 minutes, not every 5, because it
  performs a real admin sign-in.
