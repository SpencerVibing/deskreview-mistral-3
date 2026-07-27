# DeskReview Mistral 3

Clean rebuild workspace. `deskreview-mistral-2` remains the visual and interaction reference; no runtime code is copied into this project.

## Starting Contract

- Preserve the established DeskReview reader UI and interaction contracts when a UI is introduced.
- Start with one Mistral OCR request as the primary source of truth.
- Render only returned pages, blocks, tables, images, coordinates, and model-authored annotation data.
- Never add local semantic reconstruction, resolver queues, reconciliation layers, or fallback guesses for manuscript structure.
- Keep layers one-way: `public/` UI, `app/` browser coordination, `core/` pure transforms, `services/` adapters, `server/` HTTP/provider orchestration.
- Add a cached fixture and browser test before each feature is added.
