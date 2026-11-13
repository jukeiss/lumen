# Lumen desktop app

A macOS wrapper that runs Lumen in its own window. Notes are plain `.md` files in `~/Documents/Lumen`.

**Build it yourself** (from this folder):

```bash
cp -R ../server.js ../public ./desktop/app/ 2>/dev/null; mkdir -p desktop/app && cp server.js desktop/app/ && cp -R public desktop/app/
cd desktop && npm install && npx electron-builder --mac dmg
```

The `.dmg` lands in `desktop/dist/`. It's unsigned, so macOS asks you to right-click and choose **Open** the first time.
