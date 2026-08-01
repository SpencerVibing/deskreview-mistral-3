import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  bindCitationAnnotationRanges,
  citationAnnotationIssues,
  citationAnnotationMentions
} from '../core/citation-annotation.js';
import {
  applyReferenceLinks,
  hasReferenceLinkCandidates,
  hasValidReferenceLinks
} from '../core/reference-links-contract.js';
import { referenceLinksContent, requestReferenceLinks } from '../services/mistral-reference-links.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const fixturePath = resolve(root, 'public/data/stored/medrxiv.json');
const checkpointPath = resolve(root, process.env.MEDRXIV_RELATION_BENCHMARK_CHECKPOINT
  || 'data/benchmarks/medrxiv-reference-links-1785582437537.json');
const outputDirectory = resolve(root, 'data/benchmarks');

if (!process.env.MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY is not configured.');

const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'));
const rawPages = fixture.raw?.pages || [];
const citationResponses = checkpoint.citationExtraction?.responses || [];
const bibliography = checkpoint.bibliographyInventory?.references || [];

if (!rawPages.length || !citationResponses.length || !bibliography.length) {
  throw new Error('The cached medRxiv checkpoint is incomplete.');
}

const records = citationResponses.map((record) => {
  const annotation = { citation_blocks: record.citation_blocks || [] };
  return {
    ...record,
    citation_mentions: citationAnnotationMentions(annotation, record.supplied_blocks || []),
    issues: citationAnnotationIssues(annotation, record.supplied_blocks || [])
  };
});
const grounded = bindCitationAnnotationRanges(records, rawPages);
const references = bibliography.map((reference, index) => ({
  ...reference,
  number: index + 1,
  link_handle: reference.id
}));
const candidates = {
  references: references.map((reference) => ({
    handle: reference.link_handle,
    printed_label: reference.printed_label,
    text: reference.text
  })),
  citation_mentions: grounded.candidates
};

if (!hasReferenceLinkCandidates(candidates)) throw new Error('The cached relation candidate packet is malformed.');

console.log(JSON.stringify({
  sourceCheckpoint: checkpointPath,
  rawOcrCalls: 0,
  broadAnnotationCalls: 0,
  bibliographyCalls: 0,
  bodyCitationCalls: 0,
  relationCalls: 1,
  references: candidates.references.length,
  groundedCandidates: candidates.citation_mentions.length,
  rejectedCandidates: grounded.ranges.reduce((total, range) => total + range.rejected, 0)
}, null, 2));

const startedAt = Date.now();
const { response, payload } = await requestReferenceLinks({ candidates, env: process.env });
const elapsedMs = Date.now() - startedAt;
if (!response.ok) throw new Error(`Reference relation mapping failed with HTTP ${response.status}: ${payload?.error?.message || payload?.message || 'Unknown provider error'}`);
const links = referenceLinksContent(payload);
if (!hasValidReferenceLinks(links, candidates)) throw new Error('Reference relation decisions failed their completeness contract.');

const linkedReferences = applyReferenceLinks(references, candidates, links);
const bibliographicDecisions = links.citation_decisions.filter((decision) => decision.classification === 'bibliographic_citation');
const nonBibliographicDecisions = links.citation_decisions.filter((decision) => decision.classification === 'not_bibliographic');
const candidateByHandle = new Map(candidates.citation_mentions.map((candidate) => [candidate.handle, candidate]));
const referencesWithOccurrences = linkedReferences.filter((reference) => reference.body_occurrences.length);
const summary = {
  capturedAt: new Date().toISOString(),
  sourceCheckpoint: checkpointPath,
  contract: 'deskreview_reference_relation_decisions_v4',
  providerCalls: 1,
  elapsedMs,
  usage: payload?.usage || null,
  candidates,
  links,
  audit: {
    bibliographyReferences: references.length,
    referencesWithOccurrences: referencesWithOccurrences.length,
    referenceCoveragePercent: Number(((referencesWithOccurrences.length / references.length) * 100).toFixed(1)),
    bibliographicCandidates: bibliographicDecisions.map((decision) => ({
      citation_handle: decision.citation_handle,
      citation_text: candidateByHandle.get(decision.citation_handle)?.citation_text || '',
      reference_handles: decision.reference_handles
    })),
    nonBibliographicCandidates: nonBibliographicDecisions.map((decision) => ({
      citation_handle: decision.citation_handle,
      citation_text: candidateByHandle.get(decision.citation_handle)?.citation_text || ''
    })),
    unmappedReferenceNumbers: linkedReferences.filter((reference) => !reference.body_occurrences.length).map((reference) => reference.number)
  },
  linkedReferences
};

await mkdir(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, `medrxiv-reference-relations-v4-${Date.now()}.json`);
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, ...summary.audit, elapsedMs }, null, 2));

if (summary.audit.referenceCoveragePercent !== 100) process.exitCode = 1;
