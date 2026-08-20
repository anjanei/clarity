---
name: clarity-commercial-viability
description: >
  Comprehensive commercial-intelligence skill for CLARITY. Runs AFTER the 9 FDA
  review skills confirm an asset is regulatorily sound, to answer "is it worth
  pursuing, and where is the money?" Five linked sections rendered as a labeled
  one-page output. Cell & gene therapy focused. Public data only. Trigger for
  market sizing, competitive/IP/deal analysis, pricing precedent, or rNPV.
---
# CLARITY — Commercial Viability Skill
**Core question:** Given the asset is regulatorily sound, is it commercially worth pursuing — and where is the money over 5 years?
**Scope:** One asset. Public data only. Absent data → `Not found in public sources`; never infer silently. Two-signal confidence on every figure.

## Inputs (block if missing)
Asset · Indication(s) · Development stage/approval status · (optional) geography (default US + EU5).

## Sources (Paperclip MCP + commercial)
- Patents/exclusivity → Google Patents, USPTO, EPO, Orange/Purple Book.
- Deals/licensing → company press, SEC EDGAR, BioPharma deal DBs, investor decks.
- Market/epi → cell & gene therapy consulting reports (EvaluatePharma, GlobalData, Grand View, ASGCT), disease registries, payer/HTA.
- Comparables → **XBI** and gene-therapy peers; prior CGT approvals (Casgevy, Lyfgenia, Zolgensma, Hemgenix) as analogs.
No source outside the above. Never fabricate; every figure needs ≥1 clickable link.

## MANDATED OUTPUT — one landscape page, 4 labeled tables + references
Render exactly this structure so every asset is comparable:
- **Verdict strip:** GO / CONDITIONAL GO / NO-GO + one-line thesis.
- **Table 1 — Market Size Funnel & Price Build:** prevalence→SAM→SOM; WAC→(GTN/royalty haircut)→net realized price.
- **Table 2 — Landscape → Financial Adjusters (THE MERGE):** each IP/deal/competition/safety factor maps to a financial effect (net price, penetration ceiling, PoS, profit-share) with a +/−/= adjuster. Landscape DRIVES the model; it is not a sidebar.
- **Table 3 — 5-Yr Penetration & rNPV:** net price, penetration ceiling, PoS and any partner profit-share are INHERITED from Table 2. Columns: Year · Eligible(SOM) · Penetration% · Treated · Net price · Gross rev · PoS-adj rev · Discounted (partner-net) rev; then cumulative rNPV.
- **Table 4 — Evalbench: rNPV Sensitivity & Confidence:** bear/base/bull on the dominant drivers (price, penetration, PoS, discount); dataset 95% CI; reliability verdict.
- **References:** numbered, clickable, at the bottom of the same page.
Every table MUST be labeled "Table N — …".

## rNPV model
`rNPV = Σ (PoS-adjusted CF × partner_share / (1+r)^t)`, horizon 5 yr, default discount 10–12%. State every assumption inline; assumed values = high Inference / low Directness.

## Output contract (per figure)
`Finding/Value · Source(s)` (clickable, mandatory) · `Evidence Directness 10–100%` · `Inference Strength 10–100%` · `Rationale`. Never merge the two signals. Modeled values labeled honestly (high Inference, low Directness).

## Evalbench analysis (run last)
Per figure `c = Directness × Inference`; dataset **95% CI = c̄ ± 1.96·s/√n** (clamp 0–100%). Run **rNPV sensitivity** at ±1 SD on penetration, net price, PoS, discount → report rNPV range. Cross-check rNPV against deal-comp band. Verdict: commercial-confidence band + rNPV range vs held-out benchmark.

## Guardrails
No hallucination · public-only · Paperclip + patents + CGT consulting/XBI only · clickable sources mandatory · two signals never collapsed · state every model assumption · landscape must feed the financials · run after FDA-review skills · one asset at a time · evalbench + rNPV sensitivity last.
