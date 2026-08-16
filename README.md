<div align="center">

# CLARITY

### An FDA reviewer that shows its work.

**Point it at a clinical programme. It retrieves the public evidence that exists, organises it into a
cited nine-domain regulatory dossier, and scores it the way a reviewer would — then opens every
single number down to the paper it came from and the search command that found the paper.**

[![Live](https://img.shields.io/badge/live-fdaapproval.vercel.app-2DD4BF?style=for-the-badge&labelColor=0B1120)](https://fdaapproval.vercel.app)
&nbsp;
[![Node](https://img.shields.io/badge/node-20%2B-6EE7A0?style=for-the-badge&labelColor=0B1120)](https://nodejs.org)
&nbsp;
![Browser dependencies](https://img.shields.io/badge/browser_dependencies-zero-F0A07A?style=for-the-badge&labelColor=0B1120)
&nbsp;
![Tests](https://img.shields.io/badge/tests-42_passing-6EE7A0?style=for-the-badge&labelColor=0B1120)

*Evidence retrieval by **Paperclip** · reasoning by **Claude** · structure by **Benchling***

</div>

---

## Start with the uncomfortable part

Here is CLARITY's scorecard for **CS-101**, an *in vivo* base-edited cell therapy for β-thalassemia
major in Phase 2 (`NCT07489196`, CorrectSequence Therapeutics). Not a toy example — a real
programme, a real run, cached in this repo.

| Rubric dimension | Score | Evidence |
| --- | :---: | --- |
| Disease Context & Mechanism | **4** / 5 | moderate |
| Trial Design & Regulatory Strategy | 3 / 5 | weak |
| Immunogenicity | 3 / 5 | `absent` |
| Trial Integrity & Governance | 3 / 5 | `absent` |
| Efficacy & Clinical Evidence | 2 / 5 | `absent` |
| Safety & Tolerability | 2 / 5 | `absent` |
| Long-Term Genetic Risk | 2 / 5 | `absent` |
| Biodistribution & Pharmacology | 2 / 5 | `absent` |
| Manufacturability & CMC | 2 / 5 | `absent` |
| PK/PD & Dosing | 2 / 5 | `absent` |

> **40% probability of trial success**, range 24–56, confidence **low**.

Nine of ten dimensions are marked `absent`. The single dimension that scores well is the one about
the *disease* — because β-thalassemia pathophysiology is thirty years deep in the literature. Every
dimension about the *product* scores 2 out of 5, because the clinical data for this construct is not
public yet.

**That is the entire pitch.**

A system that returns 40% *and shows you exactly which nine boxes are empty* has told you something
true, actionable and arguable. You now know precisely what to ask the sponsor for. A system that
returns a confident 68% by quietly borrowing Casgevy's safety profile has told you nothing — twice,
because it also told you it was sure.

Two guardrails make this structural rather than aspirational, enforced in code, not in a prompt:

```js
// src/evaluate/evaluate.js
if (found.evidenceStrength === 'absent' && score > 3) score = 3;   // no unsupported high scores
probabilityOfTrialSuccess.pointEstimate = clamp(point, low, high); // no estimate outside its own range
```

You can see the ceiling biting in the table above. Every `absent` row is pinned at 2 or 3. It cannot
be argued past.

---

## Why anyone should care

Roughly **92 out of every 100 drugs** that enter human trials never reach a patient
([BIO / Informa / QLS, *Clinical Development Success Rates 2011–2020*](https://go.bio.org/rs/490-EHZ-999/images/ClinicalDevelopmentSuccessRates2011_2020.pdf) —
Phase I to approval, 7.9%). The capitalised cost of getting one of the survivors across the line is
estimated at **$2.6 billion**
([DiMasi, Grabowski & Hansen, *J Health Econ* 47:20–33, 2016](https://doi.org/10.1016/j.jhealeco.2016.01.012)).

Behind those numbers is a queue. A child with transfusion-dependent β-thalassemia is on a
four-weekly transfusion schedule and an iron chelator for life. A family with hereditary ATTR
amyloidosis is watching a parent's cardiomyopathy progress on a clock. Somewhere in the catalog in
this repo there are 118 programmes that might change one of those trajectories, and almost all of
them are Phase 1 or Phase 1/2 — the stage where nobody outside the sponsor can tell the promising
ones from the doomed ones.

The people whose job is to tell them apart — a licensing team, a translational investor, a reviewer
prepping a pre-IND meeting, a foundation deciding where its grant goes — are all doing the same task
by hand, today, in a browser with forty tabs open:

> Read the registry record. Find the Phase 1 publication, if it exists. Pull the FDA review package
> for the closest approved product in the class. Work out whether a long-term follow-up protocol
> exists. Notice that nobody has published per-cohort dosing. Form a probability. Write it down.
> Justify it to someone who *will* ask **"where did that come from?"**

Several days of specialist time. Not reproducible. Two analysts reading the same literature reach
different numbers and neither can hand over the trail that got them there. **The bottleneck on
capital reaching good science is not intelligence. It is audit.**

---

## The obvious solution fails in a specific, dangerous way

Ask a language model. It will answer.

It will answer well about pembrolizumab, and it will answer with *identical confidence* about the
Phase 1/2 allogeneic CAR-T that posted its first registry record eleven weeks ago and has published
nothing. Same fluent register. Same air of authority. No signal whatsoever distinguishing the
recalled fact from the plausible invention.

In a regulatory context that is worse than useless. **An opinion you cannot audit is not a weak
opinion — it is a liability that looks like an asset.**

---

## The insight

The failure above is not a reasoning failure. It is a **provenance** failure. So CLARITY splits the
two jobs apart and never lets them touch.

```
     ┌───────────────┐      ┌────────────────────┐      ┌─────────────────────┐
     │   RETRIEVAL   │ ───► │     EXTRACTION     │ ───► │       SCORING       │
     │   Paperclip   │      │  Claude · 9 domains│      │  Claude · 10 dims   │
     ├───────────────┤      ├────────────────────┤      ├─────────────────────┤
     │ registries    │      │ one pass per       │      │ sees ONLY the trial │
     │ FDA reviews   │      │ domain, sees only  │      │ record + the cited  │
     │ PMC/bioRxiv   │      │ that domain's      │      │ dossier. Never the  │
     │ /trials/us    │      │ evidence packet.   │      │ open internet.      │
     │ /trials/intl  │      │ Every finding must │      │ Never its own       │
     │               │      │ carry a public id. │      │ recall.             │
     └───────────────┘      └────────────────────┘      └─────────────────────┘
             │                        │                            │
             ▼                        ▼                            ▼
      whatever this          "Not found in public         a score that can only
      returns is the          sources" when it            rest on something a
      ENTIRE universe         cannot be sourced           reader can open
      of available facts
```

Each stage consumes **only** what the stage before it retrieved, and hands forward the citations it
used. That constraint is not a design preference. It is the product.

<div align="center">

**Nothing on the report comes from the model's recall.
If the evidence does not exist, the report says so, and the score goes down.**

</div>

---

## One claim, opened all the way

This is the part that makes it real. Take the single strong claim from the CS-101 review above and
press *proof*.

<table>
<tr><td width="140"><b>1 · CLAIM</b></td><td>

β-thalassemia pathophysiology (α/β chain imbalance, precipitation of free α-globin, ineffective
erythropoiesis, hemolysis, transfusional iron overload) is consistently described, and co-inheritance
of α-thalassemia ameliorates phenotype

</td></tr>
<tr><td><b>2 · CITED</b></td><td>

`PMC5583283` · [Editing an α-globin enhancer in primary human hematopoietic stem cells as a treatment for β-thalassemia](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5583283/)
<br>
`PMC12672394` · [Assessment of natural killer cell subpopulations in pediatric patients with transfusion-dependent β-thalassemia major](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12672394/)
<br>
`NCT06291961` · [A Safety and Efficacy Study Evaluating CS-101 in Subjects With β-Thalassemia Major](https://clinicaltrials.gov/study/NCT06291961)

</td></tr>
<tr><td><b>3 · EXTRACTED</b></td><td>

Domain **Disease Context & Mechanism**, element *"Disease name, etiology, and core symptoms"*,
**85% confidence**, with the extractor's own reasoning recorded:

> *"Pathophysiology is consistently described across peer-reviewed sources and the disease indication
> is confirmed in the registry record, though symptom detail is only partially covered."*

</td></tr>
<tr><td><b>4 · RETRIEVED BY</b></td><td>

```
search -s pmc,arxiv "CS-101 injection β-thalassemia Major Cell therapy
  disease natural history mechanism of action treatment landscape"
```
→ 5,498 chars, then a map/reduce reader extraction → 24,025 chars

</td></tr>
<tr><td><b>5 · SCORED BY</b></td><td>

`claude-opus-5` · effort `high` · rubric `v2.0.0` · dossier `v1.0.0` — with a full run trace on disk
if tracing was on

</td></tr>
</table>

Five clicks from a number on a dashboard to a shell command you can paste. **Every claim in every
report has this.** Not a sample. Not the important ones. All of them — and where a link in the chain
genuinely does not exist, the drawer renders that step as *missing* rather than filling it with
something plausible.

> A broken chain shown honestly is the difference between provenance and decoration.

---

## Two more real runs, for calibration

| Programme | Indication | Phase | Verdict |
| --- | --- | :---: | --- |
| **NTLA-2001** | Hereditary ATTR amyloidosis · *in vivo* CRISPR knockout of hepatic *TTR* | 1 | **58%** (40–72) · confidence **moderate** |
| **CS-101** | β-thalassemia major · base-edited HSC therapy | 2 | **40%** (24–56) · confidence **low** |
| **CTX112** | r/r B-cell malignancy · allogeneic CD19 CAR-T | 1/2 | **28%** (15–42) · confidence **low** |

NTLA-2001 scores highest not because it is the most exciting science, but because the ATTR
regulatory precedent set — patisiran, tafamidis, inotersen, eplontersen, acoramidis — is unusually
rich, and its registry coverage runs from Phase 1 through the Phase 3 successors and the long-term
follow-up protocol. The reviewer still refuses to score efficacy on presumption: no primary Phase 1
dataset with per-cohort TTR reductions was retrievable, and the report says so.

CTX112 consumed **31 retrieval commands, 29 cited sources and 207,641 tokens of context** to arrive
at 28% — the expense is the point. It looked as hard as it could and reported what it found, which
was that the primary clinical evidence for *this construct* is not public.

---

## The lab

The interface is not a report with a chart on it. **It is one workstation, and the graph in the
middle of it is the run.**

<div align="center">

| | |
| --- | --- |
| 🧬 | **A real 3D graph, written from scratch.** Perspective projection, force simulation, depth-sorted compositing, orbit and pinch input, `oklch → sRGB` so the canvas can never drift from the stylesheet. **2,356 lines of first-party rendering code and not one byte of third-party JavaScript in the browser.** No WebGL library. No CDN. Drag to orbit, scroll to zoom. |
| ⚡ | **Nodes light in the order the server actually works.** A stage that never fires never lights. This is not a scripted animation playing next to the run — it *is* the run, driven by the same SSE events the console prints. |
| 📈 | **The graph grows.** Every retrieval event attaches the document it found. A programme with a full dossier ends the run visibly larger than it started: 15 nodes idle → 34 with evidence attached. |
| 🔍 | **Every node with structure opens into its own graph.** A paper into the findings it supports and the domains those landed in. A finding into its provenance chain. The review into the weighted rubric as a body with mass — node size *is* rubric weight, colour *is* the score. Breadcrumbs lead back up. |
| 🤖 | **Three couriers, bound to the three real actors.** *Clip* carries a document from retrieval to the domain that requested it, once per real search. *Cortex* carries a scored domain into the dossier. *Helix* fetches the construct. They walk over and pull a disclosure open when you click one, and spill out of the button that starts a run. Off under `prefers-reduced-motion`, with a toggle in the rail. |
| 🧪 | **The construct renders in space.** A rotating double helix with the feature architecture mapped onto its turns — or a single chain for a protein, because a protein is not a double helix. Bases are only ever drawn from a sequence the server actually returned; a derived model shows architecture and says so. The flat, measurable feature map sits directly beneath it. |
| ∑ | **The arithmetic is shown, not asserted.** The weighted score renders as its formula with the real terms substituted. Evidence completeness renders as its formula. The reviewer's probability calibration is parsed back out of its own prose into a bridge chart — and a sentence without a signed number does *not* become a bar. |
| ⚖️ | **Benchmarks that refuse to lie about n.** Your programme is placed against every review this rubric has produced. When that number is six, the panel says *"read the position, not the distribution"* instead of drawing a histogram out of six points. |

</div>

The design rule underneath all of it: **colour is semantic, never decorative.** Cyan is retrieval,
coral is reasoning, lime is structure, and the risk scale keeps its own red/amber/emerald and is
never reused for chrome. Data is monospace, prose is grotesk — you can tell at a glance whether
something was measured or written.

---

## The rubric

Ten weighted dimensions, each scored 1–5 against explicit anchors (`src/evaluate/rubric.js`, v2.0.0).
Weights sum to 1.0, and **the module refuses to load if they do not.**

| Dimension | Weight | |
| --- | ---: | --- |
| Efficacy & Clinical Evidence | 22% | `██████████████████████` |
| Safety & Tolerability | 20% | `████████████████████` |
| Long-Term Genetic Risk | 10% | `██████████` |
| Biodistribution & Pharmacology | 10% | `██████████` |
| Manufacturability & CMC | 10% | `██████████` |
| PK/PD & Dosing | 8% | `████████` |
| Trial Design & Regulatory Strategy | 7% | `███████` |
| Disease Context & Mechanism | 5% | `█████` |
| Immunogenicity | 5% | `█████` |
| Trial Integrity, Governance & Operational Infrastructure | 3% | `███` |

The shape is deliberate and it is not the shape you would use for a small molecule. **Long-term
genetic risk and biodistribution carry as much weight as CMC**, because for an integrating vector or
an *in vivo* editor those two dimensions *are* the review. Insertional mutagenesis and off-target
editing are the questions that decide whether a fifteen-year follow-up commitment is survivable.

## The nine CLARITY domains

Phase-gated, so a preclinical asset is never asked for postmarketing controls it cannot have.

| Domain | Active from | Searches |
| --- | --- | :---: |
| Disease Context & Mechanism | preclinical | 3 |
| Acute Safety & Tolerability | preclinical | 3 |
| Product Quality & CMC | preclinical | 2 |
| Trial Design | phase 1 | 3 |
| Biodistribution & Pharmacology | phase 1 | 2 |
| Immunogenicity & Special Populations | phase 1 | 3 |
| Trial Integrity, Governance & Operational Infrastructure | phase 1 | 3 |
| Long-Term Genetic Risk | phase 2 | 2 |
| Benefit–Risk & Postmarketing Controls | phase 3 | 3 |

These live in `evidence_skills/CLARITY_FDA_Review_Skills/` and are **runtime policy, not
documentation.** They must ship with the deployment.

## The catalog

| | |
| --- | --- |
| **118 programmes** | swept from `/trials/us`, `/trials/intl` and `-s fda`, normalised by Claude into strict-schema records |
| **Modality** | 77 cell therapy · 40 gene therapy · 1 other |
| **Phase** | 42 Phase 1 · 37 Phase 1/2 · 16 Early Phase 1 · 8 Phase 3 · 2 Phase 2 · 2 Phase 2/3 |
| **Area** | Oncology 40 · Hematology 34 · Rare & Genetic 17 · Cardiometabolic 9 · Ophthalmology 8 · Infectious Disease 5 · Immunology 4 · Nephrology 1 |

<details>
<summary><b>Why there is a registry enrichment step — and why it is the whole philosophy in miniature</b></summary>

<br>

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

**This is the pattern the whole system follows.** Where a source cannot supply a field, say so and go
to the authoritative source, rather than letting a model guess and calling the guess data.

</details>

---

## What this does not do

Stating the boundary is part of the claim. A system that will not say what it cannot do has not
earned the right to say what it can.

- ❌ **It is not a regulatory decision.** It is decision support. FDA review is a human, deliberative
  process with access to the confidential IND that CLARITY by construction cannot see.
- ❌ **It only knows what is public.** The dominant reason a Phase 1/2 asset scores low is that its own
  clinical data has not been published. That is a statement about the evidence, not about the science.
- ❌ **It does not match patients to trials.** The catalog carries no site or eligibility geography, so
  there is no pre-screening widget and no site map. Building one on data this repo does not have
  would be the exact failure mode the rest of the system exists to prevent.
- ❌ **Small n on benchmarks.** Six reviews is a position, not a distribution, and the UI says so out loud.
- ❌ **The reviewer is a model.** The rubric, the weights, the phase gates and the two guardrails are
  code. The judgement *inside* a domain is Claude's — and the proof chain exists precisely so you can
  overrule it.

---

## Run it

Node 20+, a [Paperclip key](https://paperclip.gxl.ai/keys), an [Anthropic key](https://platform.claude.com).

```bash
npm install
cp .env.example .env      # fill in both keys
npm run dev               # Tailwind watch + node --watch
```

Open <http://localhost:3000>, pick a programme, press **Run FDA review**. Progress streams over SSE
while retrieval runs; the completed review caches to `data/evaluations/<trialId>.json` and loads
instantly on re-select.

**Leave the keys blank** and you still get the catalog, the full lab surface and every cached review —
only catalog generation and fresh runs need them.

The test suite needs no keys and no network. It builds an isolated catalog in a temp directory,
drives the API on an ephemeral port, and runs the canvas render path against a recording 2D context —
so the 3D graph is regression-tested without a browser:

```bash
npm test          # 42 passing
```

<details>
<summary><b>Confirm Paperclip connectivity first (two rules that are easy to get wrong)</b></summary>

<br>

Paperclip's programmatic surface is an MCP server (`https://paperclip.gxl.ai/mcp`, `X-API-Key`
header) exposing **exactly one tool** — `paperclip` — whose only argument is a CLI command string.
`src/paperclip/tools.js` is the single place those strings are built.

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

</details>

<details>
<summary><b>Build the catalog</b></summary>

<br>

```bash
npm run catalog                        # merge into any existing catalog
npm run catalog -- --limit 60          # more results per search
npm run catalog -- --replace           # discard and rebuild
npm run catalog -- --no-enrich         # skip registry enrichment
```

Records are deduped by `trialId`; anything without a readable registry identifier is rejected rather
than guessed. Output: `data/trials.json`.

</details>

---

## Putting it on a public URL

The two routes that start a review spend real tokens and take minutes, and they sit on a public URL
with no authentication. Reading a cached review, a trace or the catalog is always open. **Starting** a
run is guarded three ways:

| Guard | Default | Variable |
| --- | --- | --- |
| Kill switch — serve cached reviews only | on | `PUBLIC_RUNS=off` |
| Run starts per address per window | 6 per 10 min | `RUN_LIMIT`, `RUN_WINDOW_MS` |
| Reviews running at once | 2 | `RUN_CONCURRENCY` |

The counters are in-memory, so on a serverless host the limit is per instance rather than global.
That is a weaker guarantee than a shared store, but it needs no external dependency and **cannot fail
closed and lock you out of your own lab.** A deployment that needs a hard ceiling should set
`PUBLIC_RUNS=off` and run reviews from the CLI.

Every response carries a content-security policy forbidding third-party script, framing and plugins.
The page loads no external code, no external fonts and no external images, so the policy is `'self'`
plus inline styles — there is nothing to relax. It is applied **twice on purpose**: in the Express
middleware, and again in `vercel.json`, because files under `public/` are served straight from the CDN
and never reach the middleware.

<details>
<summary><b>API reference</b></summary>

<br>

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
| `POST /api/evaluations/:trialId?force=1` | Run a review (blocking, minutes) · **guarded** |
| `GET /api/evaluations/:trialId/stream?trace=full` | Run with `progress` → `result` SSE events · **guarded** |

Concurrent requests for the same trial share one run, so a double-click does not pay twice.

</details>

<details>
<summary><b>Configuration</b></summary>

<br>

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
| `PORT` / `HOST` | `3000` / `0.0.0.0` | `0.0.0.0` exposes the app on your network **with no auth** |

</details>

<details>
<summary><b>Full learning traces</b></summary>

<br>

Tick **Full trace** in the dock before a fresh run, or send `trace=full` to either evaluation
endpoint. The trace saves to `data/traces/<trialId>/<traceId>.json` and is linked from the report's
provenance panel. It records the trial snapshot, progress timeline, every Paperclip command and
complete public response, the exact Claude system and user prompts, structured outputs, per-call
timing, token usage, the evidence bundle, the cited dossier and the final review.

It contains no API keys, but it retains public evidence and generated assessment — treat it as local
review data, not a source artifact to commit.

`TRACE_MODE=metadata` keeps timing and token diagnostics for every run without storing prompts or
source text. `TRACE_MODE=full` makes complete tracing the server default.

</details>

<details>
<summary><b>Benchling structure panel</b></summary>

<br>

Benchling's APIs are tenant-scoped, so credentials alone are not enough: set `BENCHLING_TENANT` plus
either `BENCHLING_API_KEY` or the OAuth pair. When configured, the server searches DNA and amino-acid
sequences by therapeutic name and returns real sequence metadata.

With no tenant or no match, the UI renders an explicitly labelled schematic derived from registry
modality and the target symbols cited in the review evidence — **it never invents a nucleotide or
amino-acid sequence.**

</details>

---

## Implementation notes

- **Structured output, not parsing.** Both Claude calls use `output_config.format` with a JSON schema,
  so responses validate at the API layer — there is no parse-and-retry loop.
- **Prompt caching.** The reviewer persona and rubric are byte-stable behind an `ephemeral` cache
  breakpoint; the shared CLARITY policy uses the same reusable prefix before each domain skill. Cache
  read and write token counts appear in every report.
- **Bounded parallelism.** Independent searches and domain synthesis calls run in stable order with
  conservative concurrency ceilings. Retrieval stays source-scoped and every domain gets its own
  citation-focused pass.
- **Evidence compaction.** When Paperclip's map/reduce supplies a cited extraction for a result set,
  the duplicate raw set is retained in the trace but omitted from that domain's prompt — the same
  evidence is not paid for twice, and its audit trail survives.
- **Streaming.** Reviews stream with a high `max_tokens`, avoiding the HTTP timeout a non-streaming
  request of this size would risk.
- **Refusal handling.** Server-side fallbacks are on by default so a safety-classifier decline is
  re-served rather than failing the request; if the fallback beta is rejected the call retries without it.
- **Read-only filesystems.** Serverless hosts mount the bundle read-only, so a completed review cannot
  be written next to the committed ones. Losing a review the caller just paid minutes for is the worse
  failure, so writes fall back to a process-lifetime cache: warm invocations serve it, cold ones re-run.
- **Graceful degradation everywhere.** No canvas context → the flat SVG topology renders instead. No
  `EventSource` → the run says so rather than hanging. Storage throwing in private mode → the
  preference simply does not persist. A malformed SSE frame → dropped, not fatal.

<details>
<summary><b>Repository layout</b></summary>

<br>

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

</details>

## Deployment

Deploys to Vercel through `api/index.js`, which imports the Express app from `src/server.js`.
`vercel.json` rewrites `/api/*` and the SPA fallback through that adapter and packages `public/`,
`data/` and `evidence_skills/` with the function.

> ⚠️ This project has **no Git integration** — deployments are made with `vercel --prod` from a linked
> checkout. Pushing to a branch publishes the code, not the site.

Set `PUBLIC_RUNS=off` on any deployment whose URL you intend to share.

---

<div align="center">

**Generated assessments are decision support, not regulatory advice.**

*Every number above is either produced by running this repository, or carries a citation.
That is not a stylistic choice — it is the same rule the product enforces on itself.*

</div>
