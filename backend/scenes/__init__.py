"""World simulation + stage package (DEC-0005 P2+).

Hard correctness (validator, ontology, reducer) lives here so narrative
agents propose and this package decides what can actually commit.
"""

from scenes.action_ontology import ACTION_VERBS, map_action_verb
from scenes.critic import prefer_turn, score_turn
from scenes.validator import validate_world_turn
from scenes.world_mode import WorldMode, parse_world_mode

__all__ = [
    "ACTION_VERBS",
    "WorldMode",
    "map_action_verb",
    "parse_world_mode",
    "prefer_turn",
    "score_turn",
    "validate_world_turn",
]
