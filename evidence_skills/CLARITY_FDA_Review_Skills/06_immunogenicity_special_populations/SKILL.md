---
name: fda-review-immunogenicity-special-populations
description: >
  Extract the "Immunogenicity & Special Populations" FDA review domain for one asset across the cumulative
  phase flow (Pre-clinical→P1→P2→P3→P4 as applicable). Q: Can host immune responses limit efficacy or cause severe toxicity? Phase argument
  required. Not for other domains.
---
# FDA Review Domain — Immunogenicity & Special Populations
**Core question:** Can host immune responses limit efficacy or cause severe toxicity?
**Scope:** One domain, one asset. Public-only via Paperclip MCP. Absent fact → `Not found in public sources`; never infer silently.
**Nested prompt:** Immunogenicity & special-population elements per phase.

## Phase flow (generate in order)
Generate data as a **cumulative flow**: Pre-clinical → Phase 1 → Phase 2 → Phase 3 → Phase 4 (as applicable). Each phase **carries forward** prior-phase findings and adds only what is new ("carried from <phase>"). Do not restate unchanged content. Phase 4 = post-marketing; include only if such data exists, else mark `Not applicable`.

## Sources (Paperclip MCP)
- Pre-clinical → PubMed, arXiv.
- Clinical (Ph 1–4) → clinicaltrials.gov, intl registries, FDA + PubMed, arXiv.
No other sources. Never fabricate. Every element needs ≥1 clickable link.

## Phase-gated elements
### Pre-clinical
Do not generate

### Phase 1
- Baseline demographics & comorbidities
- Neutralizing antibodies & T-cell responses

### Phase 2 (2a/2b)
- Baseline demographics & comorbidities
- Special populations (pediatric, renal/hepatic)
- NAb & T-cell responses

### Phase 3 (3a/3b)
- Baseline demographics & comorbidities
- Special populations (pediatric, renal/hepatic)
- NAb & T-cell responses

### Phase 4 (post-marketing)
- Real-world special-population outcomes

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
