# Publishing the online reference map (Cloudflare Pages)

`99_Reference_Map/online/` is the **online edition** of the reference map: one self-contained
`index.html` with no PDFs. Every document link goes to the official publisher (EUR-Lex, ERA,
Lovdata, ETSI, the standards bodies), so it can be hosted publicly without redistributing
anyone's documents.

The **local edition** is `99_Reference_Map/reference_map.html`. Open it from your own copy of the
library: 📄 opens the downloaded PDF and ↗ opens the source.

## Recommended: GitHub → Cloudflare Pages (automatic deploys)
The built page is committed to the repository, so Cloudflare doesn't need to build anything.

1. Push this repository to GitHub (the PDFs are excluded by `.gitignore`).
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** →
   select the repository.
3. Build settings:
   | Setting | Value |
   |---|---|
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | *(leave empty)* |
   | Build output directory | `99_Reference_Map/online` |
4. **Save and Deploy**. The site goes live at `https://<project>.pages.dev`. You can add your own
   domain under *Custom domains*.
5. To stop commits that only touch scripts or the catalogue from triggering a deploy, go to
   Settings → Builds → **Build watch paths** and include only `99_Reference_Map/online/*`.

Every push to `main` that changes `99_Reference_Map/online/` publishes a new version. Pushes to
other branches get preview URLs.

### Updating
```bash
bash download_all.sh        # fetch any new or missing documents (local only, not committed)
bash tools/finalize.sh      # rebuild catalogue, both map editions and README
git add -A && git commit -m "Update library" && git push
```

## Alternatives
- **Drag and drop**: Workers & Pages → Create → Pages → *Upload assets* → drop the `online` folder.
- **Wrangler CLI**: `npx wrangler pages deploy 99_Reference_Map/online --project-name railcert`

## Files in `online/`
- `index.html`: the map (all data embedded).
- `_headers`: security headers and a 5-minute cache, so updates show up quickly.
- `DEPLOY.md`: this file. Cloudflare serves it too, which is harmless.

## Attribution
The page footer credits EUR-Lex/European Commission (reuse under Decision 2011/833/EU), ERA and
Lovdata, and states that standards are listed by reference only. Keep the footer if you modify the page.
