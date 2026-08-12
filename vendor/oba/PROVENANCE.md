# Vendored from orchestrated-bimanual-assembly

These files are copied, unmodified, from a private repository:

    github.com/abdu7rahman/orchestrated-bimanual-assembly
    ref     refs/heads/feat/pi05-assembly-port
    commit  f3bc3ee2f9b6fb07a442e794cabdc2a16c533086
    date    2026-08-12

    src/oba/__init__.py         ->  vendor/oba/__init__.py
    src/oba/schemas.py          ->  vendor/oba/schemas.py
    src/oba/sim/__init__.py     ->  vendor/oba/sim/__init__.py
    src/oba/sim/state.py        ->  vendor/oba/sim/state.py
    src/oba/sim/tasks.py        ->  vendor/oba/sim/tasks.py
    src/oba/sim/expert.py       ->  vendor/oba/sim/expert.py
    src/oba/sim/plant.py        ->  vendor/oba/sim/plant.py
    src/oba/sim/success.py      ->  vendor/oba/sim/success.py
    src/oba/sim/rollout.py      ->  vendor/oba/sim/rollout.py

Not `main`: the port lives on `feat/pi05-assembly-port`, and `main` is several
commits behind it. The ref is named above rather than left implied, because a
SHA that only exists on a side branch is exactly the thing a provenance note is
for. Both `__init__.py` files are empty in the repository too — that is the
repository's content, not a placeholder written here.

`oba.schemas` imports `ACTION_DIM`, `ACTION_LAYOUT`, `Embodiment` and three
head configs from `rfm.schemas`, which is vendored alongside it in
`vendor/rfm/`. That import is the port's whole claim — the instruments are
carried over by import rather than by copy — so satisfying it with the real
module rather than a stub is the point.

The nav demos on this site download their source from GitHub at page load and
print the byte count to prove it. That is not possible here: the repository is
private and `raw.githubusercontent.com` returns 404. Copying is the honest
alternative, and the page says it is a copy rather than implying a live fetch.

    sha256  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  __init__.py
    sha256  e741c5655783bbbb33db8a4d69698c1413ec5ab6630ee7eb98a89b059ad63636  schemas.py
    sha256  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  sim/__init__.py
    sha256  b4a5d96f51e12c3f2df937df35f7d1497cec551eb5baf88e52bedc6f1071e8b2  sim/state.py
    sha256  5cddd0145c80ddea58fe1b3878499327a575b0d189b30deacf39179d89546321  sim/tasks.py
    sha256  634ed3473d1afdce3cd1c3422d957a5d49687eb182b74ba10a8e1fdee2ceabc0  sim/expert.py
    sha256  fa3548b8ef7427d37b39abd3a38b99266c9889f53046d2650bdd2ac203d6a9a8  sim/plant.py
    sha256  372c4ae8d66579555a460b0ea99f911958cebf87a8e1d2aaaa38b25808f3f046  sim/success.py
    sha256  b67ecab5235b7b50bc979ab11dcab835a94d748f63808151852e00043ed8a2d1  sim/rollout.py

## Refreshing

    for f in __init__ schemas sim/__init__ sim/state sim/tasks sim/expert \
             sim/plant sim/success sim/rollout; do
      git -C <oba> show origin/feat/pi05-assembly-port:src/oba/$f.py > vendor/oba/$f.py
    done

then update the commit, date and hashes above.

## What this is, and what it must never be read as

`oba.sim.plant` is a kinematics-free analytic plant. Its own module docstring
says it is not a simulator and must never produce a reported number, and the
repository enforces that rather than trusting it: `IS_ANALYTIC` is True,
`oba.sim.rollout.rollout` refuses to record a phase gate when the plant is the
environment, and `PhaseGate.measured_by` has no member that could describe this
module, so the mistake is rejected by the type before a guard has to catch it.

So what runs on this page is the **controller logic**: an eight-phase insertion
state machine and a five-phase bimanual wire-routing machine, driven against
integrated deltas, scored by the same success detectors the simulator arm uses.
That is what the plant exists for — the positive control for the scripted
expert, which is itself the positive control for everything downstream. It is
not a physics result and the page does not present one. Every success rate this
project reports is read from Isaac Sim.

The two heavy paths are absent for the ordinary reason: `oba.sim.isaac_env`
needs Isaac Sim and `oba.policy` needs torch and openpi. Neither is vendored.
