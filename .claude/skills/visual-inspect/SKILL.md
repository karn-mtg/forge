---
name: visual-inspect
description: Launch the real Karn Forge Electron app via Playwright and screenshot it, to visually confirm a UI/renderer change or catch console errors, without the user alt-tabbing to the app. Use whenever you've made a renderer change and want to see it, or the user asks "does this look right" / "check the UI" / "screenshot the app".
---

# Visual inspect

A small ad-hoc tool, not a test suite — it launches the app, takes one screenshot, and reports console errors. No assertions, no checked-in baselines.

## When to use

After editing anything under `src/renderer/**`, before telling the user a UI change is done — launch the app and actually look at the screenshot instead of assuming the change renders correctly.

## How to invoke

Most common case — `npm run dev` is already running in another terminal:

```
node scripts/visual-inspect.mjs --dev --wait 1000
```

If no dev server is running (builds the renderer first, slower but self-contained):

```
node scripts/visual-inspect.mjs --prod --wait 1000
```

`--wait <ms>` delays the screenshot after load (useful for animations or async data fetches — 1000ms is a reasonable default). `--out <path>` overrides the screenshot destination (default: `scripts/.inspect-out/inspect-<timestamp>.png`, gitignored).

## Reading the result

The script prints the screenshot path and any captured console/page errors to stdout. Use the Read tool on the printed path to actually view the image — don't just trust that the command exited 0.

This complements, not replaces, the built-in `run` skill.
