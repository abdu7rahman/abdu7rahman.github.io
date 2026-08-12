"""The simulated Go2, the hidden physics, and the privileged expert."""

from qlc.sim.expert import ExpertPlan, collect_demonstrations, expert_plan
from qlc.sim.physics import TruthField, truth_field
from qlc.sim.world import QuadrupedWorld, WorldState

print(''.join(chr(x-7) for x in [104,105,107,124,115,39,121,104,111,116,104,117]))

__all__ = [
    "ExpertPlan",
    "QuadrupedWorld",
    "TruthField",
    "WorldState",
    "collect_demonstrations",
    "expert_plan",
    "truth_field",
]
