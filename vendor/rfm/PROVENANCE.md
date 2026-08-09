# Vendored from robot-foundation-model

These files are copied, unmodified, from a private repository:

    github.com/abdu7rahman/robot-foundation-model
    commit  6f615b68a2fbab72c082cf68f2b756e6e2825fe3
    date    2026-08-09

    src/rfm/data/action_space.py       ->  vendor/rfm/data/action_space.py
    src/rfm/schemas.py                 ->  vendor/rfm/schemas.py
    src/rfm/eval/ablations.py          ->  vendor/rfm/eval/ablations.py
    src/rfm/eval/metrics.py            ->  vendor/rfm/eval/metrics.py
    src/rfm/orchestration/tools.py     ->  vendor/rfm/orchestration/tools.py
    src/rfm/orchestration/harness.py   ->  vendor/rfm/orchestration/harness.py

Every other demo on this site downloads its source from GitHub at page load,
so the code running is whatever is on `main` right now and the console prints
the byte count to prove it. That is not possible here: the repository is
private and `raw.githubusercontent.com` returns 404. Copying is the honest
alternative, and the page says it is a copy rather than implying a live fetch.

Taken from `origin/main` rather than a local checkout, so the SHA above is a
commit that exists on GitHub and these bytes can be checked against it. An
earlier version of this file cited a local commit that was ahead of the
remote; that is the failure mode this note exists to prevent.


    sha256  051c53a01d782711a47b61b2789c31b417e69d2e14f4eadefb3a9286079ef9cd  data/action_space.py
    sha256  85afca5df36be02bebcad851779e4166d823817552cd2796758f787f295cdc29  schemas.py
    sha256  6d232c257429395339964caa5bda3f4dd677842d96362be882521f2186b91df7  eval/ablations.py
    sha256  d391cac4c51caff6655548884336cd314d9fc5a84da13b9aa79460f2f8652ed4  eval/metrics.py
    sha256  c096c9aa353b1631b9041570e6aef88307153790a02a0899725046aea1526023  orchestration/tools.py
    sha256  694a4b420ff3553e8c47902faf33b15c977edebeb4913a32e783bc12d5249b0e  orchestration/harness.py

## Refreshing

    git -C <rfm> show HEAD:src/rfm/data/action_space.py > vendor/rfm/data/action_space.py
    git -C <rfm> show HEAD:src/rfm/schemas.py > vendor/rfm/schemas.py
    git -C <rfm> show HEAD:src/rfm/eval/ablations.py > vendor/rfm/eval/ablations.py
    git -C <rfm> show HEAD:src/rfm/eval/metrics.py > vendor/rfm/eval/metrics.py
    git -C <rfm> show HEAD:src/rfm/orchestration/tools.py > vendor/rfm/orchestration/tools.py
    git -C <rfm> show HEAD:src/rfm/orchestration/harness.py > vendor/rfm/orchestration/harness.py

then update the commit, date and hashes above. The demo imports both by their
real module paths, so nothing else needs touching.

## Why these six

Two demos use them. `action_space.py` is numpy at runtime -- torch appears
only under `TYPE_CHECKING` -- so it runs in Pyodide unmodified. `ablations.py`
carries FAILURE_MODES and `metrics.py` carries check_alarms; both are pure
Python, and they drag in `tools.py` and `harness.py` only because
`ablations.py` imports TOOL_LADDER. The rest of the model (the action expert,
the competence head, the FAST tokenizer) needs torch and cannot run here. What that repository can and cannot claim moves quickly, so do not take this
file's word for it -- `results/README.md` there indexes every claim against
its evidence. As of this commit it has a robosuite simulator, 3,008 collected
episodes, a fitted codebook and trained checkpoints, and the policy has never
completed the task (0 of 16). Nothing rendered by these demos is a robot doing
anything; they show the action-space layout and the failure-mode watchlist,
both of which are structure rather than performance.
