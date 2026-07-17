---
name: add-midi-controller
description: Add or update one typed MIDI controller profile in codex-midi and verify it without regressing the shared runtime. Use for mappings, encoders, joystick controls, documented lighting, or vendor connection behavior under src/controllers. Do not use for Project2077, host transport, or ChatGPT preload changes.
---

# Add a MIDI controller

## Read the authorities

Read these files completely before editing:

1. `docs/adding-a-controller.md` — implementation and acceptance workflow;
2. `docs/architecture.md` — ownership boundaries;
3. `docs/provenance.md` — permitted evidence and repository material;
4. `src/controllers/controller-profile.ts` — authoring contract;
5. `src/controllers/midi-surface.ts` — shared behavior;
6. `src/controllers/index.ts` — typed profile map;
7. the relevant controller's `src/controllers/<type>/index.ts`.

Treat current source and behavioral tests as authoritative. Do not copy paths,
APIs, or assumptions from older commits.

## Non-negotiable boundaries

- Keep hardware-specific behavior in one
  `src/controllers/<type>/index.ts` unless a real second responsibility demands
  a split.
- Export a plain object using `satisfies MidiControllerProfile` and add it to
  the typed map in `src/controllers/index.ts`.
- Keep mappings and protocol behavior in TypeScript. JSON may only select a
  profile and override exact port names.
- Repeated destinations are aliases; do not introduce another alias syntax.
- Import `@julusian/midi` only in `src/midi/index.ts`. Use its shared `midi`
  object or injected test backend rather than adding another wrapper.
- Use the shared Note/CC, release, alias, joystick, relative-encoder,
  reconnect, and lighting-replay behavior before adding local code.
- Keep a vendor session synchronous and private to the profile. A lighting
  renderer must return complete controlled frames, including explicit OFF.
- Change `midi-surface.ts` only after another real controller needs the same
  behavior and a generic test can describe it.
- Do not add keyboard shortcuts or actions outside the Codex Micro surface.

## Evidence and verification

Start with official manufacturer documentation, then verify it with the
input-only raw monitor and the physical device. Follow
`docs/adding-a-controller.md` rather than duplicating the capture procedure
here. Follow `docs/provenance.md` for community research and local artifacts.

Run:

```sh
bun run verify
```

Add generic coverage only for shared behavior. A focused profile test is
optional for genuine vendor protocol behavior; do not copy mappings into a
circular equality assertion or import private helpers. The bundled ATOM keeps
its comprehensive black-box regression because it is the reference adapter.

Automated success is not hardware acceptance. Exercise and document every
mapping, alias, encoder direction and speed, hold, lighting state, hot-plug,
reconnect, vendor handshake, and clean shutdown before claiming support.
Record official sources, controller firmware, macOS and ChatGPT versions,
exact ports, commands, live evidence, and anything not exercised.
