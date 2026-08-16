// Construct models for the gene-model viewer.
//
// Two provenances, never blended, always labelled in the payload:
//
//   provenance: 'benchling' — a real sequence pulled from the configured tenant.
//     Bases, length and annotations are Benchling's.
//
//   provenance: 'derived'   — a schematic assembled from the trial's registry
//     modality plus target symbols that actually appear in the review evidence.
//     Feature *architecture* is the textbook layout for that modality; it is NOT
//     the sponsor's construct, and coordinates are illustrative. The viewer says
//     so, and every derived target carries the evidence line it came from.
//
// No nucleotide sequence is ever invented and presented as real. Derived models
// carry `sequence: null`; the viewer draws architecture, not bases.

/** Uppercase tokens that look like gene symbols but are not. */
const NOT_A_GENE = new Set([
  'FDA', 'EMA', 'PMDA', 'CMC', 'GCP', 'GMP', 'REMS', 'NDA', 'BLA', 'IND', 'DNA', 'RNA', 'MRNA',
  'CRISPR', 'CAS9', 'AAV', 'LNP', 'PK', 'PD', 'AE', 'SAE', 'SOC', 'ITT', 'US', 'EU', 'UK', 'WHO',
  'NCT', 'PMC', 'PMID', 'DOI', 'ORR', 'PFS', 'OS', 'HSCT', 'GVHD', 'CAR', 'TCR', 'ADA', 'NAB',
  'CI', 'SD', 'QD', 'BID', 'IV', 'SC', 'MTD', 'DLT', 'RP2D', 'PCR', 'ELISA', 'HPLC', 'LTFU',
  'CLARITY', 'TOC', 'NK', 'ICH', 'IRB', 'DSMB', 'CFR', 'ATMP', 'CBER', 'CDER', 'UTR', 'ORF',
]);

/** Target symbols worth recognising in review prose, by disease area. */
const KNOWN_TARGETS = [
  'BCL11A', 'HBB', 'HBG1', 'HBG2', 'HBA1', 'HBA2', 'KLF1', 'CD34',
  'TTR', 'PCSK9', 'LPA', 'ANGPTL3', 'APOC3', 'HAO1', 'SERPINA1',
  'CFTR', 'DMD', 'SMN1', 'SMN2', 'RPE65', 'USH2A', 'ABCA4',
  'EGFR', 'ALK', 'ROS1', 'KRAS', 'BRAF', 'HER2', 'ERBB2', 'BRCA1', 'BRCA2', 'MET', 'RET',
  'PD1', 'PDL1', 'CTLA4', 'CD19', 'BCMA', 'CD20', 'CD3', 'CD22', 'GPRC5D', 'CLDN18',
  'IL23', 'IL17A', 'TNF', 'JAK1', 'JAK2', 'BTK', 'VEGF', 'VEGFA', 'GLP1', 'GLP1R', 'GIPR',
  'F8', 'F9', 'VWF', 'PKLR', 'G6PC', 'OTC', 'ATP7B', 'GBA1', 'LRRK2', 'SNCA', 'APP', 'MAPT',
  'NLRP3', 'C5', 'C3', 'FCRN', 'THY1', 'PSMA', 'FOLR1', 'TROP2', 'NECTIN4',
];

/**
 * Modality archetypes. `features` are proportional spans (0–1) of the construct,
 * expanded to coordinates against a representative length for that modality.
 */
const ARCHETYPES = {
  'gene editing': {
    match: /gene[- ]edit|crispr|base edit|prime edit|zinc finger|talen|cas9|cas12/i,
    label: 'CRISPR editing cassette',
    length: 4200,
    unit: 'bp',
    note: 'Ex vivo editing reagent architecture: guide scaffold plus nuclease expression cassette.',
    features: [
      { name: 'U6 promoter', from: 0.0, to: 0.06, type: 'promoter' },
      { name: 'Spacer (20 nt protospacer)', from: 0.06, to: 0.085, type: 'guide' },
      { name: 'sgRNA scaffold', from: 0.085, to: 0.13, type: 'guide' },
      { name: 'PAM-proximal editing window', from: 0.075, to: 0.082, type: 'edit' },
      { name: 'EF-1α promoter', from: 0.16, to: 0.27, type: 'promoter' },
      { name: 'Nuclease ORF', from: 0.27, to: 0.78, type: 'cds' },
      { name: 'Nuclear localisation signal', from: 0.78, to: 0.81, type: 'tag' },
      { name: 'bGH polyA', from: 0.83, to: 0.9, type: 'terminator' },
    ],
  },
  'cell therapy': {
    match: /cell therapy|car[- ]t|hspc|cd34|autologous|allogeneic|tcr/i,
    label: 'Engineered cell product cassette',
    length: 7600,
    unit: 'bp',
    note: 'Lentiviral transfer-plasmid layout typical of engineered autologous cell products.',
    features: [
      { name: "5' LTR (SIN)", from: 0.0, to: 0.07, type: 'ltr' },
      { name: 'Ψ packaging signal', from: 0.07, to: 0.11, type: 'element' },
      { name: 'RRE', from: 0.11, to: 0.17, type: 'element' },
      { name: 'cPPT/CTS', from: 0.17, to: 0.2, type: 'element' },
      { name: 'EF-1α promoter', from: 0.22, to: 0.33, type: 'promoter' },
      { name: 'Transgene ORF', from: 0.33, to: 0.7, type: 'cds' },
      { name: 'WPRE', from: 0.72, to: 0.8, type: 'element' },
      { name: "3' SIN LTR", from: 0.85, to: 0.95, type: 'ltr' },
    ],
  },
  'gene therapy': {
    match: /gene therapy|aav|adeno[- ]associated|lentivir|vector/i,
    label: 'AAV transfer genome',
    length: 4700,
    unit: 'bp',
    note: 'Single-stranded AAV genome layout; payload must stay inside the ~4.7 kb packaging limit.',
    features: [
      { name: "5' ITR", from: 0.0, to: 0.03, type: 'itr' },
      { name: 'Tissue-specific promoter', from: 0.05, to: 0.19, type: 'promoter' },
      { name: 'Kozak', from: 0.19, to: 0.205, type: 'element' },
      { name: 'Transgene ORF', from: 0.205, to: 0.74, type: 'cds' },
      { name: 'WPRE', from: 0.76, to: 0.85, type: 'element' },
      { name: 'polyA', from: 0.86, to: 0.93, type: 'terminator' },
      { name: "3' ITR", from: 0.97, to: 1.0, type: 'itr' },
    ],
  },
  'oligonucleotide': {
    match: /antisense|sirna|oligonucleotide|aso|rnai|gapmer/i,
    label: 'Oligonucleotide duplex',
    length: 21,
    unit: 'nt',
    note: 'Chemically modified oligonucleotide; modification pattern drives stability and off-target profile.',
    features: [
      { name: "5' phosphorothioate wing", from: 0.0, to: 0.24, type: 'element' },
      { name: 'Central gap / guide region', from: 0.24, to: 0.76, type: 'guide' },
      { name: "3' phosphorothioate wing", from: 0.76, to: 1.0, type: 'element' },
      { name: 'GalNAc conjugate', from: 0.95, to: 1.0, type: 'tag' },
    ],
  },
  mrna: {
    match: /\bmrna\b|messenger rna|saRNA|self[- ]amplifying/i,
    label: 'mRNA drug substance',
    length: 4000,
    unit: 'nt',
    note: 'Nucleoside-modified mRNA; cap and UTR design govern translation and innate immune activation.',
    features: [
      { name: 'Cap-1', from: 0.0, to: 0.02, type: 'element' },
      { name: "5' UTR", from: 0.02, to: 0.09, type: 'utr' },
      { name: 'Coding sequence', from: 0.09, to: 0.76, type: 'cds' },
      { name: "3' UTR", from: 0.76, to: 0.88, type: 'utr' },
      { name: 'PolyA tail', from: 0.88, to: 1.0, type: 'terminator' },
    ],
  },
  antibody: {
    match: /antibody|monoclonal|bispecific|\bmab\b|adc|antibody[- ]drug/i,
    label: 'IgG heavy chain',
    length: 447,
    unit: 'aa',
    note: 'Heavy-chain domain map; CDR composition drives specificity, Fc drives effector function and half-life.',
    features: [
      { name: 'Signal peptide', from: 0.0, to: 0.04, type: 'tag' },
      { name: 'VH framework 1', from: 0.04, to: 0.11, type: 'domain' },
      { name: 'CDR-H1', from: 0.11, to: 0.14, type: 'cdr' },
      { name: 'VH framework 2', from: 0.14, to: 0.19, type: 'domain' },
      { name: 'CDR-H2', from: 0.19, to: 0.23, type: 'cdr' },
      { name: 'VH framework 3', from: 0.23, to: 0.3, type: 'domain' },
      { name: 'CDR-H3', from: 0.3, to: 0.34, type: 'cdr' },
      { name: 'CH1', from: 0.36, to: 0.55, type: 'domain' },
      { name: 'Hinge', from: 0.55, to: 0.6, type: 'element' },
      { name: 'CH2', from: 0.6, to: 0.79, type: 'domain' },
      { name: 'CH3', from: 0.79, to: 1.0, type: 'domain' },
    ],
  },
  protein: {
    match: /protein|peptide|enzyme|fusion|recombinant|insulin|agonist/i,
    label: 'Recombinant protein',
    length: 320,
    unit: 'aa',
    note: 'Domain map for a recombinant protein therapeutic.',
    features: [
      { name: 'Signal peptide', from: 0.0, to: 0.07, type: 'tag' },
      { name: 'Receptor-binding domain', from: 0.1, to: 0.42, type: 'domain' },
      { name: 'Linker', from: 0.42, to: 0.48, type: 'element' },
      { name: 'Effector domain', from: 0.48, to: 0.82, type: 'domain' },
      { name: 'Half-life extension (Fc/albumin)', from: 0.84, to: 1.0, type: 'domain' },
    ],
  },
  'small molecule': {
    match: /small molecule|inhibitor|tablet|capsule|oral/i,
    label: 'Target protein map',
    length: 480,
    unit: 'aa',
    note: 'Small molecules have no construct. Shown instead: the target protein this programme binds.',
    features: [
      { name: 'N-terminal regulatory region', from: 0.0, to: 0.18, type: 'domain' },
      { name: 'Catalytic / binding domain', from: 0.22, to: 0.62, type: 'domain' },
      { name: 'Ligand-binding pocket', from: 0.38, to: 0.46, type: 'edit' },
      { name: 'Allosteric site', from: 0.66, to: 0.74, type: 'element' },
      { name: 'C-terminal tail', from: 0.8, to: 1.0, type: 'domain' },
    ],
  },
};

const FALLBACK = {
  label: 'Therapeutic construct',
  length: 1000,
  unit: 'bp',
  note: 'Modality not resolvable from the registry record; generic layout shown.',
  features: [
    { name: 'Regulatory element', from: 0.0, to: 0.18, type: 'promoter' },
    { name: 'Active payload', from: 0.22, to: 0.78, type: 'cds' },
    { name: 'Terminator', from: 0.82, to: 1.0, type: 'terminator' },
  ],
};

function pickArchetype(trial) {
  const haystack = [trial.modality, trial.title, trial.therapeuticDescription, trial.condition]
    .filter(Boolean)
    .join(' ');
  for (const [key, archetype] of Object.entries(ARCHETYPES)) {
    if (archetype.match.test(haystack)) return { key, ...archetype };
  }
  return { key: 'generic', ...FALLBACK };
}

/**
 * Target symbols that actually appear in the review, each carried with the
 * sentence it came from so the viewer can cite rather than assert.
 */
function extractTargets(evaluation) {
  const hits = new Map();
  const consider = (symbol, context, where) => {
    const key = symbol.toUpperCase();
    if (NOT_A_GENE.has(key) || key.length < 2) return;
    if (!hits.has(key)) hits.set(key, { symbol: key, mentions: [] });
    const entry = hits.get(key);
    if (entry.mentions.length < 3) entry.mentions.push({ context: context.trim().slice(0, 320), where });
  };

  const scan = (text, where) => {
    if (!text) return;
    const string = String(text);
    for (const sentence of string.split(/(?<=[.;])\s+/)) {
      for (const target of KNOWN_TARGETS) {
        if (new RegExp(`\\b${target}\\b`, 'i').test(sentence)) consider(target, sentence, where);
      }
    }
  };

  const review = evaluation?.review;
  scan(review?.reviewerSummary, 'Reviewer summary');
  for (const criterion of review?.criteria ?? []) {
    scan(criterion.assessment, `${criterion.label ?? criterion.id} — assessment`);
    for (const finding of criterion.supportingFindings ?? []) {
      scan(finding.finding, `${criterion.label ?? criterion.id} — supporting evidence`);
    }
  }
  for (const domain of evaluation?.evidence?.dossier?.domains ?? []) {
    scan(domain.summary, `${domain.domainLabel} — dossier summary`);
    for (const element of domain.elements ?? []) {
      scan(element.finding, `${domain.domainLabel} — ${element.element}`);
    }
  }

  return [...hits.values()].sort((a, b) => b.mentions.length - a.mentions.length).slice(0, 6);
}

const expand = (features, length) =>
  features.map((feature) => ({
    name: feature.name,
    type: feature.type,
    start: Math.round(feature.from * length),
    end: Math.max(Math.round(feature.to * length), Math.round(feature.from * length) + 1),
  }));

/** Schematic assembled from registry modality + targets cited in the review. */
export function deriveConstruct(trial, evaluation) {
  const archetype = pickArchetype(trial);
  const targets = extractTargets(evaluation);
  return {
    provenance: 'derived',
    provenanceLabel: 'Schematic — modality architecture, not the sponsor construct',
    name: `${trial.therapeuticName} · ${archetype.label}`,
    archetype: archetype.key,
    modality: trial.modality && trial.modality !== 'Unknown' ? trial.modality : null,
    unit: archetype.unit,
    length: archetype.length,
    note: archetype.note,
    sequence: null,
    features: expand(archetype.features, archetype.length),
    targets,
    caveats: [
      'Feature coordinates are illustrative of the modality architecture, not measured from the clinical construct.',
      'No nucleotide or residue sequence is shown because none is published for this programme.',
      targets.length
        ? 'Target symbols below were extracted from this review’s own evidence; each carries the line it came from.'
        : 'No recognised target symbol appeared in the retrieved evidence for this trial.',
    ],
  };
}

/** Benchling payload normalised into the same shape the viewer consumes. */
export function fromBenchling(match, trial, evaluation) {
  const sequence = match.sequence ?? {};
  const isDna = match.kind === 'dna';
  const bases = isDna ? sequence.bases || '' : sequence.aminoAcids || '';
  const length = Number(sequence.length) || bases.length || 0;

  const features = (sequence.annotations ?? []).map((annotation) => ({
    name: annotation.name || annotation.type || 'feature',
    type: (annotation.type || 'domain').toLowerCase(),
    start: Number(annotation.start) || 0,
    end: Number(annotation.end) || 0,
    strand: annotation.strand,
    color: annotation.color,
  }));

  return {
    provenance: 'benchling',
    provenanceLabel: `Live from Benchling · ${sequence.entityRegistryId || sequence.id || 'unregistered'}`,
    name: sequence.name || trial.therapeuticName,
    archetype: isDna ? 'benchling-dna' : 'benchling-aa',
    modality: trial.modality && trial.modality !== 'Unknown' ? trial.modality : null,
    unit: isDna ? 'bp' : 'aa',
    length,
    note: `Matched on Benchling name search "${match.query}".`,
    sequence: bases.slice(0, 20000) || null,
    features,
    targets: extractTargets(evaluation),
    benchling: {
      id: sequence.id,
      entityRegistryId: sequence.entityRegistryId ?? null,
      folderId: sequence.folderId ?? null,
      webURL: sequence.webURL ?? null,
      modifiedAt: sequence.modifiedAt ?? null,
      alternatives: (match.alternatives ?? []).map((alt) => ({ id: alt.id, name: alt.name })),
    },
    caveats: [],
  };
}
