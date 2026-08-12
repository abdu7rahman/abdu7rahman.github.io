"""Quadruped navigation cost functions, compared on one benchmark.

Four stacks -- default Nav2 inflation, a hand-tuned reactive costmap, a supervised
learned cost, and maximum-entropy inverse RL -- share one global planner, one local
controller, one robot, and one course suite. Only the cost function varies.
"""

from qlc.schemas import BenchConfig, CostModelKind, EpisodeOutcome, Go2Params

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

__all__ = ["BenchConfig", "CostModelKind", "EpisodeOutcome", "Go2Params", "__version__"]
__version__ = "0.1.0"
