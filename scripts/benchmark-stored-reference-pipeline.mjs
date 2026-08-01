import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  bindCitationAnnotationRanges,
  bodyCitationBlockRanges,
  citationAnnotationIssues,
  citationAnnotationMentions,
  MAX_CITATION_REQUESTS_PER_MANUSCRIPT
} from '../core/citation-annotation.js';
import {
  documentAnnotationFormatForPages,
  documentAnnotationPromptForPages,
  documentAnnotationSourcePageMap
} from '../core/document-annotation.js';
import { documentAnnotationIssues } from '../core/document-annotation-validation.js';
import { annotationPageRanges } from '../core/mistral-annotation-contract.js';
import {
  referenceAnnotationAcceptanceIssues,
  referenceAnnotationReferences,
  referenceBlocksFromRawPages
} from '../core/reference-annotation.js';
import {
  applyReferenceLinks,
  hasReferenceLinkCandidates,
  hasValidReferenceLinks
} from '../core/reference-links-contract.js';
import {
  requestAnnotationChunk,
  requestCitationAnnotation,
  requestReferenceAnnotation
} from '../services/mistral-ocr.js';
import { referenceLinksContent, requestReferenceLinks } from '../services/mistral-reference-links.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const reviewId = String(process.env.STORED_REFERENCE_BENCHMARK_ID || '').trim().toLowerCase();
const useStoredBibliography = process.env.STORED_REFERENCE_BENCHMARK_USE_STORED_BIBLIOGRAPHY === 'true';
const maximumProviderCalls = Number(process.env.STORED_REFERENCE_BENCHMARK_MAX_CALLS || 16);
const broadCheckpointPath = process.env.STORED_REFERENCE_BENCHMARK_BROAD_CHECKPOINT
  ? resolve(root, process.env.STORED_REFERENCE_BENCHMARK_BROAD_CHECKPOINT)
  : null;

if (!reviewId) throw new Error('STORED_REFERENCE_BENCHMARK_ID is required.');
if (!process.env.MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY is not configured.');

const fixturePath = resolve(root, `public/data/stored/${reviewId}.json`);
const pdfPath = resolve(root, `public/data/stored/${reviewId}.pdf`);
const outputDirectory = resolve(root, 'data/benchmarks');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const rawPages = fixture.raw?.pages || [];
const base64 = (await readFile(pdfPath)).toString('base64');

if (!rawPages.length) throw new Error(`${reviewId} has no stored raw OCR pages.`);

let providerCalls = 0;
const calls = [];
const call = async (stage, operation) => {
  if (providerCalls >= maximumProviderCalls) throw new Error(`Provider call budget exhausted before ${stage}.`);
  providerCalls += 1;
  const startedAt = Date.now();
  const result = await operation();
  calls.push({
    stage,
    status: result.response?.status ?? null,
    elapsedMs: Date.now() - startedAt,
    usage: result.payload?.usage_info || result.payload?.usage || null
  });
  return result;
};
const annotationValue = (payload = {}) => {
  const value = payload.document_annotation;
  return typeof value === 'string' ? JSON.parse(value) : value;
};

let annotationChunks = [];
if (broadCheckpointPath) {
  const cached = JSON.parse(await readFile(broadCheckpointPath, 'utf8'));
  annotationChunks = cached.broadAnnotation?.responses || cached.annotation?.chunks || [];
  if (!annotationChunks.length) throw new Error('The supplied broad annotation checkpoint has no reusable chunks.');
} else {
  for (const pages of annotationPageRanges(rawPages.length)) {
    const sourcePageMap = documentAnnotationSourcePageMap(rawPages, pages);
    const { response, payload } = await call(`broad-annotation:${pages[0] + 1}-${pages.at(-1) + 1}`, () => requestAnnotationChunk({
      base64,
      pages,
      sourcePageMap,
      format: documentAnnotationFormatForPages(pages, sourcePageMap),
      prompt: documentAnnotationPromptForPages(pages, sourcePageMap),
      env: process.env
    }));
    if (!response.ok) throw new Error(`Broad annotation failed with HTTP ${response.status}.`);
    const annotation = annotationValue(payload);
    const issues = documentAnnotationIssues(annotation);
    if (issues.length) throw new Error(`Broad annotation contract failed for pages ${pages[0] + 1}-${pages.at(-1) + 1}: ${issues.join(' ')}`);
    annotationChunks.push({ pages, annotation, usage: payload?.usage_info || null });
  }
}

const referenceBlocks = referenceBlocksFromRawPages(rawPages);
let references;
let bibliographyIssues = [];
if (useStoredBibliography) {
  references = (fixture.annotations?.references?.references || []).map((reference, index) => ({
    id: reference.id || `reference:${index}`,
    printed_label: String(reference.printed_label || ''),
    text: String(reference.text || '')
  }));
  if (!references.length || references.some((reference) => !reference.text)) throw new Error('The stored bibliography inventory is incomplete.');
} else {
  const { response, payload } = await call('bibliography-inventory', () => requestReferenceAnnotation({
    base64,
    referenceBlocks,
    env: process.env
  }));
  if (!response.ok) throw new Error(`Bibliography annotation failed with HTTP ${response.status}.`);
  const annotation = annotationValue(payload);
  bibliographyIssues = referenceAnnotationAcceptanceIssues(annotation, referenceBlocks);
  if (bibliographyIssues.length) throw new Error(`Bibliography annotation contract failed: ${bibliographyIssues.join(' ')}`);
  references = referenceAnnotationReferences(annotation);
}

const citationRanges = bodyCitationBlockRanges(annotationChunks, rawPages);
if (!citationRanges.length) throw new Error('No model-selected article blocks are available for citation extraction.');
if (citationRanges.length > MAX_CITATION_REQUESTS_PER_MANUSCRIPT) {
  throw new Error(`${citationRanges.length} citation requests exceed the ${MAX_CITATION_REQUESTS_PER_MANUSCRIPT}-request manuscript budget.`);
}
const citationRecords = [];
for (const [index, range] of citationRanges.entries()) {
  const { response, payload } = await call(`body-citations:${range.pages[0] + 1}-${range.pages.at(-1) + 1}`, () => requestCitationAnnotation({
    base64,
    citationBlocks: range.blocks,
    env: process.env
  }));
  if (!response.ok) throw new Error(`Body citation annotation failed with HTTP ${response.status}.`);
  const annotation = annotationValue(payload);
  citationRecords.push({
    range_id: `citation-range-${index}`,
    pages: range.pages,
    supplied_blocks: range.blocks,
    citation_blocks: annotation?.citation_blocks || [],
    citation_mentions: citationAnnotationMentions(annotation, range.blocks),
    issues: citationAnnotationIssues(annotation, range.blocks)
  });
}

const grounded = bindCitationAnnotationRanges(citationRecords, rawPages);
const bibliography = references.map((reference, index) => ({
  ...reference,
  number: index + 1,
  link_handle: reference.id
}));
const candidates = {
  references: bibliography.map((reference) => ({
    handle: reference.link_handle,
    printed_label: reference.printed_label,
    text: reference.text
  })),
  citation_mentions: grounded.candidates
};
if (!hasReferenceLinkCandidates(candidates)) throw new Error('The relation candidate packet is malformed.');

const { response: relationResponse, payload: relationPayload } = await call('reference-relations', () => requestReferenceLinks({ candidates, env: process.env }));
if (!relationResponse.ok) throw new Error(`Reference relation mapping failed with HTTP ${relationResponse.status}.`);
const links = referenceLinksContent(relationPayload);
if (!hasValidReferenceLinks(links, candidates)) throw new Error('Reference relation decisions failed their completeness contract.');

const linkedReferences = applyReferenceLinks(bibliography, candidates, links);
const candidateByHandle = new Map(candidates.citation_mentions.map((candidate) => [candidate.handle, candidate]));
const bibliographicDecisions = links.citation_decisions.filter((decision) => decision.classification === 'bibliographic_citation');
const nonBibliographicDecisions = links.citation_decisions.filter((decision) => decision.classification === 'not_bibliographic');
const referencesWithOccurrences = linkedReferences.filter((reference) => reference.body_occurrences.length);
const rejectedCandidates = grounded.ranges.flatMap((range) => range.items.filter((item) => !item.accepted).map((item) => ({
  pages: range.pages,
  citation_text: item.label,
  block_id: item.blockId,
  reasons: item.reasons
})));
const summary = {
  capturedAt: new Date().toISOString(),
  reviewId,
  contracts: {
    citation: 'deskreview_body_citations_v10',
    relation: 'deskreview_reference_relation_decisions_v4'
  },
  sources: {
    rawOcr: 'stored',
    broadAnnotation: broadCheckpointPath ? broadCheckpointPath : 'live',
    bibliography: useStoredBibliography ? 'stored' : 'live'
  },
  providerCalls,
  maximumProviderCalls,
  calls,
  bibliographyInventory: { references, referenceBlocks: referenceBlocks.length, issues: bibliographyIssues },
  broadAnnotation: { responses: annotationChunks, citationRanges: citationRanges.map((range) => ({ pages: range.pages, blocks: range.blocks.length })) },
  citationExtraction: {
    returned: grounded.ranges.reduce((total, range) => total + range.returned, 0),
    grounded: grounded.candidates.length,
    rejected: rejectedCandidates.length,
    rejectedCandidates,
    responses: citationRecords
  },
  relation: {
    decisions: links,
    bibliographicCandidates: bibliographicDecisions.map((decision) => ({
      citation_handle: decision.citation_handle,
      citation_text: candidateByHandle.get(decision.citation_handle)?.citation_text || '',
      reference_handles: decision.reference_handles
    })),
    nonBibliographicCandidates: nonBibliographicDecisions.map((decision) => ({
      citation_handle: decision.citation_handle,
      citation_text: candidateByHandle.get(decision.citation_handle)?.citation_text || ''
    })),
    referencesWithOccurrences: referencesWithOccurrences.length,
    referenceCoveragePercent: Number(((referencesWithOccurrences.length / bibliography.length) * 100).toFixed(1)),
    unmappedReferenceNumbers: linkedReferences.filter((reference) => !reference.body_occurrences.length).map((reference) => reference.number)
  },
  linkedReferences
};

await mkdir(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, `${reviewId}-reference-pipeline-${Date.now()}.json`);
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath,
  providerCalls,
  calls,
  bibliographyReferences: bibliography.length,
  citationExtraction: {
    returned: summary.citationExtraction.returned,
    grounded: summary.citationExtraction.grounded,
    rejected: summary.citationExtraction.rejected
  },
  relation: {
    bibliographicCandidates: summary.relation.bibliographicCandidates.length,
    nonBibliographicCandidates: summary.relation.nonBibliographicCandidates,
    referencesWithOccurrences: summary.relation.referencesWithOccurrences,
    referenceCoveragePercent: summary.relation.referenceCoveragePercent,
    unmappedReferenceNumbers: summary.relation.unmappedReferenceNumbers
  }
}, null, 2));
