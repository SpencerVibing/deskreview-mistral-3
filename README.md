# DeskReview Mistral 3

DeskReview renders one full-document Mistral raw OCR response first, then runs bounded Mistral document-annotation chunks for source-grounded counts. The browser renders returned values and validates declared source anchors; it never reconstructs manuscript structure locally.

## Layout

- `public/`: static UI, browser coordination, and stored examples.
- `core/`: pure source-anchor and annotation-contract validation.
- `services/`: Mistral provider adapter.
- `server/`: HTTP handling, abuse protection, and local development server.
- `netlify/functions/`: Netlify adapter for the same analysis service.
- `tests/`: core, provider-contract, and browser regression coverage.

Author-profile lookups run separately, after the source-grounded author list is available. They never delay OCR, manuscript counts, or source links. The lookup uses the public OpenAlex API without an API key, displays an OpenAlex or ORCID link only for an exact normalized name match, and otherwise offers a Google Scholar search link. Requests are paced to respect OpenAlex limits; a temporary provider failure is shown as unavailable rather than incorrectly classified as no profile. Set `OPENALEX_MAILTO` to a monitored contact address to identify production traffic to OpenAlex.

## Local Development

Create `.env` with `MISTRAL_API_KEY`, then run:

```sh
npm start
```

The local reader runs at `http://127.0.0.1:8893`.

## Production Security

Set these host-managed environment variables. Never expose `MISTRAL_API_KEY` to the browser or commit it.

```text
NODE_ENV=production
MISTRAL_API_KEY=...
APP_ORIGIN=https://deskreview.ai
OCR_RATE_LIMIT_MAX=5
OCR_RATE_LIMIT_WINDOW_MS=60000
OCR_MAX_CONCURRENT=2
AUTHOR_PROFILE_RATE_LIMIT_MAX=10
AUTHOR_PROFILE_MAX_CONCURRENT=3
OPENALEX_MAILTO=contact@example.org
```

`APP_ORIGIN` is required in production: OCR requests without that exact Origin header are rejected. The in-memory rate limit protects a single running server or warm serverless instance; use a shared rate-limit store before horizontally scaling production traffic.

`netlify.toml` runs `npm run build`, publishes `dist/`, and maps the split OCR stages (`/api/ocr/raw`, `/api/ocr/annotate`, and `/api/ocr/source-links`) to Netlify functions. Netlify synchronous function limits still apply, so this deployment is appropriate only while each bounded stage reliably finishes within the platform timeout. A long-running container remains the production path for larger or slower manuscripts.

## Verification

```sh
npm run check
npm test
```

## Knowledge References

- [Citation style and error knowledge](docs/citation-style-and-error-knowledge.md)
