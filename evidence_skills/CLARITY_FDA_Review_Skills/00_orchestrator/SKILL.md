---
name: fda-review-orchestrator
description: >
  Router and shared-rules skill for the CLARITY FDA review. Use FIRST for any
  FDA review task. It (a) selects which domain skill(s) to load for the asset,
  (b) enforces the global CLARITY rules once, and (c) requires a phase argument
  before any domain skill runs. Do not generate domain content here — delegate
  to the specific domain skill.
---

# CLARITY FDA Review — Orchestrator

## Purpose
Load this skill first. It holds the shared rules ONCE and routes work to exactly
one domain skill at a time, keeping the context window small and suppressing
hallucination. Never load all domains at once.

## Required inputs (block if missing)
1. **Asset** — the single molecule/program under review (one at a time).
2. **Phase** — one of: `Pre-clinical`, `Phase 1`, `Phase 2`, `Phase 3`.
   A phase argument is **required**. If absent, stop and request it.
3. **Domain(s)** — one or more of the nine domains below.

## Domain routing table
| # | Domain | Skill to load |
|---|--------|---------------|
| 1 | Disease Context & Mechanism | fda-review-disease-context-mechanism |
| 2 | Trial Design | fda-review-trial-design |
| 3 | Acute Safety & Tolerability | fda-review-acute-safety-tolerability |
| 4 | Long-Term Genetic Risk | fda-review-long-term-genetic-risk |
| 5 | Biodistribution & Pharmacology | fda-review-biodistribution-pharmacology |
| 6 | Immunogenicity & Special Populations | fda-review-immunogenicity-special-populations |
| 7 | Product Quality & CMC | fda-review-product-quality-cmc |
| 8 | Trial Integrity, Governance & Operational Infrastructure | fda-review-trial-integrity-governance |
| 9 | Benefit–Risk & Postmarketing Controls | fda-review-benefit-risk-postmarketing |

## Execution loop
For each requested domain: load orchestrator + that ONE domain skill → run for
the specified phase → collect output → unload the domain skill before the next.

## Data source routing (Paperclip MCP)
Use the **Paperclip MCP** to pull information from the relevant database for each data element. Route by phase:
- **Pre-clinical data** → Publications only: **PubMed, arXiv**.
- **Clinical data (Phase 1, 2, 3)** → **Trial information** (clinicaltrials.gov, international trial registries, FDA) **+ Publications** (PubMed, arXiv).

Never pull from any source not listed above. Never fabricate a source.

## Output contract (per element)
For every element you produce, return:
1. **Finding** — concise extracted content.
2. **Source(s)** — public citation(s) backing the finding (title + link/ID). **Sources are mandatory.**
3. **Confidence score (10–100%)** — calibrated to source strength/agreement.
4. **Rationale** — one line explaining the score (inspectable).

If an element or an entire phase section is marked **"Do not generate"**, emit the literal placeholder `Do not generate` for that section — do not fabricate content to fill it.

## Guardrails (non-negotiable)
- **Do not hallucinate or generate data where none exists.** If a fact is not in the retrieved public sources, respond `Not found in public sources`.
- **Generate only phase-appropriate data** as identified in the phase rows below. A phase argument is **required** — if none is provided, stop and request it.
- **Use the Paperclip MCP** to pull information from the relevant database for each data element (routing above).
- **Public-only** data (clinical, regulatory, patent, publication). No proprietary/internal data.
- **Sources must be listed** for every claim. No source → mark `Not found in public sources`.
- **No cross-domain bleed** — handle only this domain's elements; other domains belong to other skills.
- Operate on **one asset at a time**.

## Phase-gating quick reference (which domains produce output by phase)
- **Pre-clinical:** Disease Context, Acute Safety, Product Quality & CMC. (All others → `Do not generate`.)
- **Phase 1:** adds Trial Design, Biodistribution, Immunogenicity, Trial Integrity.
- **Phase 2 (2a/2b):** adds Long-Term Genetic Risk.
- **Phase 3 (3a/3b):** adds Benefit–Risk & Postmarketing Controls (full set active).
