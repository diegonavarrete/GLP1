# glp1-cl

Landing page para **glp1.cl** — startup de telemedicina chileno enfocado en tratamiento con GLP-1 supervisado por médicos.

## Stack

- HTML/CSS estático
- Hospedado en **Cloudflare Workers** (static assets)

## Desarrollo local

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run deploy
```

## Estructura

```
.
├── public/
│   └── index.html      # Landing
├── wrangler.jsonc      # Config Cloudflare Workers
├── package.json
└── script.py           # Script auxiliar (modificación del HTML)
```
