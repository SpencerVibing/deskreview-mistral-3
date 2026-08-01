import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  citationAnnotationContractVersion,
  citationAnnotationIssues,
  citationAnnotationMentions,
  citationAnnotationPages
} from '../core/citation-annotation.js';
import { requestCitationAnnotation } from '../services/mistral-ocr.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const fixturePath = resolve(root, process.env.CITATION_BENCHMARK_FIXTURE || 'public/data/stored/medrxiv.json');
const pdfPath = resolve(root, process.env.CITATION_BENCHMARK_PDF || 'public/data/stored/medrxiv.pdf');
const outputDirectory = resolve(root, 'data/benchmarks');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const rawPages = fixture.raw?.pages || [];

// Immutable medRxiv acceptance packet around the previously failing page-break
// citation. This benchmark never discovers or changes manuscript semantics.
const acceptanceBlockIds = [
  'ocr-block-12-1', 'ocr-block-12-2', 'ocr-block-12-4', 'ocr-block-12-6', 'ocr-block-12-7', 'ocr-block-12-8',
  'ocr-block-13-1', 'ocr-block-13-2', 'ocr-block-13-3', 'ocr-block-13-5',
  'ocr-block-14-1', 'ocr-block-14-3', 'ocr-block-14-5', 'ocr-block-14-7', 'ocr-block-14-9'
];
const citationBlocks = acceptanceBlockIds.map((blockId) => {
  const match = /^ocr-block-(\d+)-(\d+)$/.exec(blockId);
  if (!match) throw new Error(`Invalid acceptance block ID: ${blockId}`);
  const pageIndex = Number(match[1]);
  const blockIndex = Number(match[2]);
  const text = String(rawPages[pageIndex]?.blocks?.[blockIndex]?.content || '');
  if (!text) throw new Error(`Cached medRxiv OCR block is unavailable: ${blockId}`);
  return { pageIndex, pageId: `ocr-page-${pageIndex}`, blockIndex, blockId, text };
});
const pages = citationAnnotationPages(citationBlocks);
const base64 = (await readFile(pdfPath)).toString('base64');

if (!process.env.MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY is not configured.');

console.log(JSON.stringify({
  contract: citationAnnotationContractVersion,
  fixture: fixturePath,
  pdf: pdfPath,
  pages,
  citationBlockCount: citationBlocks.length,
  maximumProviderCalls: 1
}, null, 2));

const startedAt = Date.now();
const { response, payload } = await requestCitationAnnotation({
  base64,
  citationBlocks,
  env: process.env
});
const elapsedMs = Date.now() - startedAt;
const annotation = typeof payload.document_annotation === 'string'
  ? JSON.parse(payload.document_annotation)
  : payload.document_annotation;
const issues = response.ok ? citationAnnotationIssues(annotation, citationBlocks) : [];
const mentions = citationAnnotationMentions(annotation, range.blocks);
const checkpoint = {
  capturedAt: new Date().toISOString(),
  contract: citationAnnotationContractVersion,
  request: {
    pages,
    citationBlockIds: acceptanceBlockIds,
    citationBlockCount: citationBlocks.length,
    maximumProviderCalls: 1
  },
  response: {
    status: response.status,
    elapsedMs,
    citationBlockCount: Array.isArray(annotation?.citation_blocks) ? annotation.citation_blocks.length : null,
    citationMentionCount: mentions.length,
    issues,
    usage: payload?.usage_info || null,
    annotation: annotation || null,
    providerError: response.ok ? null : payload?.error || payload?.message || null
  }
};
await mkdir(outputDirectory, { recursive: true });
const checkpointPath = resolve(outputDirectory, `body-citation-${citationAnnotationContractVersion}-medrxiv-${Date.now()}.json`);
await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
console.log(JSON.stringify({ checkpointPath, ...checkpoint.response, annotation: undefined }, null, 2));
if (!response.ok || issues.length) process.exitCode = 1;
