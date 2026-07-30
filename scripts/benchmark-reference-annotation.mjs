import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  referenceAnnotationFormat,
  referenceAnnotationIssues,
  referenceAnnotationPrompt,
  referenceAnnotationPages,
  referenceBlocksFromRawPages,
  referenceAnnotationContractVersion
} from '../core/reference-annotation.js';
import { requestAnnotationChunk } from '../services/mistral-ocr.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const fixturePath = resolve(root, process.env.REFERENCE_BENCHMARK_FIXTURE || 'public/data/stored/psyarxiv.json');
const pdfPath = resolve(root, process.env.REFERENCE_BENCHMARK_PDF || 'public/data/stored/psyarxiv.pdf');
const outputDirectory = resolve(root, 'data/benchmarks');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const rawPages = fixture.raw?.pages || fixture.pages || [];
const referenceBlocks = referenceBlocksFromRawPages(rawPages);
const pages = referenceAnnotationPages(referenceBlocks);
const format = referenceAnnotationFormat(referenceBlocks);
const prompt = referenceAnnotationPrompt(referenceBlocks);
const base64 = (await readFile(pdfPath)).toString('base64');

if (!process.env.MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY is not configured.');

console.log(JSON.stringify({
  contract: referenceAnnotationContractVersion,
  fixture: fixturePath,
  pdf: pdfPath,
  pages,
  referenceBlockCount: referenceBlocks.length,
  referenceCharacters: referenceBlocks.reduce((total, block) => total + block.text.length, 0),
  maximumProviderCalls: 1
}, null, 2));

const startedAt = Date.now();
const { response, payload } = await requestAnnotationChunk({
  base64,
  pages,
  format,
  prompt,
  env: process.env
});
const elapsedMs = Date.now() - startedAt;
const annotation = typeof payload.document_annotation === 'string'
  ? JSON.parse(payload.document_annotation)
  : payload.document_annotation;
const issues = response.ok ? referenceAnnotationIssues(annotation, referenceBlocks) : [];
const checkpoint = {
  capturedAt: new Date().toISOString(),
  contract: referenceAnnotationContractVersion,
  request: {
    pages,
    referenceBlockCount: referenceBlocks.length,
    referenceCharacters: referenceBlocks.reduce((total, block) => total + block.text.length, 0)
  },
  response: {
    status: response.status,
    elapsedMs,
    referenceCount: Array.isArray(annotation?.references) ? annotation.references.length : null,
    issues,
    usage: payload?.usage_info || null,
    annotation: annotation || null,
    providerError: response.ok ? null : payload?.error || payload?.message || null
  }
};
await mkdir(outputDirectory, { recursive: true });
const checkpointPath = resolve(outputDirectory, `reference-annotation-${Date.now()}.json`);
await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
console.log(JSON.stringify({ checkpointPath, ...checkpoint.response }, null, 2));
if (!response.ok || issues.length) process.exitCode = 1;
