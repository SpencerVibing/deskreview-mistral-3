import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { projectAnnotationChunks } from '../core/annotation-stages.js';
import {
  bindCitationAnnotationRanges,
  bodyCitationBlockRanges,
  citationAnnotationIssues,
  citationAnnotationMentions
} from '../core/citation-annotation.js';
import {
  documentAnnotationFormatForPages,
  documentAnnotationPromptForPages,
  documentAnnotationSourcePageMap
} from '../core/document-annotation.js';
import { documentAnnotationIssues } from '../core/document-annotation-validation.js';
import { annotationPageRanges } from '../core/mistral-annotation-contract.js';
import {
  applyReferenceLinks,
  hasReferenceLinkCandidates,
  hasValidReferenceLinks
} from '../core/reference-links-contract.js';
import {
  referenceAnnotationAcceptanceIssues,
  referenceAnnotationReferences,
  referenceBlocksFromRawPages
} from '../core/reference-annotation.js';
import { requestAnnotationChunk, requestCitationAnnotation, requestReferenceAnnotation } from '../services/mistral-ocr.js';
import { referenceLinksContent, requestReferenceLinks } from '../services/mistral-reference-links.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const fixturePath = resolve(root, process.env.MEDRXIV_LINK_BENCHMARK_FIXTURE || 'public/data/stored/medrxiv.json');
const pdfPath = resolve(root, process.env.MEDRXIV_LINK_BENCHMARK_PDF || 'public/data/stored/medrxiv.pdf');
const outputDirectory = resolve(root, 'data/benchmarks');
const maximumProviderCalls = Number(process.env.MEDRXIV_LINK_BENCHMARK_MAX_CALLS || 12);
const broadCheckpointPath = process.env.MEDRXIV_LINK_BENCHMARK_BROAD_CHECKPOINT
  ? resolve(root, process.env.MEDRXIV_LINK_BENCHMARK_BROAD_CHECKPOINT)
  : null;
const referenceCheckpointPath = process.env.MEDRXIV_LINK_BENCHMARK_REFERENCE_CHECKPOINT
  ? resolve(root, process.env.MEDRXIV_LINK_BENCHMARK_REFERENCE_CHECKPOINT)
  : null;

if (!process.env.MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY is not configured.');

const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const rawPages = fixture.raw?.pages || [];
const storedReferences = fixture.annotations?.references?.references || [];
const base64 = (await readFile(pdfPath)).toString('base64');

if (!rawPages.length) throw new Error('The cached medRxiv fixture has no raw OCR pages.');
if (!storedReferences.length) throw new Error('The cached medRxiv fixture has no bibliography inventory.');

let providerCalls = 0;
const calls = [];
const call = async (stage, operation) => {
  if (providerCalls >= maximumProviderCalls) throw new Error(`Provider call budget exhausted before ${stage}.`);
  providerCalls += 1;
  const startedAt = Date.now();
  const result = await operation();
  calls.push({ stage, status: result.response?.status ?? null, elapsedMs: Date.now() - startedAt, usage: result.payload?.usage_info || result.payload?.usage || null });
  return result;
};

const parseAnnotation = (payload = {}) => {
  const value = payload.document_annotation;
  return typeof value === 'string' ? JSON.parse(value) : value;
};

console.log(JSON.stringify({
  fixture: fixturePath,
  pdf: pdfPath,
  cachedRawOcrPages: rawPages.length,
  cachedBibliographyReferences: storedReferences.length,
  rawOcrCalls: 0,
  bibliographyCalls: referenceCheckpointPath ? 0 : 1,
  maximumProviderCalls
}, null, 2));

const annotationChunks = broadCheckpointPath
  ? (JSON.parse(await readFile(broadCheckpointPath, 'utf8')).broadAnnotation?.responses || [])
  : [];
if (broadCheckpointPath && !annotationChunks.length) throw new Error('The supplied checkpoint has no reusable broad annotation responses.');
for (const record of annotationChunks) {
  const issues = documentAnnotationIssues(record.annotation);
  if (!Array.isArray(record.pages) || issues.length) throw new Error(`The reusable broad annotation checkpoint is invalid: ${issues.join(' ')}`);
}

const referenceBlocks = referenceBlocksFromRawPages(rawPages);
let referenceAnnotation = referenceCheckpointPath
  ? { references: JSON.parse(await readFile(referenceCheckpointPath, 'utf8')).bibliographyInventory?.references || [] }
  : null;
if (!referenceAnnotation) {
  const { response: referenceResponse, payload: referencePayload } = await call('bibliography-inventory', () => requestReferenceAnnotation({
    base64,
    referenceBlocks,
    env: process.env
  }));
  if (!referenceResponse.ok) throw new Error(`Bibliography annotation failed with HTTP ${referenceResponse.status}: ${referencePayload?.error?.message || referencePayload?.message || 'Unknown provider error'}`);
  referenceAnnotation = parseAnnotation(referencePayload);
}
const referenceIssues = referenceAnnotationAcceptanceIssues(referenceAnnotation, referenceBlocks);
if (referenceIssues.length) throw new Error(`Bibliography annotation contract failed: ${referenceIssues.join(' ')}`);
const annotatedReferences = referenceAnnotationReferences(referenceAnnotation);
for (const pages of (broadCheckpointPath ? [] : annotationPageRanges(rawPages.length))) {
  const sourcePageMap = documentAnnotationSourcePageMap(rawPages, pages);
  const format = documentAnnotationFormatForPages(pages, sourcePageMap);
  const prompt = documentAnnotationPromptForPages(pages, sourcePageMap);
  const { response, payload } = await call(`broad-annotation:${pages[0] + 1}-${pages.at(-1) + 1}`, () => requestAnnotationChunk({
    base64,
    pages,
    sourcePageMap,
    format,
    prompt,
    env: process.env
  }));
  if (!response.ok) throw new Error(`Broad annotation failed for pages ${pages[0] + 1}-${pages.at(-1) + 1} with HTTP ${response.status}: ${payload?.error?.message || payload?.message || 'Unknown provider error'}`);
  const annotation = parseAnnotation(payload);
  const issues = documentAnnotationIssues(annotation);
  if (issues.length) throw new Error(`Broad annotation contract failed for pages ${pages[0] + 1}-${pages.at(-1) + 1}: ${issues.join(' ')}`);
  annotationChunks.push({ pages, annotation, usage: payload?.usage_info || null });
}

const citationRanges = bodyCitationBlockRanges(annotationChunks, rawPages);
if (!citationRanges.length) throw new Error('Broad annotation returned no model-selected article blocks for focused citation extraction.');

const citationRecords = [];
for (const [index, range] of citationRanges.entries()) {
  const { response, payload } = await call(`body-citations:${range.pages[0] + 1}-${range.pages.at(-1) + 1}`, () => requestCitationAnnotation({
    base64,
    citationBlocks: range.blocks,
    env: process.env
  }));
  if (!response.ok) throw new Error(`Body citation annotation failed for pages ${range.pages[0] + 1}-${range.pages.at(-1) + 1} with HTTP ${response.status}: ${payload?.error?.message || payload?.message || 'Unknown provider error'}`);
  const annotation = parseAnnotation(payload);
  citationRecords.push({
    range_id: `citation-range-${index}`,
    pages: range.pages,
    supplied_blocks: range.blocks,
    citation_blocks: Array.isArray(annotation?.citation_blocks) ? annotation.citation_blocks : [],
    citation_mentions: citationAnnotationMentions(annotation, range.blocks),
    issues: citationAnnotationIssues(annotation, range.blocks)
  });
}

const grounded = bindCitationAnnotationRanges(citationRecords, rawPages);
const references = annotatedReferences.map((reference, index) => ({
  ...reference,
  number: index + 1,
  link_handle: reference.id
}));
const candidates = {
  references: references.map((reference) => ({ handle: reference.link_handle, printed_label: reference.printed_label, text: reference.text })),
  citation_mentions: grounded.candidates
};

if (!hasReferenceLinkCandidates(candidates)) throw new Error('The grounded reference-link candidate packet is malformed.');
if (!candidates.citation_mentions.length) throw new Error('Focused annotation returned no source-grounded body citations.');

const { response: relationResponse, payload: relationPayload } = await call('reference-relations', () => requestReferenceLinks({ candidates, env: process.env }));
if (!relationResponse.ok) throw new Error(`Reference relation mapping failed with HTTP ${relationResponse.status}: ${relationPayload?.error?.message || relationPayload?.message || 'Unknown provider error'}`);
const links = referenceLinksContent(relationPayload);
if (!hasValidReferenceLinks(links, candidates)) throw new Error('Reference relation mapping failed its handle-completeness contract.');

const linkedReferences = applyReferenceLinks(references, candidates, links);
const mappedReferences = linkedReferences.filter((reference) => reference.body_occurrences.length);
const unmappedReferences = linkedReferences.filter((reference) => !reference.body_occurrences.length);
const bibliographicDecisions = (links.citation_decisions || []).filter((decision) => decision.classification === 'bibliographic_citation');
const nonBibliographicDecisions = (links.citation_decisions || []).filter((decision) => decision.classification === 'not_bibliographic');
const mappedCitationHandles = new Set(bibliographicDecisions.map((decision) => decision.citation_handle));
const rejectedCitations = grounded.ranges.flatMap((range) => range.items.filter((item) => !item.accepted).map((item) => ({
  range: range.id,
  pages: range.pages,
  anchorText: item.anchorText,
  blockId: item.blockId,
  reasons: item.reasons
})));
const summary = {
  capturedAt: new Date().toISOString(),
  fixture: fixturePath,
  contracts: {
    broadAnnotation: annotationChunks[0]?.annotation ? 'deskreview_document_annotation_v16' : null,
    citation: 'deskreview_body_citations_v10',
    relation: 'deskreview_reference_relation_decisions_v4'
  },
  providerCalls,
  maximumProviderCalls,
  calls,
  broadAnnotation: {
    ranges: annotationChunks.map((record) => record.pages),
    modelSelectedArticleBlocks: citationRanges.reduce((total, range) => total + range.blocks.length, 0),
    citationRanges: citationRanges.map((range) => ({ pages: range.pages, blocks: range.blocks.length })),
    responses: annotationChunks
  },
  bibliographyInventory: {
    references: annotatedReferences,
    referenceBlocks: referenceBlocks.length,
    issues: referenceIssues
  },
  citationExtraction: {
    returned: grounded.ranges.reduce((total, range) => total + range.returned, 0),
    grounded: grounded.candidates.length,
    rejected: rejectedCitations.length,
    rejectedCitations,
    rangeIssues: citationRecords.filter((record) => record.issues.length).map((record) => ({ range: record.range_id, pages: record.pages, issues: record.issues })),
    responses: citationRecords,
    groundedCandidates: grounded.candidates
  },
  relationMapping: {
    mappedCitationOccurrences: mappedCitationHandles.size,
    nonBibliographicCitationOccurrences: nonBibliographicDecisions.map((decision) => decision.citation_handle),
    bibliographyReferences: linkedReferences.length,
    referencesWithOccurrences: mappedReferences.length,
    referenceCoveragePercent: Number(((mappedReferences.length / linkedReferences.length) * 100).toFixed(1)),
    unmappedReferences: unmappedReferences.map((reference) => ({ number: reference.number, text: reference.text })),
    candidates,
    links
  },
  linkedReferences
};

await mkdir(outputDirectory, { recursive: true });
const checkpointPath = resolve(outputDirectory, `medrxiv-reference-links-${Date.now()}.json`);
await writeFile(checkpointPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({
  checkpointPath,
  providerCalls,
  calls,
  citationExtraction: {
    returned: summary.citationExtraction.returned,
    grounded: summary.citationExtraction.grounded,
    rejected: summary.citationExtraction.rejected,
    rangeIssues: summary.citationExtraction.rangeIssues
  },
  relationMapping: {
    mappedCitationOccurrences: summary.relationMapping.mappedCitationOccurrences,
    nonBibliographicCitationOccurrences: summary.relationMapping.nonBibliographicCitationOccurrences.length,
    bibliographyReferences: summary.relationMapping.bibliographyReferences,
    referencesWithOccurrences: summary.relationMapping.referencesWithOccurrences,
    referenceCoveragePercent: summary.relationMapping.referenceCoveragePercent,
    unmappedReferenceNumbers: summary.relationMapping.unmappedReferences.map((reference) => reference.number)
  }
}, null, 2));

if (summary.relationMapping.referenceCoveragePercent !== 100
  || summary.citationExtraction.rejected) {
  process.exitCode = 1;
}
