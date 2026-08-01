import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  citationAnnotationContractVersion,
  citationAnnotationIssues,
  citationAnnotationMentions
} from '../core/citation-annotation.js';
import { requestCitationAnnotation } from '../services/mistral-ocr.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const outputDirectory = resolve(root, 'data/benchmarks');
const cases = [
  {
    reviewId: 'psyarxiv',
    checkpoint: 'data/benchmarks/psyarxiv-reference-pipeline-1785584128883.json',
    groups: [
      {
        blockIds: ['ocr-block-3-2'],
        expected: [
          '(Deery, 1999; McKenna et al., 2006; Lee et al., 2008)',
          'Waller et al. (2001)'
        ]
      },
      {
        blockIds: ['ocr-block-6-6'],
        expected: ['(Dula & Ballard, 2003; Sánchez-López et al., 2024; Willemsen et al., 2008)']
      },
      {
        blockIds: ['ocr-block-17-1'],
        expected: ['(de Winter & Dodou, 2010; Hatfield & Fernandes, 2009; Jonah, 1990; Megías-Robles et al., 2022; Navon-Eyal & Taubman-Ben-Ari, 2020; Rhodes & Pivik, 2011)']
      }
    ]
  },
  {
    reviewId: 'eartharxiv',
    checkpoint: 'data/benchmarks/eartharxiv-reference-pipeline-1785584339788.json',
    groups: [
      {
        blockIds: ['ocr-block-8-7'],
        expected: ['Shalimov and Riabova (2021)']
      },
      {
        blockIds: ['ocr-block-10-6', 'ocr-block-11-2'],
        expected: [
          '(Rycroft et al., 2000; Sorokin and Ruzhin, 2015)',
          'Fleischer (1981)'
        ]
      }
    ]
  }
];

if (!process.env.MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY is not configured.');

const annotationValue = (payload = {}) => {
  const value = payload.document_annotation;
  return typeof value === 'string' ? JSON.parse(value) : value;
};

const results = [];
let providerCalls = 0;

for (const testCase of cases) {
  const checkpoint = JSON.parse(await readFile(resolve(root, testCase.checkpoint), 'utf8'));
  const sourceBlocks = new Map(
    checkpoint.citationExtraction.responses
      .flatMap((response) => response.supplied_blocks || [])
      .map((block) => [block.blockId, block])
  );
  const base64 = (await readFile(resolve(root, `public/data/stored/${testCase.reviewId}.pdf`))).toString('base64');

  for (const group of testCase.groups) {
    const citationBlocks = group.blockIds.map((blockId) => sourceBlocks.get(blockId));
    if (citationBlocks.some((block) => !block)) throw new Error(`Missing cached OCR block for ${testCase.reviewId}: ${group.blockIds.join(', ')}`);

    providerCalls += 1;
    if (providerCalls > 5) throw new Error('The five-call experiment budget was exceeded.');
    const startedAt = Date.now();
    const { response, payload } = await requestCitationAnnotation({
      base64,
      citationBlocks,
      env: process.env
    });
    const elapsedMs = Date.now() - startedAt;
    if (!response.ok) throw new Error(`${testCase.reviewId} citation request failed with HTTP ${response.status}.`);

    const annotation = annotationValue(payload);
    const issues = citationAnnotationIssues(annotation, citationBlocks);
    const mentions = citationAnnotationMentions(annotation, citationBlocks);
    const returned = mentions.map((mention) => mention.label);
    const missingExpected = group.expected.filter((expected) => !returned.includes(expected));
    results.push({
      reviewId: testCase.reviewId,
      blockIds: group.blockIds,
      elapsedMs,
      expected: group.expected,
      returned,
      issues,
      missingExpected,
      passed: issues.length === 0 && missingExpected.length === 0,
      response: annotation,
      usage: payload?.usage_info || payload?.usage || null
    });
  }
}

const summary = {
  capturedAt: new Date().toISOString(),
  contract: citationAnnotationContractVersion,
  providerCalls,
  maximumProviderCalls: 5,
  passed: results.every((result) => result.passed),
  results
};

await mkdir(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, `citation-exact-copy-${citationAnnotationContractVersion}-${Date.now()}.json`);
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath,
  contract: summary.contract,
  providerCalls,
  passed: summary.passed,
  results: results.map(({ reviewId, blockIds, elapsedMs, expected, returned, issues, missingExpected, passed }) => ({
    reviewId,
    blockIds,
    elapsedMs,
    expected,
    returned,
    issues,
    missingExpected,
    passed
  }))
}, null, 2));

if (!summary.passed) process.exitCode = 1;
