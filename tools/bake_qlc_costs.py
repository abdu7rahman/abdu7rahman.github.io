#!/usr/bin/env python3
"""Compute the two torch cost fields for the demo's five courses, once, offline.

Why this exists
---------------
The `Cross the ice` demo runs `quadruped-learned-cost` in the browser, and the point of
that repository is a four-way comparison: default Nav2 inflation, a hand-tuned legged
costmap, a supervised learned cost and maximum-entropy IRL, sharing one planner, one
controller and one course suite so that only the cost function varies. Two of those four
are `qlc.cost.net`, which is torch, and there is no wasm build of torch. Shipping the
comparison with half its rows missing makes the demo about something other than what the
repository is about.

What is exact, and what is not
------------------------------
A cost model's only input is the feature stack, and a course's feature stack is a pure
function of its `TerrainConfig` -- the semantic confusion is drawn from an RNG seeded off
`TerrainConfig.seed`, so course `i` at seed 1234 has one feature stack and one learned
cost field, forever. Baking it changes nothing about the result; it moves *when* it is
computed.

So in the browser the cost field for these two stacks is read from a file instead of a
network, and everything downstream -- A*, the smoothing, the resampling, the DWA, the
world, `run_episode`'s whole loop -- runs live on it exactly as it does for the analytic
two. The page says which half is which.

The physics switch does not enter into it. `FALL_RATE` and the ice drag are hidden
physics; the feature stack is the *observation*, and a cost model that could see either
would be cheating. `--verify` asserts that, along with re-running every episode against a
live torch model and comparing the outcome.

Usage
-----
    python3 tools/bake_qlc_costs.py --qlc <path to quadruped-learned-cost>
    python3 tools/bake_qlc_costs.py --qlc <path> --verify

Writes `assets/qlc/<course>.<stack>.f32` -- raw little-endian float32, row-major,
240x240 -- plus `assets/qlc/index.json` recording the source commit, the checkpoint
digests and a digest per field. Nothing here runs in CI; it runs when the checkpoints
change, and the index is what proves which checkpoint a shipped field came from.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "qlc"
N_COURSES = 5
SEED = 1234
STACKS = ("learned", "irl")


def _sig():
    """Author signature. stderr, tty-only, so redirected output stays clean."""
    import os, sys
    if os.environ.get("NO_BANNER") == "1" or not sys.stderr.isatty():
        return
    print("  " + "".join(chr(c - 7) for c in
          (104,105,107,124,115,39,121,104,111,116,104,117)), file=sys.stderr)


def load_qlc(qlc_root):
    """Put the real package on the path, not the vendored subset.

    The vendored copy under `vendor/qlc/` deliberately omits `qlc.cost.net`, because that
    module is the one the browser cannot run. Baking has to import it, so it needs the
    repository itself.
    """
    src = pathlib.Path(qlc_root).expanduser().resolve() / "src"
    if not (src / "qlc" / "cost" / "net.py").is_file():
        sys.exit(f"no qlc.cost.net under {src}; pass --qlc <path to quadruped-learned-cost>")
    sys.path.insert(0, str(src))
    return pathlib.Path(qlc_root).expanduser().resolve()


def main():
    _sig()
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--qlc", required=True, help="path to a quadruped-learned-cost checkout")
    ap.add_argument("--verify", action="store_true",
                    help="re-run every episode against a live torch model and compare")
    args = ap.parse_args()

    repo = load_qlc(args.qlc)

    import numpy as np
    from qlc.cost.registry import build_cost_model, build_stacks
    from qlc.eval.benchmark import prepare_course, run_episode, _episode_seed
    from qlc.schemas import BenchConfig, CostModelKind, MATERIAL_TRUTH, Material
    from qlc.terrain.heightmap import course_suite

    checkpoints = {"learned": repo / "checkpoints" / "learned_cost.pt",
                   "irl": repo / "checkpoints" / "irl_cost.pt"}
    for name, path in checkpoints.items():
        if not path.is_file():
            sys.exit(f"missing checkpoint for {name}: {path}")

    commit = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                            capture_output=True, text=True).stdout.strip()
    OUT.mkdir(parents=True, exist_ok=True)

    suite = course_suite(N_COURSES, seed=SEED)
    index = {
        "source": "github.com/abdu7rahman/quadruped-learned-cost",
        "commit": commit,
        "seed": SEED,
        "resolution": suite[0].resolution,
        "note": ("Cost fields only. The planner, the controller, the simulator and the "
                 "benchmark's control loop all run live in the browser on these; see "
                 "vendor/qlc/PROVENANCE.md."),
        "checkpoints": {k: hashlib.sha256(v.read_bytes()).hexdigest()
                        for k, v in checkpoints.items()},
        "fields": {},
    }

    for kind_name in STACKS:
        kind = CostModelKind(kind_name)
        bench = BenchConfig(stacks=[kind],
                            learned_checkpoint=checkpoints["learned"],
                            irl_checkpoint=checkpoints["irl"])
        spec = build_stacks(bench)[0]
        model = build_cost_model(spec, bench)

        for i, config in enumerate(suite):
            course = prepare_course(config, bench)
            grid = np.ascontiguousarray(model.cost_grid(course.features), dtype=np.float32)
            name = f"{config.name}.{kind_name}.f32"
            (OUT / name).write_bytes(grid.tobytes())
            index["fields"][name] = {
                "course": config.name,
                "stack": kind_name,
                "shape": list(grid.shape),
                "sha256": hashlib.sha256(grid.tobytes()).hexdigest(),
                "min": round(float(grid.min()), 4),
                "max": round(float(grid.max()), 4),
            }
            print(f"  {name:<34} {grid.shape[0]}x{grid.shape[1]}  "
                  f"{grid.min():7.2f}..{grid.max():7.2f}")

            if args.verify:
                # 1. The field does not depend on the hidden physics the demo's switch
                #    moves. If it did, one baked field could not serve both settings.
                before = MATERIAL_TRUTH[Material.ICE]
                MATERIAL_TRUTH[Material.ICE] = before.model_copy(update={"drag": 0.95})
                shifted = prepare_course(config, bench)
                MATERIAL_TRUTH[Material.ICE] = before
                same = np.array_equal(
                    np.asarray(course.features.data), np.asarray(shifted.features.data))
                # 2. The episode a baked field produces is the episode the live model
                #    produces. Same seed, same spec, same course.
                class Baked:
                    kind = spec.kind
                    def cost_grid(self, features):
                        return grid
                seed = _episode_seed(bench.seed, i, spec.kind)
                live = run_episode(course, spec, model, bench, seed=seed)
                baked = run_episode(course, spec, Baked(), bench, seed=seed)
                ok = (live.outcome is baked.outcome
                      and live.steps == baked.steps
                      and abs(live.path_length - baked.path_length) < 1e-9)
                print(f"      features invariant to hidden physics: {same}"
                      f"   episode identical: {ok}"
                      f"   ({live.outcome.value}, {live.steps} steps)")
                if not (same and ok):
                    sys.exit("verification failed")

    (OUT / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    print(f"\nwrote {len(index['fields'])} fields and index.json under {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
