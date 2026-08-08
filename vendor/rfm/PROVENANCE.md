# Vendored from robot-foundation-model

These files are copied, unmodified, from a private repository:

    github.com/abdu7rahman/robot-foundation-model
    commit  0441853a94934a9cddc40bb565c577eb2b636a0f
    date    2026-08-08

    src/rfm/data/action_space.py   ->  vendor/rfm/data/action_space.py
    src/rfm/schemas.py             ->  vendor/rfm/schemas.py

Every other demo on this site downloads its source from GitHub at page load,
so the code running is whatever is on `main` right now and the console prints
the byte count to prove it. That is not possible here: the repository is
private and `raw.githubusercontent.com` returns 404. Copying is the honest
alternative, and the page says it is a copy rather than implying a live fetch.

Taken from the commit rather than the working tree, so the SHA above describes
exactly these bytes. `schemas.py` had uncommitted local changes at the time --
nine lines in an unrelated docstring about substep success fractions, nothing
in the action space.

    sha256  051c53a01d782711a47b61b2789c31b417e69d2e14f4eadefb3a9286079ef9cd  action_space.py
    sha256  05c2f4f366348af8db99288761548c2c6c2b639b40d7d0740c8fee127c962397  schemas.py

## Refreshing

    git -C <rfm> show HEAD:src/rfm/data/action_space.py > vendor/rfm/data/action_space.py
    git -C <rfm> show HEAD:src/rfm/schemas.py           > vendor/rfm/schemas.py

then update the commit, date and hashes above. The demo imports both by their
real module paths, so nothing else needs touching.

## Why only these two

`action_space.py` is numpy at runtime -- torch appears only under
`TYPE_CHECKING` -- so it runs in Pyodide unmodified. The rest of the model
(the action expert, the competence head, the FAST tokenizer) needs torch and
cannot. Nothing in that repository is a trained policy: there are no rollouts,
no simulator, and the residual-VQ codebook is randomly initialised, so nothing
here should be read as a robot doing anything.
