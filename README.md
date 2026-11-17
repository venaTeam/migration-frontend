# migration-frontend

Alert Migration UI — React + TypeScript (Vite) frontend for migrating Grafana alert rules to the v2 standard.

## Development

```bash
npm install
BACKEND_URL=http://localhost:8000 npm run dev   # /api is proxied to the backend
npm test                                         # vitest
npm run build                                    # type-check + production build
```

## Docker

```bash
docker build -t migration-frontend .
docker run -p 8080:80 -e BACKEND_URL=http://migration-backend:8000 migration-frontend
```

nginx serves the SPA and proxies `/api/` to `BACKEND_URL`, so auth cookies stay same-origin.
Set the build arg `VITE_API_BASE_URL` only if the API lives on a different origin.
