# DeskReview Mistral 3

DeskReview uses one Mistral OCR request per upload. That request returns both raw OCR pages and one source-grounded document annotation. The browser renders returned values and validates declared source anchors; it never reconstructs manuscript structure locally.

## Layout

- `public/`: static UI, browser coordination, and stored examples.
- `core/`: pure source-anchor and annotation-contract validation.
- `services/`: Mistral provider adapter.
- `server/`: HTTP handling, abuse protection, and local development server.
- `netlify/functions/`: Netlify adapter for the same analysis service.
- `tests/`: core, provider-contract, and browser regression coverage.

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
```

`APP_ORIGIN` is required in production: OCR requests without that exact Origin header are rejected. The in-memory rate limit protects a single running server or warm serverless instance; use a shared rate-limit store before horizontally scaling production traffic.

`netlify.toml` publishes `public/` and maps `/api/ocr/analyse` to the Netlify function. Netlify synchronous function limits still apply, so this deployment is appropriate only while the single Mistral request reliably finishes within the platform timeout. A long-running container is the production path for larger or slower manuscripts.

## Verification

```sh
npm run check
npm test
```
