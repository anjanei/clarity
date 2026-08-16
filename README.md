# fdaapproval

Select a clinical trial, then evaluate its therapeutic under the lens of an FDA approver.

Evidence retrieval runs on **Paperclip** (trial registries, FDA/EMA/PMDA review documents, primary
literature, ChEMBL/UniProt). Rubric scoring and the calibrated probability estimate run on the
**Claude API**.

```
Paperclip search  ──►  Claude extraction  ──►  data/trials.json   (one-time, re-runnable)
                                                      │
                                              user picks a trial
                                                      │
Paperclip evidence sweep ──► Claude FDA-reviewer scoring ──► review report
```

## Requirements

- Node 20+
- A Paperclip API key — <https://paperclip.gxl.ai/keys>
- An Anthropic API key — <https://platform.claude.com>

## Setup

```bash
npm install
cp .env.example .env      # then fill in both keys
npm run build:css
```

### Local test environment

The test suite has no paid-service dependency and does not require API keys. It creates an
isolated temporary catalog through `DATA_DIR`, then checks the frontend entry point and core API
responses on an ephemeral local port.

```bash
npm ci
npm run build:css
npm test
```

For day-to-day development, leave API keys blank to test the catalog browsing UI and API routes;
only catalog generation and FDA-review runs require both keys. To run those flows, copy
`.env.example` to `.env`, replace the placeholder values, optionally run `npm run catalog`, then
start the app with `npm run dev` and visit <http://localhost:3000>.

### 1. Confirm Paperclip connectivity

Paperclip's programmatic surface is an MCP server (`https://paperclip.gxl.ai/mcp`, `X-API-Key`
header) that exposes **exactly one tool** — `paperclip` — whose only argument is a CLI command
string. There are no per-capability tools and no documented REST endpoints:

```
search -s fda "pembrolizumab" -n 20
search -n 40 "breast cancer HER2" /trials/us
map --from s_1907a2d0 "What were the primary endpoints?"
```

`src/paperclip/tools.js` is the single place those command strings are built. Two rules the server
enforces, both easy to get wrong:

- **`-s` is mandatory on every search** unless you pass a virtual directory path as the scope
  instead. Valid sources: `papers`, `pmc`, `biorxiv`, `medrxiv`, `arxiv`, `abstracts`, `fda`,
  `trials`, `proteins`, `clipboard`. Comma-joined sources (`-s pmc,biorxiv`) query both.
- **Region scoping is a path, not a source.** `-s trials` searches all registries;
  `search "…" /trials/us` scopes to ClinicalTrials.gov. `trials/us` as a `-s` value is invalid.

```bash
npm run probe                                          # handshake + tool list
npm run probe -- --skill                               # the server's own documentation
npm run probe -- --search "phase 3 NSCLC" --path /trials/us --limit 10
npm run probe -- --raw 'search -s fda "semaglutide" -n 5'
```

`--skill` is worth running first: it dumps Paperclip's authoritative command reference to
`data/probe/skill.md`. `--raw` runs any command verbatim, which is the fastest way to check a flag
before wiring it in.

### 2. Build the trial catalog (once)

```bash
npm run catalog                        # merge into any existing catalog
npm run catalog -- --limit 60          # more results per search
npm run catalog -- --replace           # discard and rebuild from scratch
npm run catalog -- --no-enrich         # skip the registry enrichment pass
```

This sweeps `/trials/us`, `/trials/intl` and `-s fda` across eight therapeutic areas, has Claude
normalise the registry text into `clinicalTrialObject` records under a strict JSON schema, then
fills the three fields Paperclip does not carry (see below):

```json
{
  "trialId": "NCT05123456",
  "therapeuticName": "...",
  "sponsor": "...",
  "phase": "Phase 2",
  "startDate": "2023-04-01",
  "registry": "ClinicalTrials.gov",
  "condition": "...",
  "modality": "Monoclonal antibody",
  "title": "...",
  "therapeuticArea": "Oncology"
}
```

Records are deduped by `trialId`, and anything without a readable registry identifier is rejected
rather than guessed. Output: `data/trials.json`.

#### Why there is a registry enrichment step

Paperclip indexes the **narrative** of a clinical trial — eligibility criteria, brief summary, arm
and outcome descriptions — but not the structured registry header. Its `documents` SQL table covers
papers only (`pmc`, `biorxiv`, `medrxiv`), and a trial's `meta.json` carries just ingest metadata.
**Sponsor, phase and start date are therefore absent from the corpus**, and the extraction step
correctly reports them as `Unknown` rather than inferring them from snippet text.

Since those are required fields, `src/catalog/enrich.js` fills them deterministically from the
public ClinicalTrials.gov v2 API (read-only GET, no key, batched 50 ids per request). Registry
values win over extracted ones — they are the authoritative header. The pass also drops studies the
registry marks non-interventional, and swaps a prose `therapeuticName` for the registry's product
code when there is exactly one investigational product (the original is kept as
`therapeuticDescription`).

Coverage is NCT-only. ChiCTR, jRCT/UMIN, ISRCTN, PACTR and similar registries have no equivalent
free batch API; those records keep whatever extraction found and are flagged
`registryEnriched: false`. On a representative run: 285 trials, 202 of 211 NCT records matched,
9 observational dropped, **71% with all five required fields populated** — the shortfall being
almost entirely non-NCT registries.

Pass `--no-enrich` for a Paperclip-only catalog.

### 3. Run the app

```bash
npm run dev      # Tailwind watch + node --watch
# or
npm start
```

Open <http://localhost:3000>. Pick a trial, press **Run FDA review**. Progress streams over SSE
while retrieval runs; a completed review is cached to `data/evaluations/<trialId>.json` and shown
instantly on re-select (use **Re-run review** to force a fresh pass).

## The rubric

Six weighted dimensions, each scored 1–5 against explicit anchors (`src/evaluate/rubric.js`):

| Dimension | Weight |
| --- | --- |
| Efficacy & clinical evidence | 26% |
| Safety & tolerability | 22% |
| Immunogenicity | 14% |
| Manufacturability & CMC | 14% |
| PK/PD & dosing | 13% |
| Trial design & regulatory strategy | 11% |

Each dimension returns a score, an evidence-strength rating, a reviewer assessment, supporting
findings with sources, severity-tagged concerns, and information gaps. The report also carries the
overall probability of completing clinical trials with a plausible range and stated calibration
basis, a confidence level, key drivers, red flags, de-risking actions, regulatory precedents, and
expedited-pathway eligibility.

Two guardrails are enforced in code rather than left to the prompt: a dimension whose evidence
strength is `absent` cannot score above 3, and the probability point estimate is clamped inside its
own stated range.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Key presence, model, catalog age, resolved Paperclip capabilities |
| `GET /api/trials?q=&phase=&area=&sponsor=&registry=` | Filtered catalog plus facet values |
| `GET /api/trials/:trialId` | One trial |
| `GET /api/rubric` | Dimension labels, weights, anchors |
| `GET /api/evaluations/:trialId` | Cached review, 404 if none |
| `POST /api/evaluations/:trialId?force=1` | Run a review (blocking, minutes) |
| `GET /api/evaluations/:trialId/stream` | Run with `progress` → `result` SSE events |

Concurrent requests for the same trial share one run, so a double-click does not pay twice.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `PAPERCLIP_API_KEY` | — | Required |
| `PAPERCLIP_MCP_URL` | `https://paperclip.gxl.ai/mcp` | |
| `ANTHROPIC_API_KEY` | — | Required |
| `ANTHROPIC_MODEL` | `claude-opus-5` | |
| `EVAL_EFFORT` | `high` | Review pass: `low`–`max` |
| `EXTRACT_EFFORT` | `low` | Catalog extraction is mechanical |
| `PORT` | `3000` | |

## Implementation notes

- **Structured output, not parsing.** Both Claude calls use `output_config.format` with a JSON
  schema, so responses validate at the API layer — there is no parse-and-retry loop.
- **Prompt caching.** The reviewer persona and rubric are byte-stable and sit behind an
  `ephemeral` cache breakpoint; only the evidence bundle is billed at full rate per trial. Cache
  read/write token counts are shown in each report's provenance panel.
- **Streaming.** Reviews stream with a high `max_tokens`, which avoids the HTTP timeout a
  non-streaming request of this size would risk.
- **Refusal handling.** Server-side fallbacks are enabled by default so a safety-classifier decline
  is re-served rather than failing the request; if the fallback beta is rejected, the call
  transparently retries without it.
- **One Paperclip tool, many commands.** All retrieval goes through the single `paperclip` MCP tool
  as CLI command strings built in `src/paperclip/tools.js`. Arguments are quoted for the
  server-side parser and queries are collapsed to one line, since a newline breaks command parsing.
- **Data-source honesty.** Where Paperclip cannot supply a required field, the pipeline says so and
  fills it from the authoritative registry instead of letting the model guess — see the enrichment
  note above.

## Layout

```
src/
  server.js               Express app + static hosting
  config.js               env + paths
  anthropic.js            structured-JSON call helper (caching, streaming, refusals)
  paperclip/
    client.js             MCP Streamable-HTTP JSON-RPC client
    tools.js              CLI command builder (search / map / reduce / sql / cat / skill)
    queries.js            catalog sweep + per-trial evidence sweep
  catalog/
    build.js              `npm run catalog`
    enrich.js             ClinicalTrials.gov v2 backfill for sponsor / phase / start date
    store.js              read/filter/facet data/trials.json
  evaluate/
    rubric.js             dimensions, weights, anchors
    schema.js             JSON schemas for both Claude calls
    evaluate.js           reviewer prompt + normalisation
    store.js              on-disk cache + in-flight dedupe
  routes/                 /api/trials, /api/evaluations
  scripts/probe.js        `npm run probe`
public/                   index.html, app.js, app.css (Tailwind source)
data/                     generated catalog, cached reviews, probe dumps
```

Generated assessments are decision support, not regulatory advice.
