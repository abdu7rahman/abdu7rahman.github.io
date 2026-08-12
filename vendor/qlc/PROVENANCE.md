# Vendored from quadruped-learned-cost

These files are copied, unmodified, from a private repository:

    github.com/abdu7rahman/quadruped-learned-cost
    ref     refs/heads/main
    commit  cdc287cb30a8a82b45b60fc44d2b74e2685c48b8
    date    2026-08-12

    src/qlc/__init__.py             ->  vendor/qlc/__init__.py
    src/qlc/schemas.py              ->  vendor/qlc/schemas.py
    src/qlc/terrain/__init__.py     ->  vendor/qlc/terrain/__init__.py
    src/qlc/terrain/heightmap.py    ->  vendor/qlc/terrain/heightmap.py
    src/qlc/terrain/features.py     ->  vendor/qlc/terrain/features.py
    src/qlc/terrain/geometry.py     ->  vendor/qlc/terrain/geometry.py
    src/qlc/cost/__init__.py        ->  vendor/qlc/cost/__init__.py
    src/qlc/cost/base.py            ->  vendor/qlc/cost/base.py
    src/qlc/cost/analytic.py        ->  vendor/qlc/cost/analytic.py
    src/qlc/cost/registry.py        ->  vendor/qlc/cost/registry.py
    src/qlc/plan/__init__.py        ->  vendor/qlc/plan/__init__.py
    src/qlc/plan/astar.py           ->  vendor/qlc/plan/astar.py
    src/qlc/plan/dwa.py             ->  vendor/qlc/plan/dwa.py
    src/qlc/sim/__init__.py         ->  vendor/qlc/sim/__init__.py
    src/qlc/sim/expert.py           ->  vendor/qlc/sim/expert.py
    src/qlc/sim/physics.py          ->  vendor/qlc/sim/physics.py
    src/qlc/sim/world.py            ->  vendor/qlc/sim/world.py
    src/qlc/eval/__init__.py        ->  vendor/qlc/eval/__init__.py
    src/qlc/eval/benchmark.py       ->  vendor/qlc/eval/benchmark.py
    src/qlc/eval/oracle.py          ->  vendor/qlc/eval/oracle.py

Nothing is edited, including the `__init__.py` files, which are the
repository's own and re-export what it re-exports. The demo imports every
module by its real dotted path, so `qlc.eval.benchmark.run_episode` in the
browser is the function of that name in the repository and not a paraphrase
of it.

The nav demos on this site download their source from GitHub at page load and
print the byte count to prove it. That is not possible here: the repository is
private and `raw.githubusercontent.com` returns 404. Copying is the honest
alternative, and the page says it is a copy rather than implying a live fetch.

The commit above is on `main` at GitHub, so these bytes can be checked against
it rather than against a local checkout that might be ahead of the remote.

    sha256  cc0bf3e6201d635cfde4a2b0de0f8d584bea99fe7eb65d67f5e007a5b765274a  __init__.py
    sha256  54806e3e97b359f1ac46f12cefd0fb3f6a63b591f2920fde5f0db54f1f11392d  schemas.py
    sha256  eab5979becae623e6f0874bd620cbe4f6b36a2aadda9d5e800b8f8bc2a808fce  terrain/__init__.py
    sha256  d2fc957c54835d9fe9b174fd01978f58ac176e5a8b5d39edf36be1ba0819d043  terrain/heightmap.py
    sha256  be135a22c18fe3fa8487e8df40d0b9c40f05d33d9fe2302d78e72a235aa95e1a  terrain/features.py
    sha256  8b9b0b0720b5f5faa03dc4cb4cfa742ad8c2aee8fb09dd9ea33397475025a460  terrain/geometry.py
    sha256  5cc74b2b670d69f2c2716ce3fd880bac1c1d42206abc7aba246f835730ac861b  cost/__init__.py
    sha256  1561e76f5ae887eda777be1f1cd07598073e19557ae66edcacd82f7dd29d191d  cost/base.py
    sha256  4c07769ecd15719d4496e520ae719528b4ae8ef643876b26af81c4bb3136bac3  cost/analytic.py
    sha256  4c401819b48eb50423f8d89496de2faa99dbdc79830bb7f5131539588f426a6a  cost/registry.py
    sha256  52c6d98ed402690f478014aff031e17ff6f6fb7b1ffef139b4e5331551969026  plan/__init__.py
    sha256  520f71ecead436339ea808d8339bb68a876b308ac1d1da3eda61d0d794e58e20  plan/astar.py
    sha256  395162bc06f6fdb301320902dbcf7bdf61317919991e8d134a8f3b64c6e3732d  plan/dwa.py
    sha256  5af002d9f05fca78082969a839328fcfff9638b6d4f2dc353a7fab08b0490dab  sim/__init__.py
    sha256  90a5c4689dec9255d2b7e61e6912b5f9c9fc4aeb8ea75123573cf462cde9077c  sim/expert.py
    sha256  b847a80ab82812fa82c6eb7b7c9f8dfbe92a50a2e5c4dfcb4e6f1d2157a56703  sim/physics.py
    sha256  9f84d572cf3360e21ced3a183d5b8082a5d174c89f226fb565bff9a5119bc124  sim/world.py
    sha256  2f7631a550d4de4d34b8622243e191809f7e447c493c0e39c2891b673e0c901c  eval/__init__.py
    sha256  140ea9dcb517059d14c9e64c54cb5e600a7520ec6b22995925bcd0055ebde29b  eval/benchmark.py
    sha256  de0ca81f303e8bdd456f1b9d4be3e7cc813fb38aceb67eef752d1e3bef61c3f8  eval/oracle.py

## Refreshing

    for f in __init__ schemas terrain/__init__ terrain/heightmap terrain/features \
             terrain/geometry cost/__init__ cost/base cost/analytic cost/registry \
             plan/__init__ plan/astar plan/dwa sim/__init__ sim/expert sim/physics \
             sim/world eval/__init__ eval/benchmark eval/oracle; do
      git -C <qlc> show origin/main:src/qlc/$f.py > vendor/qlc/$f.py
    done

then update the commit, date and hashes above.

## Two things this copy cannot do, and the page says so

**`qlc.cost.net` is not vendored, and cannot be.** The supervised CNN and the
MaxEnt IRL cost are torch, and there is no wasm build of torch. The registry
imports it lazily, on the two paths that need it and nowhere else, so
`nav2_inflation`, `reactive` and the privileged oracle run here untouched.

Those two rows are not dropped, though: their cost *fields* are baked. A cost
model's only input is the feature stack, and a course's feature stack is a pure
function of its `TerrainConfig` — the semantic confusion is drawn from an RNG
seeded off `TerrainConfig.seed` — so course *i* at seed 1234 has one learned
cost field and always will. `tools/bake_qlc_costs.py` computes the ten fields
against the repository's own checkpoints and writes them to `assets/qlc/`, with
`index.json` recording the source commit and a SHA-256 per checkpoint and per
field. It also verifies, per course, two things it would be easy to assume:
that the feature stack does not move when the demo's physics switch moves
`FALL_RATE` and the ice drag (it must not — those are hidden physics and a cost
model that could see them would be cheating), and that the episode a baked
field produces is identical to the episode the live torch model produces —
same outcome, same step count, same path length.

So for `learned` and `irl` the forward pass is replaced and nothing else is.
A\*, the smoothing, the resampling, the DWA, the world and `run_episode`'s
whole loop run in the browser on that field, exactly as they do for the
analytic two.

**`rich` is stubbed at the import boundary.** `qlc.eval.benchmark` imports
`Console` and `Table` for its progress output. Both are replaced with
do-nothing objects before the module is imported, exactly as `rclpy` is stubbed
for the nav demos, and nothing below the import is touched. `run_episode`
itself never calls either.

## What the demo does with them

One course, generated by `qlc.terrain.heightmap.generate`; one feature stack;
`qlc.eval.benchmark.run_episode` per cost model, which is the repository's own
control loop — A\* replanning every `replan_period` ticks, DWA every tick, the
stuck counter. The physics switch sets `qlc.sim.world.FALL_RATE` back to 0.5
and `MATERIAL_TRUTH[Material.ICE].drag` back to 0.95: the two constants the
MuJoCo cross-check changed, and the reason the repository's first results table
was withdrawn. Nothing else about the reconstruction differs.
