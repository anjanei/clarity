---
name: fda-review-disease-context-mechanism
description: >
  Use this skill to extract and generate the "Disease Context & Mechanism" FDA review domain for a
  single asset. Answers the regulatory question: What is the unmet need and biological rationale? Trigger when
  reviewing an asset's disease context & mechanism for a specified development phase
  (Pre-clinical, Phase 1, Phase 2, Phase 3). A phase argument is REQUIRED.
  Do NOT use for other review domains.
---

# FDA Review Domain — Disease Context & Mechanism

## Core Regulatory Question
What is the unmet need and biological rationale?

## Scope (READ FIRST)
You handle ONLY this domain, for ONE asset, for ONE specified phase. Use
public-only data ingested via the Paperclip MCP. If a fact is not present in
the retrieved public sources, respond `Not found in public sources` — never
infer, extrapolate, or invent.

## What to look for in each asset (nested prompt)
Identify Disease name, etiology, and core symptoms.

## Data source routing (Paperclip MCP)
Use the **Paperclip MCP** to pull information from the relevant database for each data element. Route by phase:
- **Pre-clinical data** → Publications only: **PubMed, arXiv**.
- **Clinical data (Phase 1, 2, 3)** → **Trial information** (clinicaltrials.gov, international trial registries, FDA) **+ Publications** (PubMed, arXiv).

Never pull from any source not listed above. Never fabricate a source.

## Phase-gated outputs
Generate ONLY the elements listed for the **requested phase**. A phase argument
is required. Sections marked "Do not generate" must emit the literal placeholder.

### Pre-clinical
- Mechanism of action
- Literature review
- Prior landscape / similar products on the market

### Phase 1
- Mechanism of action
- Literature review
- Prior landscape / similar products on the market

### Phase 2 (2a / 2b)
- Mechanism of action
- Literature review
- Prior landscape / similar products on the market

### Phase 3 (3a / 3b)
- Mechanism of action
- Literature review
- Prior landscape / similar products on the market

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
