---
name: fda-review-orchestrator
description: >
  Router + shared rules for CLARITY. Load FIRST. Selects one skill at a time,
  enforces global rules, requires a phase, drives the cumulative phase flow and
  the final evalbench step. Routes to the 9 FDA-review domains and, once an asset
  is regulatorily sound, to the commercial-viability skill (10).
---
# CLARITY — Orchestrator
**Load first.** Routes to ONE skill at a time (small context, less hallucination). Never load all at once.

## Required inputs (block if missing)
Asset (one) · Phase (Pre-clinical/1/2/3/4) · Domain(s).

## Phase flow (generate in order)
Generate data as a **cumulative flow**: Pre-clinical → Phase 1 → Phase 2 → Phase 3 → Phase 4 (as applicable). Each phase **carries forward** prior-phase findings and adds only what is new ("carried from <phase>"). Do not restate unchanged content. Phase 4 = post-marketing; include only if such data exists, else mark `Not applicable`.

## Routing
| # | Skill | Load |
|---|-------|------|
| 1 | Disease Context & Mechanism | fda-review-disease-context-mechanism |
| 2 | Trial Design | fda-review-trial-design |
| 3 | Acute Safety & Tolerability | fda-review-acute-safety-tolerability |
| 4 | Long-Term Genetic Risk | fda-review-long-term-genetic-risk |
| 5 | Biodistribution & Pharmacology | fda-review-biodistribution-pharmacology |
| 6 | Immunogenicity & Special Populations | fda-review-immunogenicity-special-populations |
| 7 | Product Quality & CMC | fda-review-product-quality-cmc |
| 8 | Trial Integrity, Governance & Operational Infrastructure | fda-review-trial-integrity-governance |
| 9 | Benefit–Risk & Postmarketing Controls | fda-review-benefit-risk-postmarketing |
| 10 | **Commercial Viability** (run after 1–9 confirm soundness) | clarity-commercial-viability |

## Loop
orchestrator + one domain → run phase flow → collect → unload → next. After the 9 FDA domains, if the asset is sound, run **skill 10 (commercial)**. After all, run the **dataset-level evalbench** aggregation.

## Sources (Paperclip MCP)
- Pre-clinical → PubMed, arXiv.
- Clinical (Ph 1–4) → clinicaltrials.gov, intl registries, FDA + PubMed, arXiv.
No other sources. Never fabricate. Every element needs ≥1 clickable link.

## Output contract (per element)
`Finding` · `Source(s)` (clickable link, mandatory) · `Evidence Directness 10–100%` · `Inference Strength 10–100%` · `Rationale`.
- Evidence Directness = did the source actually hold this element's data? (High=states value; Low=rests on inference).
- Inference Strength = safety of any logical leap (100%=no inference; source is the data).
- Never merge the two signals. Missing data → `Not found in public sources`. Gated section → literal `Do not generate`.

## References (same table, at bottom)
Emit all sources as a numbered **References block at the bottom of the same output table**. Each row: `[n] Title — clickable URL`. Cite by `[n]` inline in Source(s).

## Evalbench analysis (run last)
After all elements, call the **evalbench** tool to compute one **overall confidence interval**:
1. Per element `c = Directness × Inference` (0–1).
2. Report mean `c̄`, sd `s`, n, 95% CI = `c̄ ± 1.96·s/√n` (clamp 0–100%).
3. Exclude `Not found`/`Do not generate` (note n excluded).
4. Output dataset-level **Overall Confidence (95% CI)** + reliability verdict vs the held-out benchmark.

## Guardrails
No hallucination · phase-flow order (P4 as applicable) · two signals never collapsed · Paperclip MCP only · public-only · clickable sources mandatory · one asset at a time · no cross-domain bleed.

## Phase activation (cumulative)
- Pre-clinical: Disease, Acute Safety, CMC.
- +P1: Trial Design, Biodistribution, Immunogenicity, Trial Integrity.
- +P2: Long-Term Genetic Risk.
- +P3: Benefit–Risk & Postmarketing.
- +P4: post-marketing rows where applicable.
- Commercial (10): after regulatory soundness is established.
