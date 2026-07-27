# Cleanup Deletion Manifest

This cleanup removes only inactive files. Before deletion, `rg` across the
project found no imports, links, or active entry-point references to any path
below. The reader shell regression suite is run after deletion and covers the
home page, reader shell, Checks, Chat, Comments, and guideline selector.

| Path | Reason |
| --- | --- |
| `public/assets/ambient-paper-v1.svg` | Superseded by the active `ambient-paper-v2.svg`. |
| `public/assets/paper-texture-v3.svg` | Not referenced by any active stylesheet or markup. |
| `scripts/refresh-stored-annotations.mjs` | Hard-coded to one review and duplicated by the references-only script. |
| `scripts/refresh-stored-references.mjs` | Hard-coded duplicate of the annotation refresh script. |
| `scripts/capture-stored-review.mjs` | Invokes the retired multi-pass capture path; it is not an active product entry point. |

No user data, stored review JSON, PDFs, UI files, or active server routes are
included in this manifest.

