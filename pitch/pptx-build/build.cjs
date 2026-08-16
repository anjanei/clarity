const pptxgen = require("pptxgenjs");

/* ==========================================================================
   CLARITY — pitch deck (.pptx)

   Mirrors pitch/deck.html: same content, same palette logic (one accent per
   slide, drawn from the product's own semantic colors — cyan/retrieval,
   coral/reasoning, lime/structure, amber/gold for the risk read, red for the
   uncomfortable slide). Committed to one dark world throughout, on purpose:
   this is a presentation instrument, and a deck that flips to white mid-talk
   is a worse deck.
   ========================================================================== */

const C = {
  ground: "13161F",
  panel: "1B2029",
  panel2: "1F2530",
  edge: "2C3341",
  ink: "F5F7FA",
  muted: "B7C0D0",
  faint: "8993A6",
  ghost: "5C6577",

  clip: "5EEAE0", // retrieval — cyan
  claude: "F0A07A", // reasoning — coral
  bench: "8FE8A0", // structure — lime
  reg: "E8C15E", // amber
  stop: "E2554A", // red
  lit: "B7A8F0", // violet
};

const FONT_HEAD = "Century Schoolbook";
const FONT_BODY = "Calibri";
const FONT_MONO = "Courier New";

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9"; // 10in x 5.625in — matches the HTML deck's 960x540
pres.defineLayout({ name: "CLARITY_16x9", width: 10, height: 5.625 });
pres.layout = "CLARITY_16x9";

const PW = 10;
const PH = 5.625;
const MARGIN = 0.5;

/* -- shared builders ------------------------------------------------------- */

function baseSlide(accent) {
  const slide = pres.addSlide();
  slide.background = { color: C.ground };
  return slide;
}

function eyebrow(slide, text, accent, y = 0.42) {
  slide.addText(text.toUpperCase(), {
    x: MARGIN,
    y,
    w: PW - MARGIN * 2,
    h: 0.3,
    fontFace: FONT_MONO,
    fontSize: 10.5,
    color: accent,
    bold: true,
    charSpacing: 3,
    margin: 0,
  });
}

function title(slide, runs, y = 0.78, size = 30, w = PW - MARGIN * 2) {
  slide.addText(runs, {
    x: MARGIN,
    y,
    w,
    h: 1.15,
    fontFace: FONT_HEAD,
    fontSize: size,
    color: C.ink,
    valign: "top",
    margin: 0,
    lineSpacingMultiple: 1.04,
  });
}

function dot(slide, x, y, color, size = 0.1) {
  slide.addShape("ellipse", { x, y, w: size, h: size, fill: { color }, line: { type: "none" } });
}

function card(slide, { x, y, w, h, accent }) {
  slide.addShape("roundRect", {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: { color: C.panel },
    line: { color: C.edge, width: 0.75 },
    shadow: { type: "outer", color: "000000", opacity: 0.35, blur: 10, offset: 3, angle: 90 },
  });
}

function stat(slide, x, y, w, n, k, d, accent) {
  slide.addText(n, {
    x,
    y,
    w,
    h: 0.62,
    fontFace: FONT_MONO,
    fontSize: 34,
    bold: false,
    color: accent,
    margin: 0,
    valign: "bottom",
  });
  slide.addText(k.toUpperCase(), {
    x,
    y: y + 0.6,
    w,
    h: 0.28,
    fontFace: FONT_MONO,
    fontSize: 9,
    color: C.faint,
    charSpacing: 2,
    margin: 0,
  });
  if (d) {
    slide.addText(d, {
      x,
      y: y + 0.88,
      w,
      h: 0.55,
      fontFace: FONT_BODY,
      fontSize: 10.5,
      color: C.muted,
      margin: 0,
      valign: "top",
    });
  }
}

function footerPage(slide, n) {
  slide.addText(`${String(n).padStart(2, "0")} / 13`, {
    x: PW - 1.1,
    y: PH - 0.34,
    w: 0.9,
    h: 0.26,
    fontFace: FONT_MONO,
    fontSize: 8,
    color: C.ghost,
    align: "right",
    margin: 0,
  });
  slide.addText("CLARITY", {
    x: MARGIN,
    y: PH - 0.34,
    w: 2,
    h: 0.26,
    fontFace: FONT_MONO,
    fontSize: 8,
    color: C.ghost,
    charSpacing: 2,
    margin: 0,
  });
}

/* ========================================================================
   1 — Title
   ======================================================================== */
{
  const s = baseSlide();
  eyebrow(s, "Evidence retrieval by Paperclip · reasoning by Claude · structure by Benchling", C.clip, 0.5);
  s.addText(
    [
      { text: "An FDA-grade ", options: { color: C.ink } },
      { text: "review room", options: { color: C.ink, bold: true } },
      { text: " for clinical trials.", options: { color: C.ink } },
    ],
    {
      x: MARGIN,
      y: 1.15,
      w: PW - MARGIN * 2 - 0.6,
      h: 1.7,
      fontFace: FONT_HEAD,
      fontSize: 40,
      lineSpacingMultiple: 1.02,
      margin: 0,
      valign: "top",
    },
  );
  s.addText(
    "Point it at a registry ID. CLARITY turns the public record into the file a reviewer would want on their desk — registry facts, FDA precedent, primary literature, a cited nine-domain dossier, and an approval-risk call that shows the weakest argument first.",
    {
      x: MARGIN,
      y: 2.85,
      w: 7.6,
      h: 1.05,
      fontFace: FONT_BODY,
      fontSize: 13.5,
      color: C.muted,
      lineSpacingMultiple: 1.28,
      margin: 0,
    },
  );
  const statW = 2.7;
  stat(s, MARGIN, 4.05, statW, "118", "programmes in catalog", null, C.clip);
  stat(s, MARGIN + statW + 0.3, 4.05, statW, "10", "weighted rubric dimensions", null, C.clip);
  stat(s, MARGIN + (statW + 0.3) * 2, 4.05, statW, "0", "third-party scripts in browser", null, C.clip);
  footerPage(s, 1);
}

/* ========================================================================
   2 — The stake
   ======================================================================== */
{
  const s = baseSlide();
  eyebrow(s, "The stake", C.stop);
  title(s, [
    { text: "92", options: { bold: true } },
    { text: " of every " },
    { text: "100", options: { bold: true } },
    { text: " drugs that enter human trials never reach a patient." },
  ]);
  const statW = 2.8;
  stat(s, MARGIN, 2.15, statW, "7.9%", "Phase I → approval", "Across a decade of development programmes.", C.stop);
  stat(s, MARGIN + statW + 0.35, 2.15, statW, "$2.6B", "capitalised cost per survivor", "What it takes to get one across the line.", C.stop);
  stat(
    s,
    MARGIN + (statW + 0.35) * 2,
    2.15,
    statW,
    "95",
    "of our 118 are Phase 1 or 1/2",
    "The stage where nobody outside the sponsor can separate promising from doomed.",
    C.stop,
  );
  s.addText(
    "Behind those numbers is a queue. A child with transfusion-dependent β-thalassemia is on a four-weekly transfusion schedule and an iron chelator for life.",
    { x: MARGIN, y: 4.15, w: PW - MARGIN * 2, h: 0.65, fontFace: FONT_BODY, fontSize: 13, color: C.muted, margin: 0, lineSpacingMultiple: 1.3 },
  );
  s.addText(
    "Success rate: BIO / Informa / QLS, Clinical Development Success Rates 2011–2020. Cost: DiMasi, Grabowski & Hansen, J Health Econ 47:20–33, 2016. Phase mix: this repository's catalog.",
    { x: MARGIN, y: 5.0, w: PW - MARGIN * 2, h: 0.4, fontFace: FONT_MONO, fontSize: 8, color: C.ghost, margin: 0, lineSpacingMultiple: 1.4 },
  );
  footerPage(s, 2);
}

/* ========================================================================
   3 — The bottleneck
   ======================================================================== */
{
  const s = baseSlide();
  eyebrow(s, "Who is stuck", C.reg);
  title(s, [
    { text: "A licensing team, a translational investor and a foundation are all doing " },
    { text: "the same task by hand", options: { bold: true } },
    { text: " today." },
  ], 0.78, 26);

  card(s, { x: MARGIN, y: 2.05, w: 5.4, h: 3.0, accent: C.reg });
  s.addText(
    [
      { text: "●  ", options: { color: C.reg, fontSize: 10 } },
      { text: "The job, as done now", options: { bold: true, fontSize: 13, color: C.ink } },
    ],
    { x: MARGIN + 0.3, y: 2.25, w: 4.8, h: 0.35, fontFace: FONT_BODY, margin: 0 },
  );
  s.addText(
    "Read the registry record. Find the Phase 1 publication, if it exists. Pull the FDA review package for the nearest approved product in the class. Notice nobody published per-cohort dosing. Form a probability. Write it down.",
    { x: MARGIN + 0.3, y: 2.65, w: 4.8, h: 1.35, fontFace: FONT_BODY, fontSize: 11.5, color: C.muted, margin: 0, lineSpacingMultiple: 1.35 },
  );
  s.addText(
    [
      { text: "Then justify it to someone who ", options: { color: C.ink } },
      { text: "will", options: { italic: true, color: C.ink } },
      { text: " ask “where did that come from?”", options: { color: C.ink } },
    ],
    { x: MARGIN + 0.3, y: 4.05, w: 4.8, h: 0.85, fontFace: FONT_BODY, fontSize: 12, bold: true, margin: 0, lineSpacingMultiple: 1.3 },
  );

  stat(s, 6.2, 2.15, 3.3, "days", "of specialist time, per programme", null, C.reg);
  stat(s, 6.2, 3.15, 3.3, "0", "of it reproducible", "Two analysts reading the same literature reach different numbers, and neither can hand over the trail that got them there.", C.reg);

  s.addShape("line", { x: MARGIN, y: 5.12, w: 0, h: 0.42, line: { color: C.reg, width: 2.25 } });
  s.addText(
    [
      { text: "The bottleneck on capital reaching good science is not intelligence. It is ", options: { color: C.ink } },
      { text: "audit", options: { bold: true, color: C.ink } },
      { text: ".", options: { color: C.ink } },
    ],
    { x: MARGIN + 0.22, y: 5.02, w: 8.5, h: 0.5, fontFace: FONT_HEAD, fontSize: 15, margin: 0, valign: "middle" },
  );
  footerPage(s, 3);
}

/* ========================================================================
   4 — Why LLMs fail
   ======================================================================== */
{
  const s = baseSlide();
  eyebrow(s, "The obvious solution, and how it fails", C.stop);
  title(s, [{ text: "Ask a language model. " }, { text: "It will answer.", options: { bold: true } }]);

  const cw = 4.35;
  card(s, { x: MARGIN, y: 2.1, w: cw, h: 1.55, accent: C.bench });
  s.addText(
    [
      { text: "●  ", options: { color: C.bench, fontSize: 10 } },
      { text: "Pembrolizumab", options: { bold: true, fontSize: 13, color: C.ink } },
    ],
    { x: MARGIN + 0.3, y: 2.28, w: cw - 0.6, h: 0.32, margin: 0 },
  );
  s.addText("Decades of published trials, labels and review packages. The model answers well.", {
    x: MARGIN + 0.3,
    y: 2.65,
    w: cw - 0.6,
    h: 0.9,
    fontFace: FONT_BODY,
    fontSize: 11.5,
    color: C.muted,
    margin: 0,
    lineSpacingMultiple: 1.3,
  });

  card(s, { x: MARGIN + cw + 0.3, y: 2.1, w: cw, h: 1.55, accent: C.stop });
  s.addText(
    [
      { text: "●  ", options: { color: C.stop, fontSize: 10 } },
      { text: "A Phase 1/2 allogeneic CAR-T, 11 weeks old", options: { bold: true, fontSize: 13, color: C.ink } },
    ],
    { x: MARGIN + cw + 0.6, y: 2.28, w: cw - 0.6, h: 0.55, margin: 0, lineSpacingMultiple: 1.1 },
  );
  s.addText(
    [
      { text: "First registry record filed. Nothing published. The model answers with " },
      { text: "identical confidence", options: { italic: true } },
      { text: "." },
    ],
    { x: MARGIN + cw + 0.6, y: 2.9, w: cw - 0.6, h: 0.65, fontFace: FONT_BODY, fontSize: 11.5, color: C.muted, margin: 0, lineSpacingMultiple: 1.3 },
  );

  s.addText(
    [
      { text: "Same fluent register. Same air of authority. ", options: { color: C.muted } },
      { text: "No signal whatsoever", options: { bold: true, color: C.ink } },
      { text: " distinguishing the recalled fact from the plausible invention.", options: { color: C.muted } },
    ],
    { x: MARGIN, y: 3.95, w: PW - MARGIN * 2, h: 0.6, fontFace: FONT_BODY, fontSize: 13, margin: 0, lineSpacingMultiple: 1.3 },
  );

  s.addShape("line", { x: MARGIN, y: 5.12, w: 0, h: 0.42, line: { color: C.stop, width: 2.25 } });
  s.addText(
    [
      { text: "An opinion you cannot audit is not a weak opinion — it is ", options: { color: C.ink } },
      { text: "a liability that looks like an asset", options: { bold: true, color: C.ink } },
      { text: ".", options: { color: C.ink } },
    ],
    { x: MARGIN + 0.22, y: 5.0, w: 8.6, h: 0.55, fontFace: FONT_HEAD, fontSize: 14.5, margin: 0, valign: "middle", lineSpacingMultiple: 1.08 },
  );
  footerPage(s, 4);
}

/* ========================================================================
   5 — The insight (3-stage pipeline)
   ======================================================================== */
{
  const s = baseSlide();
  eyebrow(s, "The insight", C.clip);
  title(s, [{ text: "It is not a reasoning failure. It is a " }, { text: "provenance", options: { bold: true } }, { text: " failure." }]);

  const stages = [
    { tone: C.clip, who: "Retrieval · Paperclip", strong: "Find everything public", body: "Registries, FDA reviews, PMC and bioRxiv, US and international trial indexes.", sees: "Whatever this returns is the entire universe of available facts." },
    { tone: C.claude, who: "Extraction · 9 domains", strong: "One pass per domain", body: "Each pass sees only its own domain's evidence packet. Every finding must carry a public identifier.", sees: "“Not found in public sources” when it cannot be sourced." },
    { tone: C.reg, who: "Scoring · 10 dimensions", strong: "Judge only what was cited", body: "Sees the trial record and the cited dossier. Never the open internet. Never its own recall.", sees: "A score that can only rest on something a reader can open." },
  ];
  const cw = 2.87;
  stages.forEach((st, i) => {
    const x = MARGIN + i * (cw + 0.2);
    card(s, { x, y: 2.05, w: cw, h: 2.55, accent: st.tone });
    s.addShape("rect", { x, y: 2.05, w: cw, h: 0.045, fill: { color: st.tone }, line: { type: "none" } });
    dot(s, x + 0.22, 2.32, st.tone, 0.09);
    s.addText(st.who.toUpperCase(), {
      x: x + 0.4,
      y: 2.24,
      w: cw - 0.55,
      h: 0.26,
      fontFace: FONT_MONO,
      fontSize: 8.5,
      color: st.tone,
      bold: true,
      charSpacing: 1.5,
      margin: 0,
    });
    s.addText(st.strong, { x: x + 0.22, y: 2.55, w: cw - 0.44, h: 0.35, fontFace: FONT_HEAD, fontSize: 14.5, color: C.ink, margin: 0 });
    s.addText(st.body, { x: x + 0.22, y: 2.95, w: cw - 0.44, h: 0.95, fontFace: FONT_BODY, fontSize: 10.5, color: C.muted, margin: 0, lineSpacingMultiple: 1.3 });
    s.addShape("line", { x: x + 0.22, y: 4.08, w: cw - 0.44, h: 0, line: { color: C.edge, width: 0.75, dashType: "dash" } });
    s.addText(st.sees, { x: x + 0.22, y: 4.16, w: cw - 0.44, h: 0.42, fontFace: FONT_MONO, fontSize: 8.5, color: C.faint, margin: 0, lineSpacingMultiple: 1.3 });
  });

  s.addShape("line", { x: MARGIN, y: 5.12, w: 0, h: 0.42, line: { color: C.clip, width: 2.25 } });
  s.addText(
    [
      { text: "Nothing on the report comes from the model's recall — if the evidence does not exist, the report says so, ", options: { color: C.ink } },
      { text: "and the score goes down", options: { bold: true, color: C.ink } },
      { text: ".", options: { color: C.ink } },
    ],
    { x: MARGIN + 0.22, y: 5.0, w: 8.6, h: 0.55, fontFace: FONT_HEAD, fontSize: 13, margin: 0, valign: "middle", lineSpacingMultiple: 1.1 },
  );
  footerPage(s, 5);
}

/* ========================================================================
   6 — How it works, in plain language
   ======================================================================== */
{
  const s = baseSlide();
  eyebrow(s, "The same idea, without the jargon", C.clip);
  title(s, [{ text: "What happens when you press " }, { text: "run", options: { bold: true } }, { text: "." }]);

  const steps = [
    [C.clip, "STEP 1", "Find", ["Search everything ever published", "about this drug — registries,", "FDA files, medical journals."]],
    [C.claude, "STEP 2", "Read", ["Go topic by topic and write down", "what is known — pinning the", "source to every single fact."]],
    [C.reg, "STEP 3", "Judge", ["Score it against the same fixed", "checklist every time, using only", "those sourced notes."]],
  ];

  const y = 2.0;
  const h = 1.35;
  const cw = 2.35;
  const x0 = 1.0;
  const gap = 0.22;

  // you give it
  s.addShape("roundRect", { x: MARGIN - 0.05, y: y + 0.42, w: 0.85, h: 0.55, rectRadius: 0.06, fill: { color: "0D0F14" }, line: { color: C.edge, width: 0.75 } });
  s.addText("YOU GIVE IT", { x: MARGIN + 0.02, y: y + 0.46, w: 0.75, h: 0.2, fontFace: FONT_MONO, fontSize: 6.5, color: C.faint, charSpacing: 1, margin: 0 });
  s.addText("a trial number", { x: MARGIN + 0.02, y: y + 0.65, w: 0.78, h: 0.24, fontFace: FONT_BODY, fontSize: 8.5, color: C.muted, margin: 0 });

  steps.forEach(([tone, step, head, body], i) => {
    const x = x0 + i * (cw + gap);
    s.addShape("roundRect", { x, y, w: cw, h, rectRadius: 0.09, fill: { color: C.panel }, line: { color: tone, width: 1 } });
    s.addText(step, { x: x + 0.16, y: y + 0.12, w: cw - 0.32, h: 0.22, fontFace: FONT_MONO, fontSize: 7.5, color: tone, bold: true, charSpacing: 2, margin: 0 });
    s.addText(head, { x: x + 0.16, y: y + 0.32, w: cw - 0.32, h: 0.34, fontFace: FONT_HEAD, fontSize: 19, color: C.ink, margin: 0 });
    s.addText(body.join("\n"), {
      x: x + 0.16,
      y: y + 0.7,
      w: cw - 0.28,
      h: 0.58,
      fontFace: FONT_BODY,
      fontSize: 9.5,
      color: C.muted,
      margin: 0,
      lineSpacingMultiple: 1.24,
      valign: "top",
    });
    // arrow into the next step
    if (i < steps.length - 1) {
      s.addShape("rightArrow", {
        x: x + cw + 0.03,
        y: y + h / 2 - 0.06,
        w: gap - 0.06,
        h: 0.12,
        fill: { color: C.faint },
        line: { type: "none" },
      });
    }
  });

  // you get
  const gx = x0 + 3 * (cw + gap) + 0.03;
  s.addShape("rightArrow", { x: gx - 0.2, y: y + h / 2 - 0.06, w: 0.16, h: 0.12, fill: { color: C.faint }, line: { type: "none" } });
  s.addShape("roundRect", { x: gx, y: y + 0.28, w: 1.28, h: 0.84, rectRadius: 0.07, fill: { color: C.panel }, line: { color: C.bench, width: 1 } });
  s.addText("YOU GET", { x: gx + 0.13, y: y + 0.33, w: 1.05, h: 0.2, fontFace: FONT_MONO, fontSize: 6.5, color: C.bench, charSpacing: 1.5, margin: 0 });
  s.addText("a score, and a report where every line is clickable", {
    x: gx + 0.13,
    y: y + 0.52,
    w: 1.05,
    h: 0.56,
    fontFace: FONT_BODY,
    fontSize: 8.5,
    color: C.muted,
    margin: 0,
    lineSpacingMultiple: 1.2,
    valign: "top",
  });

  // the one constraint that matters
  s.addShape("roundRect", {
    x: x0,
    y: y + h + 0.16,
    w: cw * 3 + gap * 2,
    h: 0.34,
    rectRadius: 0.05,
    fill: { type: "none" },
    line: { color: C.stop, width: 1, dashType: "dash" },
  });
  s.addText("each step is only ever shown what the step before it found", {
    x: x0,
    y: y + h + 0.16,
    w: cw * 3 + gap * 2,
    h: 0.34,
    fontFace: FONT_MONO,
    fontSize: 9,
    color: C.stop,
    align: "center",
    valign: "middle",
    margin: 0,
  });

  s.addShape("line", { x: MARGIN, y: 5.02, w: 0, h: 0.5, line: { color: C.clip, width: 2.25 } });
  s.addText(
    [
      { text: "So nothing in the report can come from the model's memory. If the evidence isn't out there, it says so — ", options: { color: C.ink } },
      { text: "and the score goes down.", options: { bold: true, color: C.ink } },
    ],
    { x: MARGIN + 0.22, y: 4.94, w: 8.7, h: 0.6, fontFace: FONT_HEAD, fontSize: 13, margin: 0, valign: "middle", lineSpacingMultiple: 1.1 },
  );
  footerPage(s, 6);
}

/* ========================================================================
   7 — The lab
   ======================================================================== */
{
  const s = baseSlide();
  eyebrow(s, "The product", C.bench);
  title(s, [{ text: "The graph in the middle is not a picture of the run. " }, { text: "It is the run.", options: { bold: true } }], 0.78, 26);

  const items = [
    ["Nodes light in the order the server actually works.", "A stage that never fires never lights."],
    ["The graph grows.", "Every retrieval attaches the document it found — 15 nodes idle, 34 with a full dossier."],
    ["Every node with structure opens into its own graph.", "The review becomes the weighted rubric as a body with mass."],
    ["The construct renders in space.", "Feature architecture on the turns, from a sequence the server actually returned."],
  ];
  let y = 2.05;
  items.forEach(([b, r]) => {
    s.addText("▸", { x: MARGIN, y, w: 0.25, h: 0.5, color: C.bench, fontFace: FONT_MONO, fontSize: 12, margin: 0 });
    s.addText([{ text: b + " ", options: { bold: true, color: C.ink } }, { text: r, options: { color: C.muted } }], {
      x: MARGIN + 0.28,
      y,
      w: 5.15,
      h: 0.62,
      fontFace: FONT_BODY,
      fontSize: 11,
      margin: 0,
      lineSpacingMultiple: 1.25,
      valign: "top",
    });
    y += 0.65;
  });
  s.addText(
    "2,356 lines of first-party rendering code. No WebGL library, no CDN, no third-party JavaScript in the browser at all.",
    { x: MARGIN, y: 4.75, w: 5.15, h: 0.55, fontFace: FONT_BODY, fontSize: 10, color: C.faint, margin: 0, lineSpacingMultiple: 1.3, italic: true },
  );

  // right column: schematic evidence-graph figure
  const rx = 6.0, rw = 3.5;
  card(s, { x: rx, y: 2.05, w: rw, h: 3.15, accent: C.bench });
  const cx = rx + rw / 2, cy = 2.05 + 1.35;
  const nodeTones = [C.clip, C.clip, C.claude, C.claude, C.reg, C.bench];
  const bx = (i) => rx + 0.55 + (i / 5) * (rw - 1.1);
  s.addShape("line", { x: bx(0), y: cy, w: bx(5) - bx(0), h: 0, line: { color: C.edge, width: 1 } });
  // scattered evidence dots
  const pts = [
    [0.18, -0.5], [0.32, 0.42], [-0.28, -0.35], [0.6, -0.28], [0.75, 0.3], [1.05, -0.4], [1.2, 0.22], [1.5, -0.3], [1.7, 0.38], [2.0, -0.22],
  ];
  pts.forEach(([dx, dy], i) => {
    const anchor = bx(1 + (i % 4));
    dot(s, anchor + dx - 0.03, cy + dy - 0.03, i % 3 === 0 ? C.lit : C.clip, 0.06);
  });
  nodeTones.forEach((tone, i) => {
    dot(s, bx(i) - 0.06, cy - 0.06, tone, 0.12);
  });
  s.addText("nodes 15 / 34", { x: rx + 0.3, y: 2.05 + 3.15 - 0.42, w: 1.6, h: 0.28, fontFace: FONT_MONO, fontSize: 8, color: C.faint, margin: 0 });
  s.addText("retrieving", { x: rx + rw - 1.6, y: 2.05 + 3.15 - 0.42, w: 1.3, h: 0.28, fontFace: FONT_MONO, fontSize: 8, color: C.faint, margin: 0, align: "right" });

  s.addText(
    "The board filling as evidence lands — the Benchling-backed construct view sits directly beneath it in the lab.",
    { x: rx, y: 5.28, w: rw, h: 0.3, fontFace: FONT_BODY, fontSize: 9, color: C.ghost, margin: 0, italic: true },
  );
  footerPage(s, 7);
}

/* ========================================================================
   8 — Proof chain
   ======================================================================== */
{
  const s = baseSlide();
  eyebrow(s, "One claim, opened all the way", C.lit);
  title(s, [{ text: "Five clicks from a number on a dashboard to " }, { text: "a shell command you can paste.", options: { bold: true } }], 0.78, 24);

  const links = [
    ["1", "Claim ·", "β-thalassemia pathophysiology is consistently described, and co-inheritance of α-thalassemia ameliorates phenotype."],
    ["2", "Cited ·", "PMC5583283  PMC12672394  NCT06291961 — each one resolvable, each one openable."],
    ["3", "Extracted ·", "domain Disease Context & Mechanism, at 85% confidence, with the extractor's own reasoning recorded verbatim."],
    ["4", "Retrieved by ·", 'search -s pmc,arxiv "CS-101 β-thalassemia Major …" → 5,498 chars, then map/reduce extraction → 24,025 chars.'],
    ["5", "Scored by ·", "claude-opus-5 · effort high · rubric v2.0.0 · dossier v1.0.0, with a full run trace on disk."],
  ];
  let y = 2.05;
  links.forEach(([n, label, text], i) => {
    if (i > 0) s.addShape("line", { x: MARGIN, y, w: PW - MARGIN * 2, h: 0, line: { color: C.edge, width: 0.75 } });
    s.addText(n, { x: MARGIN, y: y + 0.06, w: 0.3, h: 0.4, fontFace: FONT_MONO, fontSize: 10, color: C.lit, bold: true, margin: 0 });
    s.addText([{ text: label + " ", options: { color: C.faint, italic: true } }, { text, options: { color: C.muted } }], {
      x: MARGIN + 0.35,
      y: y + 0.02,
      w: PW - MARGIN * 2 - 0.4,
      h: 0.5,
      fontFace: text.includes("search -s") ? FONT_MONO : FONT_BODY,
      fontSize: text.includes("search -s") ? 10 : 11.5,
      margin: 0,
      lineSpacingMultiple: 1.25,
      valign: "top",
    });
    y += 0.55;
  });

  s.addShape("line", { x: MARGIN, y: 4.98, w: 0, h: 0.5, line: { color: C.lit, width: 2.25 } });
  s.addText(
    [
      { text: "Every claim in every report has this — not a sample, ", options: { color: C.ink } },
      { text: "all of them", options: { bold: true, color: C.ink } },
      { text: ". A missing link is shown as missing, never filled with something plausible.", options: { color: C.ink } },
    ],
    { x: MARGIN + 0.22, y: 4.86, w: 8.6, h: 0.6, fontFace: FONT_HEAD, fontSize: 13, margin: 0, valign: "middle", lineSpacingMultiple: 1.1 },
  );
  footerPage(s, 8);
}

/* ========================================================================
   9 — CS-101 (the uncomfortable demo)
   ======================================================================== */
{
  const s = baseSlide();
  eyebrow(s, "The run I am least comfortable with — which is why it is here", C.reg);
  title(s, [{ text: "CS-101 · base-edited HSC therapy for β-thalassemia major · Phase 2" }], 0.78, 20);

  const rows = [
    ["Disease Context & Mechanism", "4 / 5", C.bench, "moderate"],
    ["Trial Design & Regulatory Strategy", "3 / 5", C.muted, "weak"],
    ["Immunogenicity", "3 / 5", C.muted, "absent"],
    ["Trial Integrity & Governance", "3 / 5", C.muted, "absent"],
    ["Efficacy & Clinical Evidence", "2 / 5", C.stop, "absent"],
    ["Safety & Tolerability", "2 / 5", C.stop, "absent"],
    ["Long-Term Genetic Risk", "2 / 5", C.stop, "absent"],
    ["Biodistribution & Pharmacology", "2 / 5", C.stop, "absent"],
    ["Manufacturability & CMC", "2 / 5", C.stop, "absent"],
    ["PK/PD & Dosing", "2 / 5", C.stop, "absent"],
  ];
  const tableRows = [
    [
      { text: "DIMENSION", options: { fontFace: FONT_MONO, fontSize: 8, color: C.faint, bold: true, fill: { color: C.panel } } },
      { text: "SCORE", options: { fontFace: FONT_MONO, fontSize: 8, color: C.faint, bold: true, align: "right", fill: { color: C.panel } } },
      { text: "EVIDENCE", options: { fontFace: FONT_MONO, fontSize: 8, color: C.faint, bold: true, fill: { color: C.panel } } },
    ],
    ...rows.map(([dim, score, color, ev]) => [
      { text: dim, options: { fontFace: FONT_BODY, fontSize: 10, color: C.ink, fill: { color: C.ground } } },
      { text: score, options: { fontFace: FONT_MONO, fontSize: 10, color, align: "right", fill: { color: C.ground } } },
      { text: ev, options: { fontFace: FONT_MONO, fontSize: 8, color: ev === "absent" ? C.reg : C.faint, fill: { color: C.ground } } },
    ]),
  ];
  s.addTable(tableRows, {
    x: MARGIN,
    y: 1.9,
    w: 5.35,
    h: 3.15,
    colW: [3.05, 0.85, 1.45],
    border: { type: "solid", color: C.edge, pt: 0.5 },
    autoPage: false,
    valign: "middle",
    margin: [2, 6, 2, 6],
  });

  const rx = 6.15, rw = 3.35;
  s.addText("40%", { x: rx, y: 1.85, w: rw, h: 0.65, fontFace: FONT_MONO, fontSize: 42, color: C.reg, margin: 0 });
  s.addText("PROBABILITY OF TRIAL SUCCESS · 24–56 · CONFIDENCE LOW", {
    x: rx,
    y: 2.5,
    w: rw,
    h: 0.4,
    fontFace: FONT_MONO,
    fontSize: 8,
    color: C.faint,
    charSpacing: 1,
    margin: 0,
    lineSpacingMultiple: 1.3,
  });
  s.addText(
    [
      { text: "Nine of ten dimensions come back ", options: { color: C.muted } },
      { text: "absent", options: { bold: true, color: C.ink } },
      { text: ". The one that scores well is about the disease — thirty years deep in the literature. Every dimension about the product scores 2/5, because the clinical data isn't public yet.", options: { color: C.muted } },
    ],
    { x: rx, y: 3.0, w: rw, h: 1.15, fontFace: FONT_BODY, fontSize: 10.5, margin: 0, lineSpacingMultiple: 1.32, valign: "top" },
  );

  s.addShape("roundRect", { x: rx, y: 4.2, w: rw, h: 0.78, rectRadius: 0.05, fill: { color: "0D0F14" }, line: { color: C.stop, width: 1.5 } });
  s.addText(
    [
      { text: "if (strength === 'absent' && score > 3) score = 3;\n", options: { color: C.muted } },
      { text: "point = clamp(point, low, high);", options: { color: C.muted } },
    ],
    { x: rx + 0.15, y: 4.28, w: rw - 0.3, h: 0.62, fontFace: FONT_MONO, fontSize: 8.5, margin: 0, lineSpacingMultiple: 1.4, valign: "middle" },
  );

  s.addText(
    "A system that returns 40% and shows you exactly which nine boxes are empty has told you something true and actionable. A confident 68% borrowing Casgevy's safety profile would have told you nothing — twice. The ceiling is enforced in code, not a prompt.",
    { x: MARGIN, y: 5.12, w: PW - MARGIN * 2, h: 0.42, fontFace: FONT_BODY, fontSize: 9.5, color: C.faint, margin: 0, lineSpacingMultiple: 1.25 },
  );
  footerPage(s, 9);
}

/* ========================================================================
   10 — Calibration
   ======================================================================== */
{
  const s = baseSlide();
  eyebrow(s, "Three real runs, for calibration", C.clip);
  title(s, [{ text: "The spread is " }, { text: "evidence coverage", options: { bold: true } }, { text: ", not enthusiasm." }], 0.78, 27);

  const rows = [
    ["Programme", "Indication", "Phase", "Verdict", "Confidence"],
    ["NTLA-2001", "Hereditary ATTR amyloidosis · in vivo CRISPR knockout of hepatic TTR", "1", "58% (40–72)", "moderate"],
    ["CS-101", "β-thalassemia major · base-edited HSC therapy", "2", "40% (24–56)", "low"],
    ["CTX112", "r/r B-cell malignancy · allogeneic CD19 CAR-T", "1/2", "28% (15–42)", "low"],
  ];
  const colColors = [C.bench, C.reg, C.stop];
  const tableRows = rows.map((r, i) => {
    if (i === 0) {
      return r.map((t, ci) => ({
        text: t.toUpperCase(),
        options: { fontFace: FONT_MONO, fontSize: 8, color: C.faint, bold: true, fill: { color: C.panel }, align: ci >= 2 ? "right" : "left" },
      }));
    }
    return r.map((t, ci) => ({
      text: t,
      options: {
        fontFace: ci === 3 ? FONT_MONO : FONT_BODY,
        fontSize: ci === 1 ? 9.5 : 10.5,
        color: ci === 3 ? colColors[i - 1] : ci === 0 ? C.ink : C.muted,
        fill: { color: C.ground },
        align: ci >= 2 ? "right" : "left",
      },
    }));
  });
  s.addTable(tableRows, {
    x: MARGIN,
    y: 1.95,
    w: PW - MARGIN * 2,
    h: 1.55,
    colW: [1.1, 4.3, 0.7, 1.4, 1.5],
    border: { type: "solid", color: C.edge, pt: 0.5 },
    autoPage: false,
    valign: "middle",
    margin: [2, 6, 2, 6],
  });

  s.addText(
    [
      { text: "NTLA-2001 scores highest not because it is the most exciting science, but because the ATTR precedent set is unusually rich. The reviewer still refuses to score efficacy on presumption: no primary Phase 1 dataset with per-cohort TTR reductions was retrievable, ", options: { color: C.muted } },
      { text: "and the report says so", options: { bold: true, color: C.ink } },
      { text: ".", options: { color: C.muted } },
    ],
    { x: MARGIN, y: 3.75, w: PW - MARGIN * 2, h: 0.85, fontFace: FONT_BODY, fontSize: 12.5, margin: 0, lineSpacingMultiple: 1.32, valign: "top" },
  );
  s.addText(
    "CTX112 consumed 31 retrieval commands, 29 cited sources and 207,641 tokens of context to arrive at 28%. The expense is the point: it looked as hard as it could and reported what it found.",
    { x: MARGIN, y: 4.7, w: PW - MARGIN * 2, h: 0.6, fontFace: FONT_BODY, fontSize: 10.5, color: C.faint, margin: 0, lineSpacingMultiple: 1.3 },
  );
  footerPage(s, 10);
}

/* ========================================================================
   11 — Boundaries
   ======================================================================== */
{
  const s = baseSlide();
  eyebrow(s, "What this does not do", C.stop);
  title(
    s,
    [
      { text: "A system that will not say what it cannot do " },
      { text: "has not earned the right", options: { bold: true } },
      { text: " to say what it can." },
    ],
    0.78,
    24,
  );

  const items = [
    ["It is not a regulatory decision.", "FDA review is a human, deliberative process with access to the confidential IND that CLARITY by construction cannot see."],
    ["It only knows what is public.", "The dominant reason a Phase 1/2 asset scores low is that its own clinical data has not been published — a statement about the evidence, not the science."],
    ["It does not match patients to trials.", "The catalog carries no site or eligibility geography. Building a screening widget on data we do not have is the exact failure the system exists to prevent."],
    ["Small n on benchmarks.", "Six reviews is a position, not a distribution — and the interface says so out loud instead of drawing a histogram from six points."],
    ["The reviewer is a model.", "The rubric, weights, phase gates and guardrails are code. The judgement inside a domain is Claude's — the proof chain exists so you can overrule it."],
  ];
  let y = 2.1;
  items.forEach(([b, r]) => {
    s.addText("✕", { x: MARGIN, y, w: 0.3, h: 0.55, color: C.stop, fontFace: FONT_MONO, fontSize: 12, bold: true, margin: 0 });
    s.addText([{ text: b + " ", options: { bold: true, color: C.ink } }, { text: r, options: { color: C.muted } }], {
      x: MARGIN + 0.32,
      y,
      w: PW - MARGIN * 2 - 0.32,
      h: 0.58,
      fontFace: FONT_BODY,
      fontSize: 11.5,
      margin: 0,
      lineSpacingMultiple: 1.25,
      valign: "top",
    });
    y += 0.6;
  });
  footerPage(s, 11);
}

/* ========================================================================
   12 — Why it holds
   ======================================================================== */
{
  const s = baseSlide();
  eyebrow(s, "Why it holds up under someone who knows the field", C.bench);
  title(s, [{ text: "The parts that must not be a model's opinion " }, { text: "are not one.", options: { bold: true } }], 0.78, 25);

  const cards = [
    [C.bench, "The rubric is arithmetic", "Ten weighted dimensions, scored 1–5 against explicit anchors. Weights sum to 1.0, and the module refuses to load if they do not."],
    [C.clip, "The domains are phase-gated", "Nine CLARITY domains, activating at preclinical, Phase 1, 2 or 3. A preclinical asset is never asked for postmarketing controls it cannot have."],
    [C.claude, "Every run leaves a record", "An audit record per run, and an optional full trace with prompts, outputs, timing and token usage. Reviews dedupe in flight."],
    [C.reg, "It degrades honestly", "No canvas context → the flat SVG topology renders. No EventSource → the run says so. Read-only filesystem → the review stays in memory."],
  ];
  const cw = 4.35, ch = 1.35;
  cards.forEach(([tone, h, body], i) => {
    const x = MARGIN + (i % 2) * (cw + 0.3);
    const y = 2.05 + Math.floor(i / 2) * (ch + 0.22);
    card(s, { x, y, w: cw, h: ch, accent: tone });
    dot(s, x + 0.22, y + 0.24, tone, 0.09);
    s.addText(h, { x: x + 0.42, y: y + 0.15, w: cw - 0.6, h: 0.3, fontFace: FONT_HEAD, fontSize: 13, color: C.ink, margin: 0 });
    s.addText(body, { x: x + 0.22, y: y + 0.5, w: cw - 0.44, h: ch - 0.6, fontFace: FONT_BODY, fontSize: 10, color: C.muted, margin: 0, lineSpacingMultiple: 1.28, valign: "top" });
  });
  s.addText(
    "61 tests covering the API surface, citation grammars, evidence assembly, traces, run guards and the whole render path.",
    { x: MARGIN, y: 5.15, w: PW - MARGIN * 2, h: 0.35, fontFace: FONT_BODY, fontSize: 10, color: C.faint, margin: 0, italic: true },
  );
  footerPage(s, 12);
}

/* ========================================================================
   13 — Ask
   ======================================================================== */
{
  const s = baseSlide();
  eyebrow(s, "The ask", C.clip);
  s.addText([{ text: "Argue with " }, { text: "the number", options: { bold: true } }, { text: "." }], {
    x: MARGIN,
    y: 1.0,
    w: 8,
    h: 1.0,
    fontFace: FONT_HEAD,
    fontSize: 42,
    color: C.ink,
    margin: 0,
  });
  s.addText(
    [
      { text: "We want design partners who will run their own programme through CLARITY and push back on what it returns — ", options: { color: C.muted } },
      { text: "licensing teams, translational investors, and disease foundations deciding where a grant goes", options: { bold: true, color: C.ink } },
      { text: ". The whole point of the proof chain is that now they can.", options: { color: C.muted } },
    ],
    { x: MARGIN, y: 2.05, w: 8.2, h: 0.95, fontFace: FONT_BODY, fontSize: 13, margin: 0, lineSpacingMultiple: 1.32, valign: "top" },
  );

  const statW = 2.8;
  stat(s, MARGIN, 3.15, statW, "3", "actors, never touching", "The architecture is the moat, not the model.", C.clip);
  stat(s, MARGIN + statW + 0.35, 3.15, statW, "118", "programmes ready to review", "77 cell therapy · 40 gene therapy, eight areas.", C.clip);
  stat(s, MARGIN + (statW + 0.35) * 2, 3.15, statW, "1", "registry ID to start", "Paste an NCT number and watch the board fill.", C.clip);

  s.addShape("roundRect", { x: MARGIN, y: 4.55, w: 4.3, h: 0.4, rectRadius: 0.06, fill: { type: "none" }, line: { color: C.reg, width: 1, dashType: "dash" } });
  s.addText("FILL IN — raise, round, use of funds", { x: MARGIN + 0.15, y: 4.55, w: 4.0, h: 0.4, fontFace: FONT_MONO, fontSize: 10, color: C.reg, valign: "middle", margin: 0 });

  s.addShape("roundRect", { x: MARGIN + 4.5, y: 4.55, w: 4.2, h: 0.4, rectRadius: 0.06, fill: { type: "none" }, line: { color: C.reg, width: 1, dashType: "dash" } });
  s.addText("FILL IN — name, contact, live URL", { x: MARGIN + 4.65, y: 4.55, w: 4.0, h: 0.4, fontFace: FONT_MONO, fontSize: 10, color: C.reg, valign: "middle", margin: 0 });

  s.addText("Generated assessments are decision support, not regulatory advice.", {
    x: MARGIN,
    y: 5.2,
    w: 8,
    h: 0.3,
    fontFace: FONT_BODY,
    fontSize: 9,
    color: C.ghost,
    margin: 0,
  });
  footerPage(s, 13);
}

/* -- speaker notes ---------------------------------------------------------
   Same timed script as pitch/pitch-script.md, one cue per slide. */

const notes = [
  "0:00 — Ninety-two out of every hundred drugs that enter human trials never reach a patient. Not because the science was bad. Often nobody could tell in time. I'm building CLARITY: point it at a registry ID, and it hands back the file a reviewer would want on their desk — with every claim traceable to a document you can open.",
  "0:30 — That 7.9% is BIO's, across a decade. The capitalised cost of one survivor is 2.6 billion dollars. Behind the numbers is a queue — and in our catalog there are 118 programmes that might change a trajectory like that, almost all Phase 1.",
  "1:05 — Several days of specialist time. Not reproducible. Land the line: the bottleneck is not intelligence, it is audit. Then pause.",
  "1:50 — It will answer well about pembrolizumab, and with identical confidence about the CAR-T that has published nothing. In a regulatory context that's worse than useless.",
  "2:25 — Retrieval is one system. Extraction is a second pass that sees only one domain's packet and must attach a public identifier. Scoring is a third pass that sees only the trial record and the cited dossier. That constraint is not a design preference — it is the product.",
  "2:50 — Say it in one breath: find, read, judge. The only unusual thing is the dashed line — each step is handed only what the step before it found, which is why nothing in the report can come from the model's memory. Then move on; don't linger.",
  "3:05 — This is the workstation. The graph isn't an animation playing next to the run — it is the run. Every retrieval attaches the document it found, so the graph visibly grows.",
  "3:25 — Claim, to citations, to the extraction with its own confidence, to the literal search command, to the model and rubric version. A broken chain shown honestly is the difference between provenance and decoration.",
  "3:50 — This is the slide that makes the case. Don't rush the table. Land “told you nothing — twice,” then show that the ceiling is code.",
  "4:15 — Cut this slide first if you are over time. Its job is only to show the numbers move for a reason.",
  "4:30 — Optional out loud, but leave it on screen during Q&A. Stating the boundary is what buys the rest of the claim.",
  "4:35 — Compress hard if you are short. The one sentence that must survive: the rubric refuses to load if the weights don't sum to one.",
  "4:35 — Replace both amber placeholders before you present. Close on “argue with the number” — it is the invitation, and it is the differentiator.",
];

pres.slides.forEach((slide, i) => slide.addNotes(notes[i]));

pres.writeFile({ fileName: "CLARITY-pitch-deck.pptx" }).then(() => {
  console.log("written");
});
