---
name: add-controller
description: Detect, research, map, implement, or update a hardware controller for codex-midi. Use for interactive setup of MIDI controllers, gamepads, Stream Decks, accessibility switches, serial devices, or custom hardware, including Codex Micro mappings, controller actions, feedback, and physical verification.
---

# Add a controller

Own the setup flow from identifying the physical device through a verified
adapter. Do the research and implementation work yourself; ask the user only
to identify hardware, choose between meaningful mapping alternatives, or
perform physical gestures that cannot be discovered from the repository.

## Ground the work

Before editing:

1. inspect `git status` and preserve unrelated or user-authored changes;
2. read `docs/adding-a-controller.md`, `docs/provenance.md`,
   `src/config.ts`, `src/controllers/controller.ts`, and
   `src/controllers/index.ts` completely;
3. read `docs/architecture.md` before changing a shared boundary or adding a
   non-MIDI transport;
4. for MIDI, also read `src/controllers/midi-profile.ts`,
   `src/controllers/midi-surface.ts`, and the ATOM reference adapter. When
   updating ATOM, also read `docs/controllers/atom.md` as its evidence record.

Treat current source and behavioral tests as authoritative. Do not recover old
paths or assumptions from historical commits.

## Run the setup wizard

### 1. Find and confirm the device

- If MIDI is plausible, run `bun run midi:list`. Present the exact numbered
  input and output candidates and have the user confirm the physical device
  before opening a port. Do not assume similarly named ports belong together.
- For gamepads, HID, Bluetooth, serial, accessibility, or vendor-specific
  devices, start with built-in read-only macOS inventory or an official vendor
  diagnostic. Identify the likely transport and device identifiers, then
  confirm the exact device with the user.
- If nothing matches, report what was inspected and the smallest next check.
  Do not ask the user for facts available from the machine or public docs.

### 2. Research before inferring

- Search for official documentation for the exact model and revision first.
  Record public URLs, document revisions, firmware, ports, identifiers, and
  supported input or feedback protocols.
- Treat community sources as license-aware research leads. Record their license
  status, independently verify protocol facts, and never copy unlicensed,
  incompatible, or proprietary implementation code.
- Separate documented facts, authorized live observations, and inference.
  Live hardware is final truth for physical labels, directions, and timing.
- Stop once the transport and likely mapping are clear. Do not gather unrelated
  projects or create speculative compatibility layers.

### 3. Design and propose the mapping

Optimize for a coherent, safe, device-native surface, not for the number of
mapped capabilities. A smaller map that is memorable and difficult to trigger
accidentally is better than complete coverage with arbitrary layers.

Before assigning controls:

- start from the user's workflow and the hardware's physical affordances, putting
  frequent reversible behavior on easy controls and consequential behavior on
  deliberate, guarded gestures;
- treat coherent user proposals and corrections as evidence about comfort,
  frequency, and mental model; preserve them unless they create a real conflict,
  safety issue, or unsupported behavior;
- use analog or noisy inputs primarily for continuous, reversible behavior and
  pair symmetric controls with paired behavior;
- prefer genuine Micro inputs when the hardware naturally matches the Micro
  surface, preserving Codex Micro settings and user remapping;
- choose direct task slots for suitable grids or labeled surfaces, and sequential
  navigation for constrained devices;
- give each modifier one coherent purpose, and use aliases or duplicate outcomes
  only for a clear fidelity, ergonomic, or accessibility benefit;
- leave a control or capability unmapped when no natural assignment exists.

Apply the relevant interaction rules in `docs/adding-a-controller.md` whenever
the proposal uses analog inputs, modifiers, chords, repeats, overlapping
sources, or feedback. Internally compare a minimal workflow-first layout with a
broader-coverage layout, then present the strongest recommendation unless a
real tradeoff needs the user's choice.

Show the smallest useful physical grid, diagram, or table. Include the control
or gesture, observed input, proposed behavior, Micro or controller-action lane,
activation semantics, guard or overlap behavior, feedback meaning, and evidence
confidence. List intentional duplicates, deliberate omissions, and anything
that still needs capture.

Offer one recommended layout, then let the user accept it, adjust selected
controls, or request a custom layout. After any revision, present the complete
final mapping and ask for explicit approval of that exact map. Never infer
approval from a correction or newly suggested binding unless the user delegated
the mapping choice.

### 4. Capture only unresolved behavior

- For MIDI, run `bun run midi:monitor -- --input "Exact Input Port"` in an
  interactive terminal. Guide one labeled gesture at a time and record press,
  release, repeats, holds, modifier combinations, both encoder directions,
  slow and fast turns, and disconnect behavior as relevant.
- Do not treat the monitor's elapsed-time prefix as MIDI data. Do not open an
  output port, sweep lights, brute-force SysEx, or guess a vendor handshake.
- For another transport, prefer an official diagnostic. If none exists, create
  one narrow passive probe under ignored `.codex-midi/` paths for the selected
  device and transport. Do not install a dependency or add a reusable transport
  layer merely for discovery, and do not add a universal probe framework.
- If safe observation is unavailable, stop and explain the missing capability
  instead of inventing a protocol.

### 5. Implement the smallest adapter

- Use `MidiControllerProfile` and the shared MIDI surface when their Note, CC,
  action, and relative-encoder model fits the MIDI device. Implement
  `ControllerDefinition` directly for other transports, or for demonstrated
  MIDI behavior that cannot fit the profile without distorting it.
- Keep hardware-specific behavior in `src/controllers/<type>/index.ts` unless
  a real second responsibility justifies another file, then register the
  definition in the explicit map.
- Keep mappings and protocols in TypeScript. JSON may select a controller and
  override exact MIDI ports; it is not a shortcut or mapping language.
- Route genuine Micro inputs through the normalized input sink. Use only the
  closed `CodexAppAction` union for behavior outside the Micro surface.
- Reuse shared releases, aliases, modifiers, one-shot actions, encoders,
  reconnects, and feedback replay before adding local state.
- Add only the dependency or narrow configuration field demonstrated by the
  real device. Never add arbitrary command IDs, routes, scripts, DOM selectors,
  shell commands, or synthesized keyboard shortcuts.
- Cover and document any new public configuration field. Before sending output
  to physical hardware, require documented or authorized-captured messages and
  confirm the active hardware check with the user.
- Create or update the ignored project-root `codex-midi.json`. Preserve supported
  unrelated settings and set `controller.type` to the adapter's exact registry
  ID. For MIDI, add only overrides that differ from the profile defaults. A
  profile with one shared input/output name needs only `inputName`; use
  `outputName` for a separately named output and omit it for input-only devices.
  For non-MIDI adapters, omit MIDI port fields. If a real device needs another
  selector, extend `ControllerConfig`, validation, tests, and documentation
  before writing it; never invent configuration keys.
- MIDI vendor sessions stay synchronous and private. Lighting renderers return
  complete frames including explicit OFF. Haptics represent deduplicated state
  transitions rather than continuously animated lighting.
- Import `@julusian/midi` only from `src/midi/index.ts`.
- Keep native helpers and vendor-specific toolchains adapter-scoped. Add a
  separate build or test command when needed; do not silently make unrelated
  contributors install that toolchain through the project's normal setup.

### 6. Verify and report honestly

- Add behavioral coverage for mappings and genuine vendor behavior, then run
  `bun run verify`.
- Before exercising a consequential action in ChatGPT, prove the emitted event
  sequence through a test sink and confirm the user is ready for the live check.
- Guide a physical pass covering every claimed mapping and, when applicable,
  aliases, overlap orders, modifiers, chords, analog thresholds, encoder
  direction and speed, holds, feedback states, hot-plug, reconnect, handshake,
  and clean shutdown.
- Record sources, firmware, macOS and ChatGPT versions, exact ports or device
  identifiers, observed behavior, and anything not exercised.
- Automated success is not hardware acceptance. Call an adapter **implemented
  but unverified** until its physical pass succeeds; never silently omit a
  blocked or inferred behavior.

The work is complete only when the selected device and mapping are confirmed,
the adapter, local configuration, and tests are in place, documentation
distinguishes evidence from inference, and hardware acceptance has either
passed or is explicitly pending.
