# portfolio

[![site](https://img.shields.io/badge/site-abdu7rahman.github.io-0a0a0a?style=flat-square)](https://abdu7rahman.github.io)
[![code size](https://img.shields.io/github/languages/code-size/abdu7rahman/abdu7rahman.github.io?style=flat-square)](https://github.com/abdu7rahman/abdu7rahman.github.io)
[![last commit](https://img.shields.io/github/last-commit/abdu7rahman/abdu7rahman.github.io?style=flat-square)](https://github.com/abdu7rahman/abdu7rahman.github.io/commits/main)

Two presentations of one body of work, served by GitHub Pages from this
repository's root.

- **`index.html`** is the building: a React and three.js app, source in
  `app/`, with test cells you walk through and a humanoid that plans a route
  and walks it.
- **`written.html`** and **`demo.html`** are the same work as a document,
  with live 2D demos. `written.html` is the canonical prose, and
  `tools/bake_content.py` generates the building's reading panels from it, so
  the document is edited and the building follows.

`world/kinematics.js` is the UR12e forward kinematics both sites solve
against, so an arm posed in the building and one posed in the document are
the same arithmetic.

## Build

```bash
npm --prefix app run build     # Vite writes to the repository root
python3 tools/stamp.py         # rewrite the asset hashes it just changed
```

Pages has no build step, so `build/` and the rewritten HTML are committed in
the same commit as the source they came from. Use `npm run build` rather than
`npx vite build`: the `prebuild` script clears `../build`, and without it
stale hashed chunks pile up at the root.

## Gates

All of these pass before a push. There is no CI badge above because they are
not run on a hosted runner: the three `node tools/test_*.js` suites drive a
real Chromium, and the two that exercise the 3D lab need a GL stack.

```bash
node tools/test_lab.js          node tools/test_replan.js
node tools/test_visits.js       node tools/test_analytics.js
node tools/test_feedback.js     python3 tools/check_contrast.py
python3 tools/check_shaders.py  python3 tools/stamp.py --check
```
