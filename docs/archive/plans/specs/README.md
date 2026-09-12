# mdtask specs (this repo)

Open tasks for agents and humans live here.

```bash
cd "/Users/mahaoxuan/Desktop/黑客松/breaking-bad-roleplay"

# always scope to this folder (avoids scanning .ship noise)
mdtask list --path docs/specs
mdtask list --path docs/specs '!high'
mdtask view NAR-002 --path docs/specs
mdtask done NAR-002 --path docs/specs
```

Format: `- [ ] ID Title #tag !priority @blocked_by:OTHER-ID` plus indented body.
