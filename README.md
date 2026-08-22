<div align="center">

# CLARITY

### An FDA-grade review room for clinical trials.

**CLARITY turns public clinical trial records into an audited, cited regulatory dossier — combining registry facts, FDA precedents, and primary literature into an evidence-grounded risk assessment.**

[![Live](https://img.shields.io/badge/live-Render-2DD4BF?style=for-the-badge&labelColor=0B1120)](https://fdaapproval-pzpr.onrender.com/?trial=NCT05951205)
&nbsp;
[![Node](https://img.shields.io/badge/node-20%2B-6EE7A0?style=for-the-badge&labelColor=0B1120)](https://nodejs.org)
&nbsp;
![Browser dependencies](https://img.shields.io/badge/browser_dependencies-zero-F0A07A?style=for-the-badge&labelColor=0B1120)
&nbsp;
![Tests](https://img.shields.io/badge/tests-63_passing-6EE7A0?style=for-the-badge&labelColor=0B1120)

*Evidence retrieval by **Paperclip** · Reasoning by **Claude** · Structure by **Benchling** & **Modal***

</div>

---

## Overview

Evaluating clinical-stage biotechnology assets requires days of manual synthesis across clinical trial registries, FDA approval packages, scientific literature, and genetic construct data. 

**CLARITY automates this workflow with strict provenance:**
- **Zero Hallucinated Facts:** The evaluation sees *only* retrieved, cited evidence. If data has not been published, the system explicitly reports it as missing and discounts the score.
- **Auditable Provenance:** Every claim in the review links directly to its source document (PubMed ID, PMC article, FDA approval document, or registry record).
- **Interactive Workstation:** Features a custom 3D evidence graph, construct architecture viewer, calibrated probability-of-success calculations, and verbatim grounding drawers.

---

## Architecture & How It Works

```
 ┌────────────────────────────────┐
 │     1. Multi-Source Retrieval   │  Paperclip MCP (ClinicalTrials.gov, FDA,
 │       (Registries & Papers)    │  PMC, bioRxiv, arXiv, international registries)
 └───────────────┬────────────────┘
                 ▼
 ┌────────────────────────────────┐
 │    2. Domain-Specific Synthesis │  Claude extracts structured findings across
 │        (9 CLARITY Domains)     │  phase-gated regulatory domains with exact citations
 └───────────────┬────────────────┘
                 ▼
 ┌────────────────────────────────┐
 │     3. Guardrailed Evaluation   │  Scored against a 10-dimension weighted rubric
 │    (Approval Probability & Dims)│  with hard score ceilings for missing evidence
 └───────────────┬────────────────┘
                 ▼
 ┌────────────────────────────────┐
 │   4. Interactive Workstation   │  Live 3D evidence graph, Benchling construct viewer,
 │    (Graph, Proof, Benchmarks)  │  Modal GPU protein folding, and verbatim grounding
 └────────────────────────────────┘
```

---

## The Evaluation Framework

### 1. The 9 Evidence Domains (Phase-Gated)
Evidence is extracted through specialized domain policies tailored to asset development stage:
- **Disease Context & Mechanism** *(Preclinical+)*: Pathophysiology, target validation, and therapeutic rationale.
- **Acute Safety & Tolerability** *(Preclinical+)*: Toxicities, adverse events, dose-limiting toxicities.
- **Product Quality & CMC** *(Preclinical+)*: Manufacturing, purity, potency, scalability.
- **Trial Design & Regulatory Strategy** *(Phase 1+)*: Endpoints, cohort sizing, control arms, FDA precedence.
- **Biodistribution & Pharmacology** *(Phase 1+)*: PK/PD, tissue tropism, cellular persistence, shedding.
- **Immunogenicity & Special Populations** *(Phase 1+)*: ADA, cytokine release, preexisting neutralizing antibodies.
- **Trial Integrity & Governance** *(Phase 1+)*: DSMB oversight, protocol adherence, audit history.
- **Long-Term Genetic Risk** *(Phase 2+)*: Insertional mutagenesis, off-target cleavage, chromosomal integrity.
- **Benefit–Risk & Postmarketing** *(Phase 3+)*: Long-term efficacy, REMS, post-marketing commitments.

### 2. The 10-Dimension Rubric
Reviews are scored (1–5) across ten weighted dimensions:

| Dimension | Weight | Focus Area |
| :--- | :---: | :--- |
| **Efficacy & Clinical Evidence** | 22% | Primary and secondary clinical endpoints, biomarker response |
| **Safety & Tolerability** | 20% | SAE rates, DLT profiles, off-target clinical toxicity |
| **Long-Term Genetic Risk** | 10% | Vector persistence, genomic stability, oncogenic risk |
| **Biodistribution & Pharmacology** | 10% | Target tissue delivery, clearance, exposure kinetics |
| **Manufacturability & CMC** | 10% | Batch consistency, release criteria, delivery formulation |
| **PK/PD & Dosing** | 8% | Dose-response relationship, target engagement saturation |
| **Trial Design & Regulatory Strategy** | 7% | Statistical power, FDA precedent alignment, surrogate validity |
| **Disease Context & Mechanism** | 5% | Target biological rationale, natural history baseline |
| **Immunogenicity** | 5% | Humoral/cellular host immune response, neutralization |
| **Trial Integrity & Governance** | 3% | Data monitoring, sponsor track record, study protocol rigor |

---

## Key Capabilities

- 🧬 **Interactive 3D Visualizer:** Zero-dependency custom canvas engine visualizing the entire evidence network and construct architecture.
- 🔍 **Verbatim Provenance Drawer:** Five clicks from an approval probability score down to the raw search command, excerpt, and source URL.
- 🧪 **Sequence & Molecular Inspection:** Integrates with Benchling for construct maps and Modal for GPU-accelerated 3D protein folding (ESMFold/Boltz).
- ⚖️ **Benchmark Calibration:** Compares trial risk scores against historical trial distributions.

---

## Quickstart

### Prerequisites
- Node.js 20+
- Anthropic API Key (for Claude evaluation)
- Paperclip API Key (for MCP retrieval)
- *(Optional)* Modal & Benchling API keys (for 3D folding and live construct fetching)

### Setup & Run
```bash
# 1. Clone the repository
git clone https://github.com/anjanei/clarity.git
cd clarity

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your API keys

# 4. Start local development server
npm run dev
```

Visit `http://localhost:3000` to interact with the workstation.

### Run Tests & CLI
```bash
# Run unit and integration test suite
npm test

# Run an evaluation directly from CLI
npm run review -- NCT05951205
```

---

## Deployment

CLARITY is configured for one-click deployment on [Render](https://render.com) via `render.yaml`.

- **Live URL:** [https://fdaapproval-pzpr.onrender.com/?trial=NCT05951205](https://fdaapproval-pzpr.onrender.com/?trial=NCT05951205)

---

## Disclaimer

CLARITY is an AI-powered regulatory intelligence and decision-support tool built on publicly accessible clinical literature and trial registries. It does not constitute formal FDA regulatory advice or medical recommendations.
