# CLARITY

**An FDA reviewer that shows its work.**

CLARITY takes one clinical programme, retrieves the public evidence that exists for it, organises
that evidence into a cited nine-domain regulatory dossier, and scores it against a weighted rubric
the way a reviewer would. Then it does the thing that makes it usable: every number on the report
opens into the chain that produced it — the claim, the paper it came from, the extraction that
pulled it out with its own stated confidence, the exact retrieval command that found the paper, and
the run that scored it.

Nothing on the report comes from the model's recall. If the evidence does not exist, the report says
the evidence does not exist, and the score goes down.

**Live:** <https://fdaapproval.vercel.app>

---

## The problem

A cell or gene therapy programme reaching first-in-human today is competing for attention with about
a thousand others. The people who have to form a view on it — a partner, an investor, a licensing
team, a reviewer preparing for a pre-IND meeting — are all doing the same job by hand:

Read the registry record. Find the Phase 1 publication, if there is one. Find the FDA review package
for the closest approved product in the class. Work out whether the long-term follow-up protocol
exists. Notice that nobody has published per-cohort dosing data. Form a probability. Write it down.
Justify it to someone who will ask *"where did that come from?"*

It takes a specialist several days and the answer is not reproducible. Two analysts reading the same
literature reach different numbers, and neither can hand over the trail that got them there.

The tempting fix is to ask a language model. That fails in a specific and dangerous way: the model
knows a great deal about pembrolizumab and almost nothing about the Phase 1/2 allogeneic CAR-T that
posted its first registry record eleven weeks ago — and it will answer both questions in the same
confident register. A regulatory opinion you cannot audit is worse than no opinion, because it looks
like one.

## The insight

The failure above is not a reasoning failure. It is a **provenance** failure.

So CLARITY separates the two jobs completely, and never lets them mix:

1. **Retrieval finds evidence.** Paperclip runs source-scoped searches across trial registries, FDA
   review documents and the primary literature. Whatever it returns is the entire universe of facts
   available to everything downstream.
2. **Extraction organises it, with citations.** One Claude pass per CLARITY domain reads only that
   domain's evidence packet and returns findings that each carry a direct public identifier — an NCT
   number, a PMC id, a DOI, an NDA/BLA number. An element it cannot source returns the literal string
   `Not found in public sources`, with an empty citation array and a confidence of 10.
3. **Scoring reads only the dossier.** The reviewer pass sees the trial record and the cited dossier.
   It does not see the internet and it cannot reach for what it half-remembers.

Each stage consumes only what the stage before it retrieved, and hands forward the citations it used.
That constraint is the product. It is why a CLARITY score can be argued with.

```
Paperclip search  ──►  Claude extraction  ──►  data/trials.json         (one-time, re-runnable)
                                                      │
                                              pick a programme
                                                      │
Paperclip domain sweep ──► CLARITY cited dossier ──► Claude reviewer pass ──► scored report
        (13–34 searches)        (9 domains, cited)      (10 weighted dimensions)
                                                                                │
                                                            every claim ──► proof chain
```

---

## What it actually produces

Two real reviews from the cached set, chosen because they disagree in an instructive way.

**NTLA-2001** — *in vivo* CRISPR knockout of hepatic *TTR* for transthyretin amyloidosis, Phase 1
(`NCT04601051`).

> **58%** probability of trial success, range 40–72, confidence **moderate**.
> Registry coverage of the Phase 1, the Phase 3 successors and the long-term follow-up protocol is
> good, and the ATTR regulatory precedent set — patisiran, tafamidis, inotersen, eplontersen,
> acoramidis — is unusually rich. No primary Phase 1 dataset with per-cohort TTR reductions was
> retrievable, so efficacy is scored on what exists, not on what is presumed.

**CTX112** — allogeneic CD19 CAR-T, Phase 1/2 (`NCT07549698`).

> **28%** probability, range 15–42, confidence **low**.
> Nine CLARITY domains, 29 cited sources, 31 retrieval commands, 207,641 tokens of context — and the
> score is low principally because the primary clinical evidence for *this construct* is not public
> yet. The report says that in the evidence-strength column of every affected domain rather than
> filling the gap with class-level inference.

The second review is the important one. A system that returns 28% *and shows you that six of ten
dimensions are marked `absent` evidence* has told you something true and useful. A system that
returns a confident 65% by quietly borrowing Kymriah's safety profile has told you nothing, twice.

Two guardrails enforce this in code rather than in the prompt:

- a dimension whose evidence strength is `absent` **cannot score above 3**, no matter what the model
  returns;
- the probability point estimate is **clamped inside the reviewer's own stated range**.

---

## The lab

The interface is not a report viewer with a chart on top. It is one workstation, and the graph in the
middle of it is the run.

**The stage** renders the pipeline as a live three-dimensional graph — every node a real object from
the run, drawn with a projection, force simulation and depth-sorted compositor written from scratch
in about six hundred lines of vanilla JavaScript on a 2D canvas. No WebGL library, no CDN, no
third-party code in the browser at all. Drag to orbit, scroll to zoom.

- Nodes **light in the order the server actually works**. A stage that never fires never lights.
- The graph **grows during a run**: each retrieval event attaches the document it found, so the
  picture is visibly larger at the end than at the start.
- Any node with structure underneath it **opens into its own graph** — a paper into the findings it
  supports and the domains those landed in; a finding into its provenance chain; the review into the
  weighted rubric as a body with mass, where node size is rubric weight and colour is the score.
  A breadcrumb trail leads back up.
- **Three couriers** move across the surface, bound to the three real actors: Clip carries a document
  from retrieval to the domain that requested it, once per real search; Cortex carries a scored
  domain into the dossier; Helix fetches the construct. They also walk over and pull a disclosure
  open when you click one. They are off under `prefers-reduced-motion` and there is a toggle in the
  rail, because a moving figure near text is the wrong thing for some readers.

**The construct panel** draws the vector in space — a rotating double helix with the feature
architecture mapped onto its turns, or a single chain for a protein, because a protein is not a
double helix. Bases are only ever drawn from a sequence the server actually returned; a derived
model shows architecture and says so in the panel. The flat, measurable feature map sits directly
underneath it.

**The arithmetic is shown, not asserted.** The weighted score renders as its formula with the real
terms substituted; evidence completeness renders as its formula; the reviewer's probability
calibration is parsed back out of its own prose into a bridge chart, where a sentence without a
signed number does not become a bar. When the stored weighted score disagrees with a recomputation
under the currently served rubric, the panel says which number came from which rubric version rather
than showing whichever is convenient.

**Benchmarks** place the programme against every review this rubric has produced — and when that
number is six, the panel says *"read the position, not the distribution"* instead of drawing a
histogram out of six points.

---

## The rubric

Ten weighted dimensions, each scored 1–5 against explicit anchors (`src/evaluate/rubric.js`,
v2.0.0). Weights sum to 1.0, and the module refuses to load if they do not.

| Dimension | Weight |
| --- | --- |
| Efficacy & Clinical Evidence | 22% |
| Safety & Tolerability | 20% |
| Long-Term Genetic Risk | 10% |
| Biodistribution & Pharmacology | 10% |
| Manufacturability & CMC | 10% |
| PK/PD & Dosing | 8% |
| Trial Design & Regulatory Strategy | 7% |
| Disease Context & Mechanism | 5% |
| Immunogenicity | 5% |
| Trial Integrity, Governance & Operational Infrastructure | 3% |

The weighting is deliberately shaped for genomic medicines: long-term genetic risk and
biodistribution carry as much weight as CMC, because for an integrating vector or an *in vivo*
editor they are the review. Every dimension returns a score, an evidence-strength rating, a reviewer
assessment, supporting findings with sources, severity-tagged concerns, and information gaps. The
report also carries the probability of completing clinical trials with a range and a stated
calibration basis, a confidence level, key drivers, red flags, de-risking actions, regulatory
precedents, and expedited-pathway eligibility.

## The CLARITY domains

Nine evidence domains under `evidence_skills/CLARITY_FDA_Review_Skills/`, gated by development
phase — a preclinical asset is not asked for postmarketing controls it cannot have.

| Domain | Active from | Searches |
| --- | --- | --- |
| Disease Context & Mechanism | preclinical | 3 |
| Acute Safety & Tolerability | preclinical | 3 |
| Product Quality & CMC | preclinical | 2 |
| Trial Design | phase 1 | 3 |
| Biodistribution & Pharmacology | phase 1 | 2 |
| Immunogenicity & Special Populations | phase 1 | 3 |
| Trial Integrity, Governance & Operational Infrastructure | phase 1 | 3 |
| Long-Term Genetic Risk | phase 2 | 2 |
| Benefit–Risk & Postmarketing Controls | phase 3 | 3 |

These skill files are runtime policy, not documentation. They must be present when the application
is deployed.

## The catalog

118 programmes, swept from `/trials/us`, `/trials/intl` and `-s fda` across eight therapeutic areas,
then normalised by Claude into strict-schema records.

| | |
| --- | --- |
| Modality | 77 cell therapy · 40 gene therapy |
| Phase | 42 Phase 1 · 37 Phase 1/2 · 16 Early Phase 1 · 8 Phase 3 · 2 Phase 2 · 2 Phase 2/3 |
| Area | Oncology 40 · Hematology 34 · Rare & Genetic Disease 17 · Cardiometabolic 9 · Ophthalmology 8 · Infectious Disease & Vaccines 5 · Immunology & Inflammation 4 · Nephrology 1 |

### Why there is a registry enrichment step

Paperclip indexes the **narrative** of a trial — eligibility criteria, brief summary, arm and outcome
descriptions — but not the structured registry header. Its `documents` table covers papers only, and
a trial's `meta.json` carries ingest metadata. **Sponsor, phase and start date are therefore absent
from the corpus**, and the extraction step correctly reports them as `Unknown` rather than inferring
them from snippet text.

Since those are required fields, `src/catalog/enrich.js` fills them deterministically from the public
ClinicalTrials.gov v2 API (read-only GET, no key, batched 50 ids per request). Registry values win
over extracted ones — they are the authoritative header. The pass also drops studies the registry
marks non-interventional, and swaps a prose `therapeuticName` for the registry's product code when
there is exactly one investigational product.

Coverage is NCT-only. ChiCTR, jRCT/UMIN, ISRCTN and PACTR have no equivalent free batch API; those
records keep whatever extraction found and are flagged `registryEnriched: false`. On a representative
run: 285 trials, 202 of 211 NCT records matched, 9 observational dropped, 71% with all five required
fields populated — the shortfall almost entirely non-NCT registries.

This is the pattern the whole system follows. Where a source cannot supply a field, say so and go to
the authoritative source, rather than letting a model guess and calling the guess data.

---

## What this does not do

Stating the boundary is part of the claim.

- **It is not a regulatory decision.** It is decision support. FDA review is a human, deliberative
  process with access to the confidential IND that CLARITY by construction cannot see.
- **It only knows what is public.** The dominant reason a Phase 1/2 asset scores low is that its own
  clinical data has not been published. That is a statement about the evidence, not about the science.
- **It does not match patients to trials.** The catalog carries no site or eligibility geography, so
  there is no pre-screening widget and no site map. Building one on data this repo does not have
  would be the exact failure mode the rest of the system exists to avoid.
- **Small n on benchmarks.** Six reviews is a position, not a distribution, and the UI says so.
- **The reviewer is a model.** The rubric, the weights, the phase gates and the two guardrails are
  code. The judgement inside a domain is Claude's, and the proof chain exists so you can overrule it.

---

## Quickstart

Node 20+, a [Paperclip key](https://paperclip.gxl.ai/keys), an
[Anthropic key](https://platform.claude.com).

```bash
npm install
cp .env.example .env      # fill in both keys
npm run dev               # Tailwind watch + node --watch
```

Open <http://localhost:3000>, pick a programme, press **Run FDA review**. Progress streams over SSE
while retrieval runs; a completed review caches to `data/evaluations/<trialId>.json` and loads
instantly on re-select.

The test suite needs no keys and no network — it builds an isolated catalog in a temp directory,
drives the API on an ephemeral port, and runs the canvas render path against a recording 2D context:

```bash
npm test
```

Leave the keys blank to explore the catalog, the lab surface and every cached review; only catalog
generation and fresh review runs need them.

### Confirm Paperclip connectivity first

Paperclip's programmatic surface is an MCP server (`https://paperclip.gxl.ai/mcp`, `X-API-Key`
header) exposing **exactly one tool** — `paperclip` — whose only argument is a CLI command string.
`src/paperclip/tools.js` is the single place those strings are built. Two rules the server enforces,
both easy to get wrong:

- **`-s` is mandatory on every search** unless a virtual directory path is passed as the scope
  instead. Valid sources: `papers`, `pmc`, `biorxiv`, `medrxiv`, `arxiv`, `abstracts`, `fda`,
  `trials`, `proteins`, `clipboard`.
- **Region scoping is a path, not a source.** `-s trials` searches all registries;
  `search "…" /trials/us` scopes to ClinicalTrials.gov. `trials/us` as a `-s` value is invalid.

```bash
npm run probe                                          # handshake + tool list
npm run probe -- --skill                               # the server's own command reference
npm run probe -- --search "phase 3 NSCLC" --path /trials/us --limit 10
npm run probe -- --raw 'search -s fda "semaglutide" -n 5'
```

### Build the catalog

```bash
npm run catalog                        # merge into any existing catalog
npm run catalog -- --limit 60          # more results per search
npm run catalog -- --replace           # discard and rebuild
npm run catalog -- --no-enrich         # skip registry enrichment
```

Records are deduped by `trialId`; anything without a readable registry identifier is rejected rather
than guessed. Output: `data/trials.json`.

---

## Running it safely on a public URL

The two routes that start a review spend real tokens and take minutes, and they sit on a public URL
with no authentication. Reading a cached review, a trace or the catalog is always open; **starting**
a run is guarded three ways:

| Guard | Default | Variable |
| --- | --- | --- |
| Kill switch — serve cached reviews only | on | `PUBLIC_RUNS=off` |
| Run starts per address per window | 6 per 10 min | `RUN_LIMIT`, `RUN_WINDOW_MS` |
| Reviews running at once | 2 | `RUN_CONCURRENCY` |

The counters are in-memory, so on a serverless host the limit is per instance rather than global.
That is a weaker guarantee than a shared store, but it needs no external dependency and cannot fail
closed and lock you out of your own lab. A deployment that needs a hard ceiling should set
`PUBLIC_RUNS=off` and run reviews from the CLI.

Every response carries a content-security policy that forbids third-party script, framing and
plugins. The page loads no external code, no external fonts and no external images, so the policy is
`'self'` plus inline styles — nothing to relax.

---

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Key presence, model, catalog age, Paperclip capabilities, run policy |
| `GET /api/trials?q=&phase=&area=&sponsor=&registry=` | Filtered catalog plus facet values |
| `GET /api/trials/:trialId` | One trial |
| `GET /api/rubric` | Dimension labels, weights, anchors |
| `GET /api/pipeline?phase=` | CLARITY topology the lab graph is drawn from |
| `GET /api/benchmarks` | Distributions across every cached review |
| `GET /api/benchling/status` | Benchling credential presence and reachability, without exposing secrets |
| `GET /api/gene-model/:trialId` | Live Benchling construct when matched; otherwise a labelled derived schematic |
| `GET /api/evaluations/:trialId` | Cached review, 404 if none |
| `GET /api/evaluations/:trialId/traces` | Available trace summaries |
| `GET /api/evaluations/:trialId/traces/:traceId` | One persisted trace |
| `POST /api/evaluations/:trialId?force=1` | Run a review (blocking, minutes) · guarded |
| `GET /api/evaluations/:trialId/stream?trace=full` | Run with `progress` → `result` SSE events · guarded |

Concurrent requests for the same trial share one run, so a double-click does not pay twice.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `PAPERCLIP_API_KEY` | — | Required for retrieval |
| `PAPERCLIP_MCP_URL` | `https://paperclip.gxl.ai/mcp` | |
| `ANTHROPIC_API_KEY` | — | Required for extraction and scoring |
| `ANTHROPIC_MODEL` | `claude-opus-5` | `claude-haiku-4-5-20251001` for fast local iteration |
| `EVAL_EFFORT` | `high` | Review pass: `low`–`max` |
| `EXTRACT_EFFORT` | `low` | Catalog extraction is mechanical |
| `PAPERCLIP_CONCURRENCY` | `4` | Simultaneous independent Paperclip commands |
| `DOMAIN_CONCURRENCY` | `2` | Simultaneous CLARITY synthesis calls |
| `TRACE_MODE` | `off` | `off`, `metadata`, or `full` local trace retention |
| `PUBLIC_RUNS` | `on` | `off` serves cached reviews only |
| `RUN_LIMIT` / `RUN_WINDOW_MS` | `6` / `600000` | Run starts per address per window |
| `RUN_CONCURRENCY` | `2` | Concurrent reviews per instance |
| `BENCHLING_TENANT` | — | Tenant subdomain or origin; required for live Benchling calls |
| `BENCHLING_API_KEY` | — | Personal key, server-side only, HTTP Basic |
| `BENCHLING_CLIENT_ID` / `BENCHLING_CLIENT_SECRET` | — | Benchling App OAuth pair |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | `0.0.0.0` exposes the app on your network with no auth |

### Full learning traces

Tick **Full trace** in the dock before a fresh run, or send `trace=full` to either evaluation
endpoint. The trace saves to `data/traces/<trialId>/<traceId>.json` and is linked from the report's
provenance panel. It records the trial snapshot, progress timeline, every Paperclip command and
complete public response, the exact Claude system and user prompts, structured outputs, per-call
timing, token usage, the evidence bundle, the cited dossier and the final review. It contains no API
keys, but it retains public evidence and generated assessment — treat it as local review data, not a
source artifact to commit.

`TRACE_MODE=metadata` keeps timing and token diagnostics for every run without storing prompts or
source text. `TRACE_MODE=full` makes complete tracing the server default.

### Benchling structure panel

Benchling's APIs are tenant-scoped, so credentials alone are not enough: set `BENCHLING_TENANT` plus
either `BENCHLING_API_KEY` or the OAuth pair. When configured, the server searches DNA and
amino-acid sequences by therapeutic name and returns real sequence metadata. With no tenant or no
match, the UI renders an explicitly labelled schematic derived from registry modality and the target
symbols cited in the review evidence — it never invents a nucleotide or amino-acid sequence.

---

## Implementation notes

- **Structured output, not parsing.** Both Claude calls use `output_config.format` with a JSON
  schema, so responses validate at the API layer — no parse-and-retry loop.
- **Prompt caching.** The reviewer persona and rubric are byte-stable behind an `ephemeral` cache
  breakpoint; the shared CLARITY policy uses the same reusable prefix before each domain skill. Cache
  read and write token counts appear in every report.
- **Bounded parallelism.** Independent searches and domain synthesis calls run in stable order with
  conservative concurrency ceilings. Retrieval stays source-scoped and every domain gets its own
  citation-focused pass.
- **Evidence compaction.** When Paperclip's map/reduce supplies a cited extraction for a result set,
  the duplicate raw set is retained in the trace but omitted from that domain's prompt — the same
  evidence is not paid for twice, and its audit trail survives.
- **Streaming.** Reviews stream with a high `max_tokens`, which avoids the HTTP timeout a
  non-streaming request of this size would risk.
- **Refusal handling.** Server-side fallbacks are on by default so a safety-classifier decline is
  re-served rather than failing the request; if the fallback beta is rejected the call retries
  without it.
- **Read-only filesystems.** Serverless hosts mount the bundle read-only, so a completed review
  cannot be written next to the committed ones. Losing a review the caller just paid minutes for is
  the worse failure, so writes fall back to a process-lifetime cache: warm invocations serve it, cold
  ones re-run.
- **No third-party JavaScript.** The entire lab — 3D engine, force simulation, graph, construct
  viewer, couriers — is first-party ES modules. Nothing is fetched from a CDN at runtime.

## Layout

```
src/
  server.js                 Express app, security headers, static hosting
  config.js                 env + paths + run guards
  anthropic.js              structured-JSON call helper (caching, streaming, refusals)
  paperclip/
    client.js               MCP Streamable-HTTP JSON-RPC client
    tools.js                CLI command builder (search / map / reduce / sql / cat / skill)
    queries.js              catalog sweep + per-trial evidence sweep
  catalog/
    build.js  enrich.js  store.js  add.js
  evidence/
    domains.js              the nine CLARITY domains and their phase gates
    dossier.js              per-domain cited extraction
  evaluate/
    rubric.js               dimensions, weights, anchors
    schema.js               JSON schemas for both Claude calls
    evaluate.js             reviewer prompt + normalisation + guardrails
    benchmarks.js           cross-programme distributions
    store.js                on-disk cache + in-flight dedupe
    trace.js                run traces
  routes/                   trials, evaluations, lab
  utils/                    concurrency, run guards
public/
  index.html                the workstation shell
  app.js                    orchestration: dock, stage, inspector, console, run
  app.css                   Tailwind source + the instrument design system
  citations.js              identifier grammars → resolvable sources
  lab/
    engine3d.js             projection, camera, input, oklch→sRGB, canvas primitives
    graph3d.js              the living evidence graph and its descents
    genome3d.js             the construct in space
    genome.js               the flat, measurable feature map
    agents.js               the three couriers
    metrics.js              formulas, contribution matrix, benchmarks
    proof.js                the provenance drawer
    ui.js                   escaping and shared render primitives
    graph.js                flat SVG topology (fallback when no canvas context)
evidence_skills/            CLARITY domain policy — runtime, must ship
data/                       catalog, cached reviews, traces, probe dumps
test/                       API, citations, evidence, traces, guards, render path
```

## Deployment

Deploys to Vercel through `api/index.js`, which imports the Express app from `src/server.js`.
`vercel.json` rewrites `/api/*` and the SPA fallback through that adapter and packages `public/`,
`data/` and `evidence_skills/` with the function. Set `PUBLIC_RUNS=off` on any deployment whose URL
you intend to share.

---

Generated assessments are decision support, not regulatory advice.
Evidence retrieval by Paperclip · reasoning by Claude · structure by Benchling.
