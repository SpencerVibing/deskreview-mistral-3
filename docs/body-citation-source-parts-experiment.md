# Body Citation Source-Parts Experiment

Status: rejected on 2026-07-31; never promoted to the active pipeline.

One explicitly approved live `mistral-ocr-latest` request tested
`deskreview_body_citations_v6` on 15 cached medRxiv OCR blocks from PDF pages
13-15. The request completed in 5.975 seconds and returned all 15 block results
plus four citation mentions.

All four exact-source checks failed. Although the prompt supplied Unicode raw
OCR and required character-for-character copying, Mistral rewrote the citation
markers as LaTeX:

- `¹⁷` became `\\( ^{17} \\)`;
- `¹⁸⁻²⁰` became `\\( ^{18-20} \\)`;
- `²¹` became `\\( ^{21} \\)`;
- `²²` became `\\( ^{22} \\)`.

The source-parts shape therefore did not solve OCR/PDF encoding divergence.
The validator correctly failed closed. No retry or Document QnA call ran, and
the active production contract remained v5.
