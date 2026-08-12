#!/usr/bin/env python3
"""A stand-in for an openpi policy server, for developing the page without a GPU.

It speaks the real protocol -- websocket, msgpack-numpy, a metadata frame on
connect, an observation dict in, an action chunk out -- so the page can be built
and tested against it and then pointed at a real `scripts/serve_policy.py`
without changing a line.

What it does not do is think. The actions it returns are a smooth synthetic
chunk, so anything the page renders while pointed here is a shape check and not
a policy. It says so in its metadata, and the page prints that.

    pip install msgpack msgpack-numpy websockets numpy
    python3 tools/stub_policy_server.py --port 8000

Then set data-server="ws://127.0.0.1:8000" on <section id="policy">.
"""
import argparse
import asyncio
import math

import msgpack_numpy
import numpy as np
import websockets

# What openpi's DROID example sends and expects back. Keeping these here means
# the page is checked against the real contract rather than against whatever it
# happens to send.
EXPECTED = {
    "observation/exterior_image_1_left": ("uint8", (224, 224, 3)),
    "observation/wrist_image_left": ("uint8", (224, 224, 3)),
    "observation/joint_position": ("float", (7,)),
    "observation/gripper_position": ("float", (1,)),
}
HORIZON, ACTION_DIM = 10, 8          # 7 joint velocities + gripper


def check(obs):
    """Complain the way a real server would, rather than silently accepting."""
    problems = []
    for key, (kind, shape) in EXPECTED.items():
        if key not in obs:
            problems.append("missing %s" % key)
            continue
        v = obs[key]
        if not isinstance(v, np.ndarray):
            problems.append("%s is %s, not an array" % (key, type(v).__name__))
            continue
        if tuple(v.shape) != shape:
            problems.append("%s has shape %s, want %s" % (key, tuple(v.shape), shape))
        if kind == "uint8" and v.dtype != np.uint8:
            problems.append("%s is %s, want uint8" % (key, v.dtype))
        if kind == "float" and v.dtype.kind != "f":
            problems.append("%s is %s, want a float" % (key, v.dtype))
    if "prompt" not in obs:
        problems.append("missing prompt")
    elif not isinstance(obs["prompt"], (str, bytes)):
        problems.append("prompt is %s, not a string" % type(obs["prompt"]).__name__)
    return problems


def fake_chunk(obs, t):
    """A smooth chunk that depends on the observation, so the page can tell
    that what it sent reached here."""
    j = np.asarray(obs["observation/joint_position"], dtype=np.float32)
    out = np.zeros((HORIZON, ACTION_DIM), dtype=np.float32)
    for k in range(HORIZON):
        phase = t * 0.6 + k * 0.25
        out[k, :7] = 0.35 * np.sin(phase + j * 1.7) * np.linspace(1.0, 0.4, 7)
        out[k, 7] = 0.5 + 0.5 * math.sin(phase * 0.5)
    return out


async def serve(ws):
    packer = msgpack_numpy.Packer()
    await ws.send(packer.pack({
        "server": "stub_policy_server.py",
        "note": "synthetic actions, not a policy",
        "action_horizon": HORIZON,
        "action_dim": ACTION_DIM,
    }))
    print("client connected")
    t = 0
    async for raw in ws:
        obs = msgpack_numpy.unpackb(raw)
        problems = check(obs)
        if problems:
            print("  rejected: " + "; ".join(problems))
            await ws.send("bad observation: " + "; ".join(problems))
            continue
        keys = ", ".join("%s%s" % (k.split("/")[-1], tuple(v.shape))
                         for k, v in obs.items() if isinstance(v, np.ndarray))
        print('  ok: %s  prompt="%s"' % (keys, obs["prompt"]))
        await ws.send(packer.pack({"actions": fake_chunk(obs, t)}))
        t += 1
    print("client gone")


async def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    async with websockets.serve(serve, args.host, args.port, max_size=None):
        print("stub policy server on ws://%s:%d  (synthetic actions)"
              % (args.host, args.port))
        await asyncio.Future()


def _sig():
    """Author signature. stderr, tty-only, so redirected output stays clean."""
    import os, sys
    if os.environ.get("NO_BANNER") == "1" or not sys.stderr.isatty():
        return
    print("  " + "".join(chr(c - 7) for c in
          (104,105,107,124,115,39,121,104,111,116,104,117)), file=sys.stderr)


if __name__ == "__main__":
    _sig()
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
