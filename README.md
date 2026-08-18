# Pulso

Mini sistema de gestão das clínicas (Sorridents Centro e GIO Estética Avançada).

## Rodando localmente (opcional, para desenvolvimento)

```
npm install
cp .env.example .env
# edite .env com a URL e a chave publishable do seu projeto Supabase
npm run dev
```

## Publicando

Este projeto é feito para ser publicado no Cloudflare Pages, conectado a
este repositório no GitHub (build automático a cada atualização).

Antes do primeiro deploy, rode os scripts em `supabase/schema.sql` e
`supabase/criar_pessoas.sql` no SQL Editor do seu projeto Supabase.

Configure no Cloudflare Pages (Settings > Environment variables):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Build command: `npm run build`
Build output directory: `dist`
