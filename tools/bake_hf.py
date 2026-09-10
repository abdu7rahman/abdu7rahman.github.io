#!/usr/bin/env python3
"""Bake the two artefacts this site shows from Hugging Face.

Both come from private repositories under the site owner's own account, so
this is not reproducible by a stranger and says so rather than pretending
otherwise. What it writes is checked in; what it reads is not redistributed.

    HF_TOKEN=... python3 tools/bake_hf.py

Two outputs.

assets/policy.json is the evaluation record of abdu7rahman/rfm-pi05-lift-lora,
a LoRA finetune of pi-0.5 on a LIBERO lift task. Seven runs: a zero-action
control, a scripted control, the base checkpoint at two seeds, a zero-shot
run, and the tuned checkpoint at the same two seeds. Numbers only -- no
weights, no images, no prompts beyond the one the task is named by. The point
of shipping it is that a success rate without a control and a second seed is
not a result, and this one has both.

assets/episode.json is a window of one recorded episode from
abdu7rahman/bimanual-ur5-tools-handover: a real bimanual UR5e teleoperated at
20 Hz, 14 channels, six joints and a gripper an arm. A window rather than the
whole thing -- the episodes run over four minutes and the site needs one
complete grasp and release, which is about twenty-five seconds. No video
frames are taken from the dataset and none are published.
"""
import argparse
import json
import os
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
HF = "https://huggingface.co"

MODEL = "abdu7rahman/rfm-pi05-lift-lora"
DATASET = "abdu7rahman/bimanual-ur5-tools-handover"

# The seven runs, and what each one is for. Order is the order they are shown
# in: the two controls bracket the range the policies have to land inside.
RUNS = [
    ("control_zero", "results/control_zero.json", "zero action", "control"),
    ("base_s0", "results/eval_base_seed0.json", "pi-0.5 base, seed 0", "base"),
    ("base_s50", "results/eval_base_seed50.json", "pi-0.5 base, seed 50", "base"),
    ("zeroshot", "results/pi05_zeroshot.json", "pi-0.5 zero shot", "base"),
    ("tuned_s0", "results/eval_tuned_seed0.json", "LoRA tuned, seed 0", "tuned"),
    ("tuned_s50", "results/eval_tuned_seed50.json", "LoRA tuned, seed 50", "tuned"),
    ("control_scripted", "results/control_scripted.json", "scripted", "control"),
]


def get(repo, path, dataset=False):
    kind = "datasets/" if dataset else ""
    url = f"{HF}/{kind}{repo}/resolve/main/{path}"
    tok = os.environ.get("HF_TOKEN")
    if not tok:
        sys.exit("HF_TOKEN is not set, and both repositories are private.")
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}"})
    with urllib.request.urlopen(req) as r:
        return r.read()


def bake_policy():
    runs = []
    for key, path, label, group in RUNS:
        d = json.loads(get(MODEL, path))
        runs.append({
            "key": key, "label": label, "group": group,
            "episodes": d["episodes"], "successes": d["successes"],
            "rate": round(d["success_rate"], 4),
            # The stderr in the file is the binomial one and the two controls
            # report it as 2.2e-07 rather than 0, which is a solver artefact
            # and not a claim about a run that never varied. Zeroed here.
            "stderr": round(d["stderr"], 4) if d["stderr"] > 1e-4 else 0.0,
            "steps": round(d["mean_steps"], 1),
            "shaped": round(d["mean_best_shaped_reward"], 4),
            "minutes": round(d["wall_clock_min"], 2),
        })
    curve = json.loads(get(MODEL, "stage3/grpo_curve.json"))
    keep = ("reward_mean", "reward_accuracy", "reward_format", "reward_consistency", "grpo_kl")
    out = {
        "model": MODEL,
        "task": "LIBERO lift: pick up the cube and lift it off the table",
        "runs": runs,
        "curve": [{k: round(float(row[k]), 5) for k in keep if k in row} for row in curve],
    }
    p = ROOT / "assets" / "policy.json"
    p.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {p.relative_to(ROOT)}  {p.stat().st_size} bytes  "
          f"{len(runs)} runs, {len(out['curve'])} curve points")


def bake_episode(ep, start, frames, every):
    import pyarrow.parquet as pq
    raw = get(DATASET, "data/chunk-000/file-000.parquet", dataset=True)
    tmp = ROOT / ".episode.parquet"
    tmp.write_bytes(raw)
    try:
        t = pq.read_table(tmp)
    finally:
        tmp.unlink()
    epi = t["episode_index"].to_pylist()
    state = t["observation.state"].to_pylist()
    rows = [state[i] for i in range(len(epi)) if epi[i] == ep]
    cut = rows[start:start + frames:every]
    info = json.loads(get(DATASET, "meta/info.json", dataset=True))
    out = {
        "dataset": DATASET,
        "robot": info.get("robot_type"),
        "hz": info.get("fps", 20) / every,
        "episode": ep,
        "from": start,
        "channels": ["l0", "l1", "l2", "l3", "l4", "l5", "lgrip",
                     "r0", "r1", "r2", "r3", "r4", "r5", "rgrip"],
        # Four decimals is 0.1 mrad on a joint and 0.1 mm on a gripper, which
        # is finer than the arm repeats and a third of the file size of the
        # float32 it was stored as.
        "frames": [[round(float(v), 4) for v in row] for row in cut],
    }
    p = ROOT / "assets" / "episode.json"
    p.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {p.relative_to(ROOT)}  {p.stat().st_size} bytes  "
          f"{len(out['frames'])} frames at {out['hz']} Hz")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--episode", type=int, default=0)
    # Frame 2998 of episode 0 is where the grippers close and 3298 is where
    # they open, so this window holds one whole grasp with a run-up and a
    # follow-through either side of it.
    ap.add_argument("--start", type=int, default=2900)
    ap.add_argument("--frames", type=int, default=520)
    ap.add_argument("--every", type=int, default=1)
    ap.add_argument("--only", choices=("policy", "episode"))
    a = ap.parse_args()
    if a.only != "episode":
        bake_policy()
    if a.only != "policy":
        bake_episode(a.episode, a.start, a.frames, a.every)
