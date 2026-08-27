"""Play the opening night with no LLM, network, or database.

  cd backend && uv run python -m game.cli
  cd backend && uv run python -m game.cli --seed 59 --actions lie_to_skyler,clean_rv,pay_jesse
"""

from __future__ import annotations

import argparse
import sys

from game.reducer import apply_action, start_night


def _print_state(state, event, actions) -> None:
    print()
    print(f"— turn {state.turn}/6  seed={state.seed}")
    print(f"  police {state.police_risk}  family {state.family_suspicion}  jesse {state.jesse_trust}  cash {state.cash}  saul {state.saul_favor}")
    print(f"  problems: {', '.join(state.open_problems) or 'none'}")
    debts = ", ".join(f"{d['id']}({d['countdown']})" for d in state.debts) or "none"
    print(f"  debts: {debts}")
    print(f"  {event['title']}: {event['text']}")
    if actions:
        print("  actions:")
        for idx, action in enumerate(actions, start=1):
            costs = action.get("costs") or {}
            cost_s = f"  cost={costs}" if costs else ""
            print(f"    {idx}. {action['id']} — {action['label']}{cost_s}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="P0 Game Kernel — one night, six turns, Walter.")
    parser.add_argument("--seed", type=int, default=59)
    parser.add_argument("--actions", default="", help="Comma-separated action ids (non-interactive).")
    args = parser.parse_args(argv)

    night = start_night(seed=args.seed)
    _print_state(night.state, night.event, night.available_actions)
    scripted = [part.strip() for part in args.actions.split(",") if part.strip()]
    state = night.state

    if scripted:
        for action_id in scripted:
            resolved = apply_action(state, action_id)
            print(f"\n> {action_id}")
            for effect in resolved.resolved_effects:
                if "delta" in effect:
                    print(f"    {effect.get('field')} {effect['delta']:+} ({effect.get('source')})")
            for npc in resolved.npc_actions:
                print(f"    NPC {npc['npc_id']}: {npc['action_id']} — {npc['summary']}")
            for debt in resolved.triggered_debts:
                print(f"    DEBT returns: {debt['id']}")
            _print_state(resolved.next_state, resolved.next_event, resolved.available_actions)
            if resolved.ending:
                print(f"\nENDING [{resolved.ending['kind']}] {resolved.ending['title']}")
                print(f"  {resolved.ending['text']}")
                return 0
            state = resolved.next_state
        return 0

    if not sys.stdin.isatty():
        print("No --actions given and stdin is not a TTY.", file=sys.stderr)
        return 2

    while not state.ended:
        legal = {str(i): a["id"] for i, a in enumerate(night.available_actions if state.turn == 0 and state is night.state else [], start=1)}
        from game.actions import legal_actions

        options = legal_actions(state)
        legal = {str(i): a["id"] for i, a in enumerate(options, start=1)}
        choice = input("choose> ").strip()
        action_id = legal.get(choice, choice)
        try:
            resolved = apply_action(state, action_id)
        except ValueError as exc:
            print(f"  ! {exc}")
            continue
        print(f"\n> {resolved.action['id']}")
        for npc in resolved.npc_actions:
            print(f"    NPC {npc['npc_id']}: {npc['summary']}")
        for debt in resolved.triggered_debts:
            print(f"    DEBT returns: {debt['id']}")
        _print_state(resolved.next_state, resolved.next_event, resolved.available_actions)
        if resolved.ending:
            print(f"\nENDING [{resolved.ending['kind']}] {resolved.ending['title']}")
            print(f"  {resolved.ending['text']}")
            return 0
        state = resolved.next_state
        night = type(night)(state, resolved.next_event, resolved.available_actions, resolved.ending)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
