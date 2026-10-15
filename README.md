# portfolio

[![site](https://img.shields.io/badge/site-abdu7rahman.github.io-0a0a0a?style=flat-square)](https://abdu7rahman.github.io)
[![code size](https://img.shields.io/github/languages/code-size/abdu7rahman/abdu7rahman.github.io?style=flat-square)](https://github.com/abdu7rahman/abdu7rahman.github.io)
[![last commit](https://img.shields.io/github/last-commit/abdu7rahman/abdu7rahman.github.io?style=flat-square)](https://github.com/abdu7rahman/abdu7rahman.github.io/commits/main)

Served by GitHub Pages from this repository's root, with no build step.

- **`index.html`** is the page: a name, a few lines and the work, in one column.
- **`demo.html`** runs some of the repositories in the browser through Pyodide. Five demos
  fetch their Python from GitHub as the page loads; three run copies of private repositories,
  each recorded in `vendor/*/PROVENANCE.md` with its commit and a SHA-256 per file.
- **`404.html`**, and **`admin.html`**, which forwards to the traffic dashboard. The dashboard is
  the Cloudflare worker in `worker/`.
- **`written.html`** forwards to the root, where the written page now lives, and **`sw.js`**
  retires the service worker an earlier version of the site installed.

The baked files under `assets/` come from `tools/`: `bake_arm.py` (the UR12e and Hand-E mesh
the arm demos draw), `bake_qlc_costs.py` (the Go2 course cost fields), `train_clone.py` (the
cloned DWA controller) and `gen_og.js` (the social card).

## Stamps

Pages sends `cache-control: max-age=600` on everything, so local links carry a content hash.
Run `python3 tools/stamp.py` after changing any stamped file; `--check` fails on a stale one.

## Gates

All of these pass before a push. The three `node` suites drive a real Chromium, which is why
there is no CI badge above: they are not run on a hosted runner.

```bash
node tools/test_analytics.js    node tools/test_visits.js
node tools/test_feedback.js     python3 tools/check_contrast.py
python3 tools/stamp.py --check
```

The worker has two more: `tools/test_worker.mjs`, which needs `wrangler dev` running, and
`tools/test_sweep.mjs`, which runs against a local SQLite database. See `worker/README.md`.
