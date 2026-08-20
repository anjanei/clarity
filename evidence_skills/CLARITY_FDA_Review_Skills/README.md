# CLARITY — Final Skillset (v4.0.0)

Unified skillset: **9 FDA-review domain skills + orchestrator + a commercial-viability skill**. The agent loads **orchestrator + one skill at a time** — small context, less hallucination.

## Two-stage design
1. **FDA Review (skills 1–9):** *"Is this molecule/program regulatorily sound?"*
2. **Commercial Viability (skill 10):** *"Given it's sound — is it worth pursuing, and where's the money?"* Runs after stage 1.

## What's inside
```
CLARITY_Final_Skillset/
├── manifest.json · validate.py
├── 00_orchestrator/SKILL.md            ← load FIRST (routes to 1–10)
├── 01…09_*/SKILL.md                     ← FDA review domains
└── 10_commercial_viability/SKILL.md     ← commercial companion
```

## Cross-cutting rules (all skills)
- **Cumulative phase flow:** Pre-clinical → P1 → P2 → P3 → **P4** (as applicable); each phase carries prior findings forward.
- **Two-signal confidence:** Evidence Directness + Inference Strength, never merged (e.g., "approval implies validation" → Directness ~30% / Inference ~85%).
- **Evalbench last:** dataset **Overall Confidence (95% CI)**; commercial adds an **rNPV sensitivity** band.
- **Sources:** Paperclip MCP (+ patents/EDGAR/CGT-consulting/XBI for commercial); clickable, mandatory; references inline at table bottom.

## Commercial skill (10) — mandated output
Renders **one landscape page, 4 labeled tables + references**:
- **Table 1** Market Size Funnel & Price Build
- **Table 2** Landscape → Financial Adjusters *(landscape DRIVES the model)*
- **Table 3** 5-Yr Penetration & rNPV *(net price, penetration ceiling, PoS, partner-share inherited from Table 2)*
- **Table 4** Evalbench: rNPV Sensitivity & Confidence

## Data routing
| Data | Sources |
|---|---|
| Pre-clinical | PubMed, arXiv |
| Clinical (P1–4) | clinicaltrials.gov, intl registries, FDA + PubMed, arXiv |
| Commercial | Paperclip + Google Patents/USPTO/EPO + Orange/Purple Book + SEC EDGAR + CGT consulting reports + XBI/peers |

## Phase × Domain activation (cumulative)
✅ = produces output · — = `Do not generate`

| Domain | Pre-clin | P1 | P2 | P3 | P4 |
|---|:--:|:--:|:--:|:--:|:--:|
| Disease Context & Mechanism | ✅ | ✅ | ✅ | ✅ | ✅ |
| Trial Design | — | ✅ | ✅ | ✅ | ✅ |
| Acute Safety & Tolerability | ✅ | ✅ | ✅ | ✅ | ✅ |
| Long-Term Genetic Risk | — | — | ✅ | ✅ | ✅ |
| Biodistribution & Pharmacology | — | ✅ | ✅ | ✅ | ✅ |
| Immunogenicity & Special Populations | — | ✅ | ✅ | ✅ | ✅ |
| Product Quality & CMC | ✅ | ✅ | ✅ | ✅ | ✅ |
| Trial Integrity, Governance & Operational Infrastructure | — | ✅ | ✅ | ✅ | ✅ |
| Benefit–Risk & Postmarketing Controls | — | — | — | ✅ | ✅ |

---
CLARITY · Track A "AI Scientist" · Track B meta-analysis · v4.0.0
