// Citation parsing for the review UI.
//
// Reviewer findings carry a free-text `source` ("FDA Wainua review (NDA 217388);
// PMC13124466"). The report needs each source shown as a title plus a type with a
// direct link where one exists, and the raw identifiers demoted to metadata. This
// module turns those strings into structured references, preferring titles and
// URLs already resolved by the dossier pass.

export function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export const SOURCE_TYPE_LABEL = {
  primary_literature: 'Literature',
  trial_registry: 'Registry',
  regulatory_document: 'FDA',
};

// Identifier grammars seen in reviewer `source` strings, each resolvable to a
// primary source the reader can actually open.
export const ID_RULES = [
  {
    re: /\bNCT\d{8}\b/gi,
    type: 'Registry',
    id: (m) => m[0].toUpperCase(),
    url: (m) => `https://clinicaltrials.gov/study/${m[0].toUpperCase()}`,
  },
  {
    re: /\bPMC\d{6,9}\b/gi,
    type: 'Literature',
    id: (m) => m[0].toUpperCase(),
    url: (m) => `https://www.ncbi.nlm.nih.gov/pmc/articles/${m[0].toUpperCase()}/`,
  },
  {
    re: /\bPMID:?\s*(\d{6,9})\b/gi,
    type: 'Literature',
    id: (m) => `PMID ${m[1]}`,
    url: (m) => `https://pubmed.ncbi.nlm.nih.gov/${m[1]}/`,
  },
  {
    re: /\b(10\.\d{4,9}\/[^\s,;)\]]+)/g,
    type: 'Literature',
    id: (m) => m[1],
    url: (m) => `https://doi.org/${m[1]}`,
  },
  {
    re: /\b(NDA|BLA|ANDA)\s*#?\s*(\d{6})\b/gi,
    type: 'FDA',
    id: (m) => `${m[1].toUpperCase()} ${m[2]}`,
    url: (m) =>
      `https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=${m[2]}`,
  },
  {
    re: /\bjRCT[a-z0-9]{8,}\b/gi,
    type: 'Registry',
    id: (m) => m[0],
    url: (m) => `https://jrct.mhlw.go.jp/en-latest-detail/${m[0]}`,
  },
];

// Retrieval-internal handles (fda_…, bio_…) are provenance, not navigation.
export const INTERNAL_ID_RE = /\b[a-z]{2,6}_[0-9a-f]{8,}\b/g;

export function inferType(text) {
  // Reviewer shorthand for "this came from the assembled bundle, not a public
  // document" is provenance, not a citation — say so rather than implying a source.
  if (
    /\binferred\b|not found in public sources|information gaps?\b|evidence bundle|landscape summary|\bsection\b|^no\b|\bno [\w-]+ (?:retrieved|found|data|publication)\b|\bfrom class\b|\bfrom modality\b/i.test(
      text.trim(),
    )
  ) {
    return 'Internal';
  }
  if (/\bfda\b|advisory committee|briefing|approval package|\bnda\b|\bbla\b/i.test(text)) return 'FDA';
  if (/guidance/i.test(text)) return 'Guidance';
  if (/registry|registration/i.test(text)) return 'Registry';
  return 'Source';
}

// Titles and URLs already resolved by the dossier pass, keyed by identifier.
export function citationIndex(evaluation) {
  const index = new Map();
  for (const domain of evaluation?.evidence?.dossier?.domains ?? []) {
    for (const element of domain.elements ?? []) {
      for (const citation of element.citations ?? []) {
        if (citation.identifier) index.set(String(citation.identifier).toUpperCase(), citation);
      }
    }
  }
  return index;
}

// Reviewers abbreviate runs of registry ids as NCT06024876/06065189/06291961.
export const expandIdRuns = (text) =>
  text.replace(/\bNCT\d{8}(?:\s*\/\s*\d{8})+/g, (run) =>
    run
      .split('/')
      .map((part, i) => (i === 0 ? part.trim() : `NCT${part.trim()}`))
      .join(' '),
  );

// The type is already shown beside the title, so "FDA · FDA CASGEVY reviews" is
// one "FDA" too many. Only drop it when enough of a label remains to stand alone
// — "Registry records" must not decay into "records".
const trimTypePrefix = (title, type) => {
  if (title.trim().split(/\s+/).length < 3) return title;
  const stripped = title.replace(new RegExp(`^${type}\\s+`, 'i'), '').trim();
  return stripped.length > 2 ? stripped : title;
};

export function parseSources(sourceText, index = new Map()) {
  const segments = expandIdRuns(String(sourceText ?? ''))
    .split(/\s*(?:;|·|\s\/\s)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  return segments.flatMap((segment) => {
    const refs = [];
    for (const rule of ID_RULES) {
      for (const match of segment.matchAll(rule.re)) {
        refs.push({ id: rule.id(match), type: rule.type, url: rule.url(match) });
      }
    }
    const internal = [...segment.matchAll(INTERNAL_ID_RE)].map((m) => m[0]);

    let residual = segment;
    for (const rule of ID_RULES) residual = residual.replace(rule.re, ' ');
    residual = residual
      .replace(INTERNAL_ID_RE, ' ')
      // Leftovers of an id run whose prefix has already been consumed.
      .replace(/(?:\s*\/\s*\d{6,8})+/g, ' ')
      .replace(/[()[\],;:]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^(?:and|&|[—–-])\s+/i, '')
      .replace(/\s+(?:and|&|[—–-])$/i, '')
      .trim();

    // Several bare identifiers in one segment become one entry each.
    if (!residual && refs.length) {
      return refs.map((ref) => {
        const known = index.get(ref.id.toUpperCase());
        return {
          title: known?.title || ref.id,
          type: (known?.sourceType ? SOURCE_TYPE_LABEL[known.sourceType] : null) ?? ref.type,
          note: '',
          url: safeHttpsUrl(known?.url || ref.url),
          ids: [ref.id],
        };
      });
    }

    const primary = refs[0];
    const known = primary ? index.get(primary.id.toUpperCase()) : null;
    const type =
      (known?.sourceType ? SOURCE_TYPE_LABEL[known.sourceType] : null) ??
      primary?.type ??
      inferType(segment);
    return [
      {
        // A resolved dossier title beats reviewer shorthand ("FDA", "registry
        // description"); the shorthand survives in the tooltip.
        title: trimTypePrefix(known?.title || residual || primary?.id || segment, type),
        type,
        note: known?.title && residual && residual !== known.title ? residual : '',
        url: safeHttpsUrl(known?.url || primary?.url || ''),
        ids: [...refs.map((r) => r.id), ...internal],
      },
    ];
  });
}
