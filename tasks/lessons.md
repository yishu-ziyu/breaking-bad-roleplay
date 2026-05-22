# Lessons

## 2026-05-22 - Treat repeated media as a system-class defect

When a user reports that one character repeats the same GIF, do not fix only that character first and stop. The correct diagnostic step is to ask whether the same failure class exists across all comparable roles.

For this project, a single repeated GIF implies a role-media coverage problem:

- Audit every playable role before expanding one role.
- Record per-role GIF counts, approved/hold/rejected states, duplicate URLs, and semantic coverage.
- Fix the most visible local symptom only after the global matrix is known.
- Do not call a media pool "done" unless it passes the same minimum quality bar for every role that can appear in chat.

Practical rule: local symptom -> class of objects -> coverage matrix -> shared quality gate -> targeted implementation.
