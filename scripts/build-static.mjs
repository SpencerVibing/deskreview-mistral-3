import { cp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const dist = join(root, 'dist');

const browserCoreFiles = [
  'affiliation-linkage.js',
  'annotation-manifest.js',
  'annotation-stages.js',
  'article-word-count.js',
  'author-profiles.js',
  'document-annotation-validation.js',
  'document-annotation.js',
  'mistral-annotation-contract.js',
  'source-anchor.js'
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, 'public'), dist, { recursive: true });
await mkdir(join(dist, 'core'), { recursive: true });
await Promise.all(browserCoreFiles.map((file) => cp(join(root, 'core', file), join(dist, 'core', file))));
await cp(join(root, 'node_modules/bootstrap/dist'), join(dist, 'vendor/bootstrap'), { recursive: true });
await cp(join(root, 'node_modules/bootstrap-icons/font'), join(dist, 'vendor/bootstrap-icons'), { recursive: true });
await cp(join(root, 'node_modules/katex/dist'), join(dist, 'vendor/katex'), { recursive: true });
await cp(join(root, 'node_modules/pdfjs-dist'), join(dist, 'vendor/pdfjs'), { recursive: true });

console.log('Built static site in dist/.');
