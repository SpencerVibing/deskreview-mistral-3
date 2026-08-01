import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { citationBlocksFromAnnotation } from '../core/citation-annotation.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const reviewId = 'psyarxiv';
const contractVersion = 'deskreview_full_context_reference_use_v1';
const outputDirectory = resolve(root, 'data/benchmarks');
const fixture = JSON.parse(await readFile(resolve(root, 'public/data/stored/psyarxiv.json'), 'utf8'));
const broadCheckpoint = JSON.parse(await readFile(
  resolve(root, 'data/benchmarks/psyarxiv-after-reference-schema-fix-2026-07-28T18-44-43-704Z-complete.json'),
  'utf8'
));

if (!process.env.MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY is not configured.');

const annotationChunks = broadCheckpoint.broadAnnotation?.responses || broadCheckpoint.annotation?.chunks || [];
const articleBlocks = citationBlocksFromAnnotation(annotationChunks, fixture.raw.pages);
const references = fixture.annotations.references.references.map((reference, index) => ({
  handle: `reference:${index}`,
  printed_label: String(reference.printed_label || reference.number || ''),
  text: String(reference.text || '')
}));

if (!articleBlocks.length || references.length !== 64 || references.some((reference) => !reference.text)) {
  throw new Error('The immutable psyArXiv fixture is incomplete.');
}

const referenceHandles = references.map((reference) => reference.handle);
const blockIds = articleBlocks.map((block) => block.blockId);
const responseFormat = {
  type: 'json_schema',
  json_schema: {
    name: contractVersion,
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['citation_occurrences', 'uncited_reference_handles'],
      properties: {
        citation_occurrences: {
          type: 'array',
          maxItems: 512,
          description: 'Every physical bibliographic citation occurrence in the supplied article blocks, in manuscript order.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['ocr_block_id', 'exact_quote', 'reference_handles'],
            properties: {
              ocr_block_id: {
                type: 'string',
                enum: blockIds,
                description: 'The exact opaque ID of the supplied raw OCR article block containing this occurrence.'
              },
              exact_quote: {
                type: 'string',
                minLength: 1,
                maxLength: 800,
                description: 'The complete citation marker or group copied character-for-character as one contiguous literal substring of the declared raw OCR block. Preserve narrative form, delimiters, punctuation, spacing, accents, and dash characters.'
              },
              reference_handles: {
                type: 'array',
                minItems: 1,
                maxItems: references.length,
                items: { type: 'string', enum: referenceHandles },
                description: 'Every supplied bibliography handle cited by this physical occurrence.'
              }
            }
          }
        },
        uncited_reference_handles: {
          type: 'array',
          maxItems: references.length,
          items: { type: 'string', enum: referenceHandles },
          description: 'Every supplied bibliography handle with no occurrence anywhere in the supplied article blocks.'
        }
      }
    }
  }
};

const blockPacket = articleBlocks
  .map((block) => `BEGIN ${block.blockId}\n${block.text}\nEND ${block.blockId}`)
  .join('\n\n');
const prompt = [
  'Perform one complete reference-use analysis over the supplied immutable raw OCR article blocks and bibliography.',
  'Return every physical bibliographic citation occurrence exactly once, in manuscript order. A grouped citation is one occurrence and may map to several reference handles. Repeated physical uses must remain separate occurrences.',
  'For exact_quote, copy the complete citation marker or group character-for-character only from between the declared block\'s BEGIN and END markers. Parenthetical groups retain both delimiters and all members. Narrative citations retain the author text before the year parentheses. Never normalize, paraphrase, repair, split, or reconstruct source text.',
  'Resolve numeric, author-year, narrative, grouped, multi-year, et al., accent, punctuation, and minor printed author-form variations using the supplied bibliography. For example, one multi-year citation may map to multiple works by the same author.',
  'Ignore tables, figures, confidence intervals, statistical values, measurements, identifiers, hypotheses, dates, and other non-bibliographic parenthetical text.',
  'Every bibliography handle must be covered by at least one citation occurrence or appear exactly once in uncited_reference_handles, never both. Use only supplied handles and block IDs. Return JSON only.',
  'BIBLIOGRAPHY HANDLES:',
  JSON.stringify(references),
  'AUTHORITATIVE RAW OCR ARTICLE BLOCKS:',
  blockPacket
].join('\n\n');

const endpoint = `${String(process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1').replace(/\/+$/, '')}/chat/completions`;
const model = process.env.MISTRAL_REFERENCE_USE_MODEL || process.env.MISTRAL_REFERENCE_LINKS_MODEL || 'mistral-large-2512';
const startedAt = Date.now();
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`
  },
  body: JSON.stringify({
    model,
    temperature: 0,
    top_p: 1,
    max_tokens: Number(process.env.MISTRAL_REFERENCE_USE_MAX_TOKENS || 24576),
    response_format: responseFormat,
    messages: [{ role: 'user', content: prompt }]
  }),
  signal: AbortSignal.timeout(Number(process.env.MISTRAL_REFERENCE_USE_TIMEOUT_MS || 240000))
});
const responseText = await response.text();
const elapsedMs = Date.now() - startedAt;
let payload = {};
try { payload = JSON.parse(responseText); } catch { /* Reported below without repair. */ }
if (!response.ok) throw new Error(`Full-context reference-use request failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`);

let result = {};
try { result = JSON.parse(payload.choices?.[0]?.message?.content || '{}'); } catch { /* Validation reports the malformed result. */ }

const blocksById = new Map(articleBlocks.map((block) => [block.blockId, block]));
const allowedHandles = new Set(referenceHandles);
const issues = [];
const seenOccurrences = new Set();
const coveredHandles = new Set();
const uncitedHandles = new Set();
if (!Array.isArray(result.citation_occurrences)) issues.push('Missing citation_occurrences array.');
if (!Array.isArray(result.uncited_reference_handles)) issues.push('Missing uncited_reference_handles array.');

(result.citation_occurrences || []).forEach((occurrence, index) => {
  const block = blocksById.get(occurrence?.ocr_block_id);
  const exactQuote = String(occurrence?.exact_quote || '');
  const handles = Array.isArray(occurrence?.reference_handles) ? occurrence.reference_handles : [];
  if (!block) issues.push(`Occurrence ${index + 1} declares an unknown OCR block.`);
  if (!exactQuote || !block?.text.includes(exactQuote)) issues.push(`Occurrence ${index + 1} has an ungrounded exact quote.`);
  if (!handles.length || handles.some((handle) => !allowedHandles.has(handle)) || new Set(handles).size !== handles.length) {
    issues.push(`Occurrence ${index + 1} has invalid reference handles.`);
  }
  const occurrenceKey = `${occurrence?.ocr_block_id || ''}\u001f${exactQuote}`;
  if (seenOccurrences.has(occurrenceKey)) issues.push(`Occurrence ${index + 1} duplicates an earlier physical source occurrence.`);
  seenOccurrences.add(occurrenceKey);
  handles.forEach((handle) => coveredHandles.add(handle));
});

(result.uncited_reference_handles || []).forEach((handle) => {
  if (!allowedHandles.has(handle)) issues.push('The uncited list contains an unknown reference handle.');
  if (uncitedHandles.has(handle)) issues.push(`The uncited list repeats ${handle}.`);
  uncitedHandles.add(handle);
});

referenceHandles.forEach((handle) => {
  if (coveredHandles.has(handle) && uncitedHandles.has(handle)) issues.push(`${handle} is both cited and uncited.`);
  if (!coveredHandles.has(handle) && !uncitedHandles.has(handle)) issues.push(`${handle} is absent from both cited and uncited results.`);
});

const mappedUses = (result.citation_occurrences || []).reduce(
  (total, occurrence) => total + (Array.isArray(occurrence.reference_handles) ? occurrence.reference_handles.length : 0),
  0
);
const acceptance = {
  allSourceQuotesGrounded: !issues.some((issue) => issue.includes('ungrounded exact quote')),
  allHandlesAccountedFor: referenceHandles.every((handle) => coveredHandles.has(handle) || uncitedHandles.has(handle)),
  expectedCitedReferences: coveredHandles.size === 64,
  expectedMappedUses: mappedUses === 133,
  noContractIssues: issues.length === 0
};
const passed = Object.values(acceptance).every(Boolean);
const summary = {
  capturedAt: new Date().toISOString(),
  reviewId,
  contract: contractVersion,
  model,
  providerCalls: 1,
  sources: { rawOcr: 'stored', broadAnnotation: 'cached', bibliography: 'stored' },
  input: { articleBlocks: articleBlocks.length, bibliographyReferences: references.length, promptCharacters: prompt.length },
  elapsedMs,
  output: {
    physicalOccurrences: result.citation_occurrences?.length || 0,
    mappedUses,
    citedReferences: coveredHandles.size,
    uncitedReferences: uncitedHandles.size
  },
  acceptance,
  passed,
  issues,
  result,
  usage: payload.usage || null
};

await mkdir(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, `psyarxiv-full-context-reference-use-${Date.now()}.json`);
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, ...summary, result: undefined }, null, 2));
if (!passed) process.exitCode = 1;
