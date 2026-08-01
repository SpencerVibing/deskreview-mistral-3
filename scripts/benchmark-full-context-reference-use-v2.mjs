import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { citationBlocksFromAnnotation } from '../core/citation-annotation.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const contractVersion = 'deskreview_full_context_reference_use_v2';
const fixture = JSON.parse(await readFile(resolve(root, 'public/data/stored/psyarxiv.json'), 'utf8'));
const broadCheckpoint = JSON.parse(await readFile(resolve(root, 'data/benchmarks/psyarxiv-after-reference-schema-fix-2026-07-28T18-44-43-704Z-complete.json'), 'utf8'));
const annotationChunks = broadCheckpoint.broadAnnotation?.responses || broadCheckpoint.annotation?.chunks || [];
const articleBlocks = citationBlocksFromAnnotation(annotationChunks, fixture.raw.pages);
const references = fixture.annotations.references.references.map((reference, index) => ({
  handle: `reference:${index}`,
  printed_label: String(reference.printed_label || reference.number || ''),
  text: String(reference.text || '')
}));

if (!process.env.MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY is not configured.');
if (!articleBlocks.length || references.length !== 64 || references.some((reference) => !reference.text)) {
  throw new Error('The immutable psyArXiv fixture is incomplete.');
}

const blockIds = articleBlocks.map((block) => block.blockId);
const referenceHandles = references.map((reference) => reference.handle);
const responseFormat = {
  type: 'json_schema',
  json_schema: {
    name: contractVersion,
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['citation_blocks'],
      properties: {
        citation_blocks: {
          type: 'array',
          minItems: articleBlocks.length,
          maxItems: articleBlocks.length,
          description: 'Exactly one result for every supplied raw OCR article block, in the same order.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['ocr_block_id', 'citation_occurrences'],
            properties: {
              ocr_block_id: { type: 'string', enum: blockIds, description: 'Exact opaque ID copied from the corresponding supplied block header.' },
              citation_occurrences: {
                type: 'array',
                maxItems: 64,
                description: 'Every physical bibliographic citation occurrence wholly contained in this block, in reading order. Empty when none occur.',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['exact_quote', 'reference_handles'],
                  properties: {
                    exact_quote: {
                      type: 'string',
                      minLength: 1,
                      maxLength: 800,
                      description: 'Complete citation marker or group copied character-for-character as a literal substring of this block. Preserve narrative form, delimiters, punctuation, spacing, accents, and dash characters.'
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
              }
            }
          }
        }
      }
    }
  }
};

const blockPacket = articleBlocks.map((block) => `BEGIN ${block.blockId}\n${block.text}\nEND ${block.blockId}`).join('\n\n');
const prompt = [
  'Perform one complete reference-use analysis over the supplied immutable raw OCR article blocks and bibliography.',
  `Return citation_blocks with exactly ${articleBlocks.length} results, one per supplied block in the same order. Copy each block ID exactly. Analyze only the text between that result's matching BEGIN and END markers.`,
  'Within each block result, return every physical bibliographic citation occurrence wholly contained in that block. Use an empty array when none occur. Never move, copy, or infer a citation from another block.',
  'For exact_quote, copy the complete citation marker or group character-for-character from that block. A parenthetical group retains both delimiters and all members. A narrative citation retains the author text before the year parentheses. Never normalize, paraphrase, repair, split, or reconstruct source text.',
  'Map each occurrence to every bibliography handle it cites. Resolve numeric, author-year, narrative, grouped, multi-year, et al., accent, punctuation, and minor printed author-form variations using the supplied bibliography.',
  'Ignore tables, figures, confidence intervals, statistical values, measurements, identifiers, hypotheses, dates, and other non-bibliographic parenthetical text. Do not create an uncited-reference list and do not force every bibliography handle to appear.',
  'Use only supplied handles and block IDs. Return JSON only.',
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
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MISTRAL_API_KEY}` },
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
try { payload = JSON.parse(responseText); } catch { /* Validation reports malformed provider output. */ }
if (!response.ok) throw new Error(`Full-context v2 request failed with HTTP ${response.status}: ${responseText.slice(0, 500)}`);
let result = {};
try { result = JSON.parse(payload.choices?.[0]?.message?.content || '{}'); } catch { /* Validation reports malformed model output. */ }

const issues = [];
const coveredHandles = new Set();
const sourceOccurrenceCounts = new Map();
const returnedOccurrenceCounts = new Map();
if (!Array.isArray(result.citation_blocks)) issues.push('Missing citation_blocks array.');
if ((result.citation_blocks || []).length !== articleBlocks.length) issues.push(`Expected ${articleBlocks.length} block results but received ${(result.citation_blocks || []).length}.`);

(result.citation_blocks || []).forEach((blockResult, blockIndex) => {
  const expectedBlock = articleBlocks[blockIndex];
  if (!expectedBlock || blockResult?.ocr_block_id !== expectedBlock.blockId) {
    issues.push(`Block result ${blockIndex + 1} does not preserve the supplied block order and ID.`);
    return;
  }
  if (!Array.isArray(blockResult.citation_occurrences)) {
    issues.push(`Block ${expectedBlock.blockId} has no citation_occurrences array.`);
    return;
  }
  blockResult.citation_occurrences.forEach((occurrence, occurrenceIndex) => {
    const exactQuote = String(occurrence?.exact_quote || '');
    const handles = Array.isArray(occurrence?.reference_handles) ? occurrence.reference_handles : [];
    if (!exactQuote || !expectedBlock.text.includes(exactQuote)) issues.push(`Block ${expectedBlock.blockId} occurrence ${occurrenceIndex + 1} has an ungrounded exact quote.`);
    if (!handles.length || handles.some((handle) => !referenceHandles.includes(handle)) || new Set(handles).size !== handles.length) issues.push(`Block ${expectedBlock.blockId} occurrence ${occurrenceIndex + 1} has invalid reference handles.`);
    const sourceKey = `${expectedBlock.blockId}\u001f${exactQuote}`;
    if (!sourceOccurrenceCounts.has(sourceKey)) {
      let count = 0;
      let offset = 0;
      while (exactQuote && (offset = expectedBlock.text.indexOf(exactQuote, offset)) !== -1) {
        count += 1;
        offset += exactQuote.length;
      }
      sourceOccurrenceCounts.set(sourceKey, count);
    }
    const returnedCount = (returnedOccurrenceCounts.get(sourceKey) || 0) + 1;
    returnedOccurrenceCounts.set(sourceKey, returnedCount);
    if (returnedCount > sourceOccurrenceCounts.get(sourceKey)) issues.push(`Block ${expectedBlock.blockId} returns ${JSON.stringify(exactQuote)} more often than it occurs.`);
    handles.forEach((handle) => coveredHandles.add(handle));
  });
});

const physicalOccurrences = (result.citation_blocks || []).reduce((total, block) => total + (block.citation_occurrences?.length || 0), 0);
const mappedUses = (result.citation_blocks || []).reduce((total, block) => total + (block.citation_occurrences || []).reduce((subtotal, occurrence) => subtotal + (occurrence.reference_handles?.length || 0), 0), 0);
const uncitedReferenceHandles = referenceHandles.filter((handle) => !coveredHandles.has(handle));
const acceptance = {
  blockContractComplete: (result.citation_blocks || []).length === articleBlocks.length && !issues.some((issue) => issue.includes('block order and ID') || issue.includes('no citation_occurrences array')),
  allSourceQuotesGrounded: !issues.some((issue) => issue.includes('ungrounded exact quote') || issue.includes('more often than it occurs')),
  expectedCitedReferences: coveredHandles.size === 64,
  expectedMappedUses: mappedUses === 133,
  noContractIssues: issues.length === 0
};
const passed = Object.values(acceptance).every(Boolean);
const summary = {
  capturedAt: new Date().toISOString(),
  reviewId: 'psyarxiv',
  contract: contractVersion,
  model,
  providerCalls: 1,
  sources: { rawOcr: 'stored', broadAnnotation: 'cached', bibliography: 'stored' },
  input: { articleBlocks: articleBlocks.length, bibliographyReferences: references.length, promptCharacters: prompt.length },
  elapsedMs,
  output: { physicalOccurrences, mappedUses, citedReferences: coveredHandles.size, uncitedReferences: uncitedReferenceHandles.length, uncitedReferenceHandles },
  acceptance,
  passed,
  issues,
  result,
  usage: payload.usage || null
};

const outputDirectory = resolve(root, 'data/benchmarks');
await mkdir(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, `psyarxiv-full-context-reference-use-v2-${Date.now()}.json`);
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, ...summary, result: undefined }, null, 2));
if (!passed) process.exitCode = 1;
