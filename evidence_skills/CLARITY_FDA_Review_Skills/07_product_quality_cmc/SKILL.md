---
name: fda-review-product-quality-cmc
description: >
  Extract the "Product Quality & CMC" FDA review domain for one asset across the cumulative
  phase flow (Pre-clinical→P1→P2→P3→P4 as applicable). Q: Can commercial lots be manufactured consistently, potently, and safely? Phase argument
  required. Not for other domains.
---
# FDA Review Domain — Product Quality & CMC
**Core question:** Can commercial lots be manufactured consistently, potently, and safely?
**Scope:** One domain, one asset. Public-only via Paperclip MCP. Absent fact → `Not found in public sources`; never infer silently.
**Nested prompt:** Product quality & CMC elements per phase.

## Phase flow (generate in order)
Generate data as a **cumulative flow**: Pre-clinical → Phase 1 → Phase 2 → Phase 3 → Phase 4 (as applicable). Each phase **carries forward** prior-phase findings and adds only what is new ("carried from <phase>"). Do not restate unchanged content. Phase 4 = post-marketing; include only if such data exists, else mark `Not applicable`.

## Sources (Paperclip MCP)
- Pre-clinical → PubMed, arXiv.
- Clinical (Ph 1–4) → clinicaltrials.gov, intl registries, FDA + PubMed, arXiv.
No other sources. Never fabricate. Every element needs ≥1 clickable link.

## Phase-gated elements
### Pre-clinical
- Quality compliance & release specs

### Phase 1
- Assay validation
- Quality compliance & release specs

### Phase 2 (2a/2b)
- Assay validation
- Release specs
- Facility inspection & process consistency

### Phase 3 (3a/3b)
- Assay validation
- Release specs
- Facility inspection & process consistency

### Phase 4 (post-marketing)
- Commercial lot consistency / post-approval changes

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
