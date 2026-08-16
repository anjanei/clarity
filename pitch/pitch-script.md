# CLARITY — five-minute pitch

Spoken script, ~740 words, ~150 wpm. Slide cues in brackets. Timings are cumulative.

Everything stated here is checkable against the repo. Numbers with sources are marked; the
two placeholder lines at the end are the only things you must fill in yourself.

---

### 0:00 — Open cold [Slide 1 · Title]

> Ninety-two out of every hundred drugs that enter human trials never reach a patient.
>
> Not because the science was bad. Often nobody could tell in time.
>
> I'm building CLARITY. It's an FDA-grade review room for clinical trials. You point it at a
> registry ID, and it hands back the file a reviewer would want on their desk — with every
> claim in it traceable to a document you can open.

*Beat. Don't rush the number.*

---

### 0:30 — The stake [Slide 2 · 92 of 100]

> That 7.9% success rate is BIO's, across a decade. The capitalised cost of getting one
> survivor across the line is 2.6 billion dollars.
>
> Behind those numbers is a queue. A child with transfusion-dependent beta-thalassemia is on
> a four-weekly transfusion schedule and an iron chelator for life. In our catalog right now
> there are 118 programmes that might change a trajectory like that — and almost all of them
> are Phase 1. The stage where nobody outside the sponsor can separate the promising from the
> doomed.

---

### 1:05 — Who is stuck [Slide 3 · The bottleneck]

> The people whose job is to separate them — licensing teams, translational investors, a
> foundation deciding where its grant goes — are all doing the same task by hand today, in a
> browser with forty tabs open.
>
> Read the registry record. Find the Phase 1 publication, if it exists. Pull the FDA review
> package for the nearest approved product. Form a probability. Then justify it to someone who
> *will* ask "where did that come from?"
>
> Several days of specialist time. Not reproducible. Two analysts reading the same literature
> reach different numbers, and neither can hand over the trail that got them there.
>
> **The bottleneck on capital reaching good science is not intelligence. It is audit.**

---

### 1:50 — Why the obvious thing fails [Slide 4 · It will answer]

> So — ask a language model. It will answer.
>
> It will answer well about pembrolizumab. And it will answer with *identical confidence*
> about the Phase 1/2 allogeneic CAR-T that filed its first registry record eleven weeks ago
> and has published nothing. Same fluent register. No signal at all separating the recalled
> fact from the plausible invention.
>
> In a regulatory context that's worse than useless. An opinion you cannot audit is not a weak
> opinion — it's a liability that looks like an asset.

---

### 2:25 — The insight [Slide 5 · Three stages]

> Here's our insight. That's not a reasoning failure. It's a **provenance** failure.
>
> So CLARITY splits the two jobs apart and never lets them touch. Retrieval is one system —
> Paperclip, over registries, FDA reviews, PMC. Extraction is a second pass that sees only one
> domain's evidence packet and must attach a public identifier to every finding. Scoring is a
> third pass that sees only the trial record and the cited dossier. Never the open internet.
> Never its own recall.
>
> Nothing on the report comes from the model's memory. If the evidence doesn't exist, the
> report says so — and the score goes down.

---

### 3:05 — Proof [Slide 6 · The lab] [Slide 7 · One claim opened]

> That constraint is the product, so we made it inspectable. This is the workstation. The graph
> in the middle isn't an animation playing next to the run — it *is* the run. A stage that never
> fires never lights. Every retrieval attaches the document it found, so the graph visibly grows.
>
> And you can press *proof* on any claim. Claim, to the citations, to the extraction with its own
> confidence and reasoning, to the literal search command that retrieved it, to the model and
> rubric version that scored it. Five clicks from a number on a dashboard to a shell command you
> can paste. Every claim has this — not a sample. All of them.

---

### 3:50 — The uncomfortable demo [Slide 8 · CS-101]

> Let me show you the run I'm least comfortable with, because it's the one that makes the case.
>
> CS-101, a base-edited cell therapy for beta-thalassemia. CLARITY returns 40%, range 24 to 56,
> confidence **low**. Nine of ten rubric dimensions come back marked *absent*. The one that scores
> well is about the disease — thirty years of literature. Every dimension about the *product*
> scores 2 out of 5, because the clinical data for this construct isn't public yet.
>
> A system that returns 40% and shows you exactly which nine boxes are empty has told you
> something true and actionable. You now know precisely what to ask the sponsor for. A system
> that returns a confident 68% by quietly borrowing Casgevy's safety profile has told you
> nothing — twice.
>
> And that ceiling is enforced in code, not in a prompt. Absent evidence cannot score above 3.
> A point estimate cannot fall outside its own stated range. You can watch both bite.

---

### 4:35 — Close [Slide 11 · Why it holds] [Slide 12 · Ask]

> The rubric is ten weighted dimensions and the module refuses to load if the weights don't sum
> to one. The nine evidence domains are phase-gated, so a preclinical asset is never asked for
> postmarketing controls it can't have. Zero third-party JavaScript reaches the browser. Every
> run leaves an audit record.
>
> **[FILL IN: the raise, the round, the use of funds.]**
>
> What I want from this room: introductions to licensing teams, translational investors and
> disease foundations who will run their own programme through it and argue with the number.
> Because the whole point is that now they can.
>
> **[FILL IN: your name, contact, live URL.]**

---

## Delivery notes

- **The 40% is the pitch, not the demo.** Resist showing the prettiest run. The CS-101 slide is
  where a technical audience decides you are honest.
- **Say "audit" early and repeat it.** It is the one word that reframes the category from
  "another AI research tool" to infrastructure.
- **Do not oversell the model.** The credible claim is the *architecture* — three stages that
  cannot see each other — not that the reasoning is superhuman.
- **If you get one question, expect this one:** "How do you know the score is right?" The answer
  is that you don't, and that is the design: the score is a position with its trail attached so a
  specialist can overrule it in minutes instead of rebuilding it in days.
- **Cut for time, in this order:** Slide 9 (calibration table), then Slide 3, then the second half
  of Slide 11. Never cut Slide 8.
