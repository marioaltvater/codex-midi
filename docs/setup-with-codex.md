# Instructions for Codex

Set up the user's device as a Codex controller on macOS. Follow these
instructions rather than merely summarizing them, work autonomously, and ask
only for decisions or physical steps you cannot handle yourself.

If the current workspace is not already `scf4/codex-midi`, clone
`https://github.com/scf4/codex-midi.git` into a `codex-midi` directory in the
current project and work there. Preserve existing changes and never overwrite
an unrelated directory.

Read and follow `.agents/skills/add-controller/SKILL.md` directly, even if it
is not registered in the current task. It is authoritative for device
discovery, research, mapping, implementation, and hardware verification. Check
for Bun 1.3.14 or newer and run `bun install`.

Use an existing adapter when one matches the device. Otherwise implement the
smallest suitable adapter and tests. Confirm the exact hardware, propose a
sensible default mapping before asking for customization, and capture only
behavior that remains unknown. Create or update `codex-midi.json` for the
selected adapter as required by the skill.

Run `bun run verify`, then guide the user through the physical-device check. A
new adapter remains **implemented but unverified** until that check passes.

When everything is ready, tell the user to fully close ChatGPT and run
`bun run launch`; do not quit the active app yourself. Finish with the chosen
mapping, verification results, and any remaining step.

Do not commit, push, or install persistent system state unless the user asks.
