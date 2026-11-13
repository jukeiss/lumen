# Lumen

A fast, private Markdown notebook that runs **100% on your own machine**.
Open source (MIT). No account, no cloud, no telemetry, no CDN, **zero npm dependencies**.

Your notes are plain `.md` files in a folder you choose, so you can open the same folder in
any other editor (including an Obsidian vault) and never be locked in.

## Features
`[[wikilinks]]` with autocomplete · backlinks & unlinked mentions · outline · graph view · #tags ·
full-text search · daily notes · callouts, tables, task lists · command palette (⌘/Ctrl+P) ·
quick switcher (⌘/Ctrl+O) · light/dark · live external-edit sync · import/export

**Attachments:** drag & drop, paste, or *Add files* — images, PDFs, audio, video, `.canva` files and anything else are stored in `attachments/` inside your vault and embedded with `![[file.png]]` (`![[img.png|300]]` sets a width). `.canva` files show as a card that links to the design on canva.com (Lumen can't edit Canva designs; it keeps the file and the link with your notes). Max 200 MB per file.

## Run it
Requires [Node.js](https://nodejs.org) 18+.

    git clone <this repo> lumen && cd lumen
    node server.js                      # vault in ./vault
    node server.js ~/Documents/Notes    # or any folder you like

Then open http://127.0.0.1:5188. (`npm start` also works; `PORT=8080 node server.js` changes the port.)

## Privacy & security
- The server binds to `127.0.0.1` only and makes **no outbound network requests**; the UI loads no external fonts, scripts or analytics.
- The API refuses path traversal, cross-origin requests and DNS-rebinding hosts. Uploaded files are served with a strict allow-list of types; anything else (e.g. `.html`) is forced to download and can never run script in the app.
- There is no login. Don't set `HOST=0.0.0.0` on an untrusted network without putting auth in front of it.
- Back up your vault folder like any other folder (it's git-friendly).

## Layout
    server.js        HTTP server + REST API (notes as files, atomic writes)
    public/index.html  the whole app (vanilla JS, one file)

## Contributing
PRs welcome. Keep it dependency-free and local-only.

## License
MIT
