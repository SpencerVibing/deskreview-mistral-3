import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const sourceRoots = ['core', 'services', 'server', 'public', 'netlify/functions', 'scripts', 'tests'];
const productionRoots = ['core', 'services', 'server', 'public', 'netlify/functions'];

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    if (entry.isFile() && /\.(?:js|mjs|html)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const allFiles = (await Promise.all(sourceRoots.map((directory) => filesUnder(join(root, directory)))))
  .flat()
  .map((path) => relative(root, path));

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf8');
}

async function filesMatching(pattern, { roots = sourceRoots, exclude = () => false } = {}) {
  const selected = allFiles.filter((file) => roots.some((rootName) => file === rootName || file.startsWith(`${rootName}/`)) && !exclude(file));
  const matches = [];
  for (const file of selected) {
    const text = await read(file);
    if (pattern.test(text)) matches.push(file);
  }
  return matches.sort();
}

const analysisService = await read('server/analysis-service.js');
assert.match(analysisService, /requestReferenceAnnotation/);
assert.match(analysisService, /import \{ requestDisplayLinks, displayLinksContent \} from '\.\.\/services\/mistral-display-links\.js';/);
assert.match(analysisService, /import \{ requestReferenceLinks, referenceLinksContent \} from '\.\.\/services\/mistral-reference-links\.js';/);

const mistralOcrService = await read('services/mistral-ocr.js');
assert.match(mistralOcrService, /documentAnnotationFormatForPages, documentAnnotationPromptForPages/);
assert.match(mistralOcrService, /from '\.\.\/core\/document-annotation\.js';/);
assert.match(mistralOcrService, /document_annotation_format: annotationFormat/);
assert.match(mistralOcrService, /document_annotation_prompt: prompt \|\| documentAnnotationPromptForPages/);
assert.doesNotMatch(mistralOcrService, /referenceSourceBindingCandidate/, 'candidate reference binding contracts must stay deleted');

const displayLinkService = await read('services/mistral-display-links.js');
assert.match(displayLinkService, /from '\.\.\/core\/display-links-contract\.js';/);
assert.match(displayLinkService, /\/chat\/completions/);
assert.doesNotMatch(displayLinkService, /reference_mappings|reference_mentions|uncited_reference/);
const referenceLinkService = await read('services/mistral-reference-links.js');
assert.match(referenceLinkService, /from '\.\.\/core\/reference-links-contract\.js';/);
assert.match(referenceLinkService, /\/chat\/completions/);

const productionFiles = allFiles.filter((file) => productionRoots.some((rootName) => file === rootName || file.startsWith(`${rootName}/`)));

const retiredPipelineFiles = allFiles.filter((file) => [
  'core/document-annotation-v2.js',
  'core/annotation-chunk-merge.js',
  'core/annotation-benchmark.js',
  'scripts/benchmark-annotation-v2.mjs',
  'scripts/capture-manuscript-fixture.mjs',
  'scripts/capture-oraktx-source-links.mjs',
  'scripts/complete-source-links-fixture.mjs'
].includes(file));
assert.deepEqual(retiredPipelineFiles, [], 'retired benchmark/capture pipeline paths must stay deleted');

const duplicateContractMentions = await filesMatching(/documentAnnotationFormatV2|documentAnnotationPromptV2|mergeAnnotationChunks|benchmarkAnnotationCandidate/, {
  roots: sourceRoots,
  exclude: (file) => file === 'tests/pipeline-ownership.test.mjs'
});
assert.deepEqual(duplicateContractMentions, [], 'do not reintroduce alternate annotation contracts, merge paths, or benchmark comparators');

const annotationContract = await read('core/document-annotation.js');
assert.doesNotMatch(annotationContract, /referenceSourceBindingCandidate|reference_mentions|bibliographySource|body_occurrences/);
assert.doesNotMatch(annotationContract, /bibliography\.blocks/);
const referenceContract = await read('core/reference-annotation.js');
assert.match(referenceContract, /referenceAnnotationFormat/);
assert.match(referenceContract, /referenceAnnotationPrompt/);
const referenceLinksContract = await read('core/reference-links-contract.js');
assert.match(referenceLinksContract, /referenceLinksFormat/);
assert.match(referenceLinksContract, /applyReferenceLinks/);

const productionAnnotationFormatWriters = await filesMatching(/document_annotation_format\s*:/, {
  roots: productionRoots
});
assert.deepEqual(productionAnnotationFormatWriters, ['services/mistral-ocr.js'], 'only services/mistral-ocr.js may send document_annotation_format');

const productionAnnotationPromptWriters = await filesMatching(/document_annotation_prompt\s*:/, {
  roots: productionRoots
});
assert.deepEqual(productionAnnotationPromptWriters, ['services/mistral-ocr.js'], 'only services/mistral-ocr.js may send document_annotation_prompt');

const productionQnaRequesters = await filesMatching(/\/chat\/completions|response_format:\s*sourceLinksFormat|requestSourceLinks\(|requestReferenceInventory\(/, {
  roots: productionRoots,
  exclude: (file) => file === 'server/analysis-service.js' || file === 'services/mistral-display-links.js' || file === 'services/mistral-reference-links.js'
});
assert.deepEqual(productionQnaRequesters, [], 'only approved analysis services may invoke bounded Document QnA stages');

const oldReferenceOwners = productionFiles.filter((file) => /reference-analysis-contract|reference-source-binding|mistral-reference-analysis|source-links-contract|mistral-source-links/.test(file));
assert.deepEqual(oldReferenceOwners, [], 'superseded reference inventory/source-link owners must stay deleted from production roots');

const semanticProviderLeak = await filesMatching(/MISTRAL_API_KEY|api\.mistral\.ai|\/chat\/completions/, {
  roots: ['public', 'core']
});
assert.deepEqual(semanticProviderLeak, [], 'browser and core modules must not contain provider credentials or direct provider endpoints');

const wordCountExporters = productionFiles.filter((file) => /(?:^|\/)article-word-count\.js$/.test(file));
assert.deepEqual(wordCountExporters, ['core/article-word-count.js']);

const inventory = await read('docs/pipeline-ownership-inventory.md');
for (const required of [
  'Raw OCR request owner: `services/mistral-ocr.js`',
  'Production annotation schema and prompt owner: `core/document-annotation.js`',
  'Annotation projection and display-link candidate assembly:',
  'Bibliography inventory schema, prompt, and source contract:',
  'Document QnA display-link request owner:',
  'Reference relation contract and passive validation:',
  'Stored-review persistence:'
]) {
  assert.match(inventory, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

console.log('pipeline ownership: ok');
