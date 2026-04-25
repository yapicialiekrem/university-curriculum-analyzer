# UniCurriculum — Frontend

Next.js 16 (App Router) + Tailwind 4 + Recharts dashboard.

## Geliştirme

```bash
# Backend (ayrı terminal):
cd ../src && uvicorn main:app --reload

# Frontend:
npm install
npm run dev      # http://localhost:3000
```

`NEXT_PUBLIC_API_BASE` env ile backend URL'i değiştirilebilir
(default: `http://127.0.0.1:8000`).

## Yapı

```
src/
├── app/                  Next App Router (layout, page)
├── components/
│   ├── charts/           Recharts wrapper'lar
│   ├── cards/            Üniversite kartı
│   ├── selectors/        Üniversite picker, dept tabs
│   └── layers/           Katman 1-3 üst düzey
└── lib/
    ├── api.ts            Backend fetch + SWR
    ├── types.ts          TypeScript tipler (backend ile birebir)
    └── use-selection.ts  URL state hook (?a=metu&b=ege)
```

## Tasarım sistemi

`globals.css` içindeki `@theme` direktifi:
- Renk: ink-900/700/500/300, paper, paper-2/3, white-paper, uni-a/b/c
- Font: Fraunces (serif), Inter Tight (sans), IBM Plex Mono
- Shadow: paper / raised
