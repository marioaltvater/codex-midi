# Adding a controller

The repository's `add-controller` Codex skill guides a controller contribution
from device discovery through hardware verification. It acts as an agent-run
setup wizard, but it is not part of the bridge runtime, a plugin loader, or a
`codex-midi` command.

Read the [architecture](architecture.md) for runtime boundaries and the
[provenance policy](provenance.md) before recording protocol facts.

## Guided setup for a first controller

Open this repository in Codex with the physical controller available, then
invoke the `add-controller` skill. A useful first message is:

```text
$add-controller Add support for my <manufacturer and model>. It connects over
<MIDI, gamepad, serial, or another transport>, and I can test the device.
```

You do not need to know the device's message numbers in advance. Expect the
following checkpoints before support is claimed.

### 1. Confirm the device and goal

Identify the exact model, revision or firmware, transport, operating-system
version, and desired Codex behavior. Share public documentation and, if useful,
a photo or sketch of the controls. Say which feedback features matter and which
parts of the device are out of scope.

### 2. Discover and research

For MIDI, list the exact input and output names already exposed by the project:

```sh
bun run midi:list
```

Then open only the selected input:

```sh
bun run midi:monitor -- --input "Exact Input Port"
```

The monitor does not open a MIDI output. Its output establishes bytes and
timing, not which physical control produced them.

For a non-MIDI device, use the least invasive transport-specific observation
available: read-only operating-system enumeration, a passive event listener, or
a vendor diagnostic log. There is no universal non-MIDI discovery command in
this repository. Do not send guessed messages, fuzz endpoints, brute-force a
protocol, or add a generic discovery framework just to inspect one device.
If no passive observer exists, stop at documented research until a narrow probe
for that real adapter can be reviewed and added deliberately.

Research the exact model and revision before inferring its protocol. Start with
manufacturer documentation. Clearly licensed community material may fill a
specific gap or suggest a test, but it must be cited and independently verified
rather than copied. Unlicensed or incompatibly licensed material may only
suggest a fact to verify independently. The assistant should distinguish
documented facts, live observations, and inference. See
[Provenance](provenance.md) for what may be used or committed.

### 3. Review a proposed surface map

Before implementation or broad capture, review a useful default mapping. This
can be an original labeled diagram, a grid that resembles the physical surface,
or a compact table. An authorized local photo can help the discussion, but it
must not be committed unless its license permits redistribution.

The Micro lane reproduces controls on Codex Micro and preserves their settings;
the controller-action lane provides additional app behavior outside that
surface.

The proposal should put each physical control beside its observed or documented
source, proposed behavior, action lane, activation semantics, feedback, and
evidence confidence:

| Physical control | Input | Proposed behavior | Lane | Activation | Feedback | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Top-left pad | Note from documentation | Task slot `AG00` | Micro | Held press/release | Task state | Documented |
| First encoder | Relative CC; values unknown | Micro knob | Micro | One step per detent | None | Needs capture |
| Spare side button | CC from live capture | Toggle left sidebar | Controller action | Press edge | None | Observed |

Design from the device and workflow rather than treating every Codex Micro
capability as mandatory. Frequent reversible operations should be easy to
reach. Consequential operations should use deliberate digital gestures and a
guard when accidental activation is plausible. Analog or noisy inputs are best
suited to continuous, reversible behavior such as scrolling, navigation, or
adjustment.

Use the hardware's own interaction vocabulary:

- paired controls suit decrease/increase or previous/next behavior;
- grids and dynamically labeled surfaces can make direct task slots natural;
- constrained or sequential devices may be clearer with previous/next task
  navigation instead of hidden slot chords;
- encoders, wheels, faders, sticks, and touch strips suit continuous adjustment
  when their physical behavior matches;
- modifiers should have one recognizable purpose, not serve as banks to fill
  with unrelated spare actions;
- an unmapped control is better than an arbitrary assignment.

Prefer genuine Micro inputs when the physical control naturally matches the
Micro surface. This preserves Codex Micro settings and user remapping. A
faithful Micro mapping may intentionally duplicate a dedicated controller
action; duplicates and aliases are appropriate when they improve fidelity,
reach, or accessibility, but each should have a stated reason.

Before presenting a recommendation, compare a minimal workflow-first layout
with a broader-coverage layout. Check discoverability, accidental activation,
physical fit, modifier complexity, target-surface fidelity, and verification
cost. Present one recommendation unless a material tradeoff needs the user's
choice, and list deliberate omissions rather than hiding them.

#### Define the relevant input semantics

Every mapped gesture needs deterministic activation, release, overlap, and
disconnect behavior proportional to its risk. Apply safeguards to the actual
physical source: noise on an analog control does not make an equivalent
deliberate D-pad, key, pad, or switch unsafe. Apply only the checks relevant to
the proposed hardware:

- For buttons and holds, state whether the behavior fires on press, mirrors
  press and release, repeats, or uses a deliberate long press. Default discrete
  navigation and adjustment to one event per press. Hold-repeat must define its
  initial delay, rate, optional acceleration, and cancellation.
- For a modifier or guarded chord, bind the destination when the gesture begins.
  A modifier pressed midway must not reinterpret an active control. Define order,
  suppression, release, and rearming; ambiguous states around a consequential
  action should fail closed. Prefer at most one modifier layer on constrained,
  unlabeled hardware, and require a clear purpose and reliable reach for every
  chord. Dynamically labeled surfaces may use broader banks when current labels
  keep them discoverable.
- Let paired decrement and increment controls chord to Select only when that is
  a natural, physically reliable grammar. Define the buffering window,
  constituent-event suppression, one-shot firing, accepted order, added
  latency, release behavior, and neutral rearming.
- For analog inputs, define dead zones, activation and release thresholds,
  hysteresis, diagonal handling, one-shot versus repeating behavior, and neutral
  rearming. Preserve angle and magnitude for a genuine analog-to-Micro mapping
  when the hardware supports it, and account for movement caused by clicking a
  stick or similar control when that could trigger another action.
- For aliases or overlapping sources, track physical sources independently.
  Releasing one source must not cancel another that still holds the logical
  input; mixed analog and digital sources need an explicit composition or
  priority rule that restores a still-current source after an override.
- On disconnect, clear pending chords, modifiers, repeats and their timers,
  logical holds, and reset analog state to neutral.
- For feedback, say what the signal actually confirms: physical input, a local
  mode or modifier, command emission, transport acceptance, or independently
  observed application state. Never imply stronger confirmation than the
  available evidence. Deduplicate transient feedback and keep optional output
  non-blocking; missing feedback must not delay or alter input.
- Keep mapping arbitration and timing logic testable without physical hardware,
  with transport I/O confined to the adapter edge.

Before asking for approval, run one conflict audit covering every destination,
the reason for each duplicate, modifier and chord precedence, analog neutral
and override behavior, and the distinction between fixed adapter behavior and
user-remappable Micro defaults.

Treat the mapping as a proposal, not a protocol fact. The user can accept the
recommendation, adjust selected controls, or define a custom layout. After any
revision, show the complete final map and ask for explicit approval of that
exact version. The approved map becomes the implementation and verification
checklist.

### 4. Capture only unresolved controls

The assistant should lead a short, labeled capture sequence while you operate
the device. Start from an idle controller, exercise one named control, return to
idle, and label that observation before continuing. Capture as applicable:

- press, hold, release, velocity, and pressure forms;
- both encoder directions, pulses per detent, and slow and fast timing;
- modifier order, chords, analog rest drift and full range, click movement,
  neutral rearming, and controls that share a destination;
- connection, hot-plug, reconnect, and clean shutdown behavior;
- feedback, mode entry, or handshakes only when official documentation or a
  narrow authorized capture establishes the outbound messages.

Use the same discipline with passive non-MIDI events or vendor logs. Keep raw
local evidence under ignored `.codex-midi/` paths; commit only the smallest
facts and fixtures needed to explain and test the behavior.

### 5. Implement, exercise, and record status

The assistant should choose the smallest adapter contract, keep device-specific
behavior together, add behavior-focused tests, and run `bun run verify`. It
should then walk through the approved map on the physical controller and record
what was and was not exercised.

Passing automation is not hardware acceptance. Until the live checklist is
complete, describe the adapter as **implemented but unverified** and list the
gaps. Use **supported** only after the complete
hardware gate below passes on the stated device, firmware, operating system,
and ChatGPT build.

## Technical authoring reference

### Choose the adapter contract

Every device implements `ControllerDefinition`, which supplies a display name
and creates a controller surface. A surface starts with a normalized Codex Micro
input sink, may consume Codex feedback, and stops by releasing every hardware
resource.

For MIDI hardware whose behavior fits notes, CC controls, actions, and relative
encoders, declare a `MidiControllerProfile` and let `createMidiSurface()`
provide decoding, aliases, modifiers, actions, encoders, reconnects, and
feedback replay. Keep the profile in one lowercase, hyphenated directory:

```text
src/controllers/my-controller/
└── index.ts
```

A minimal input-only profile is:

```ts
import type { MidiControllerProfile } from "../midi-profile.js";

const profile = {
  displayName: "Example Pad Controller",
  ports: { input: "Example Pad Controller" },
  mapping: {
    notes: {
      36: "AG00",
      37: "ACT10",
    },
    buttons: {
      103: "ENC",
    },
    joystick: {
      87: "up",
    },
  },
} satisfies MidiControllerProfile;

export default profile;
```

Wrap that profile with `createMidiSurface()` in a `ControllerDefinition` and
add the definition to the explicit typed map in `src/controllers/index.ts`.
That map determines valid `controller.type` values; there is no filesystem scan
or dynamic runtime plugin loading.

For gamepads, serial devices, accessibility switches, other transports, or MIDI
hardware that genuinely does not fit the shared profile, implement
`ControllerDefinition` directly. Keep transport setup, passive event
translation, optional feedback, and cleanup private to the adapter. Add a
shared capability only after a real second adapter needs it and a generic test
can describe it.

### Map inputs to the correct lane

Use the Micro lane for controls present on Codex Micro:

- `AG00` through `AG05`: six task/status keys;
- `ACT06` Fast, `ACT07` Approve, `ACT08` Reject, `ACT09` Fork, `ACT10`
  Microphone, and `ACT12` Submit; leave `ACT11` unmapped until its behavior is
  verified;
- `ENC`, `ENC_CW`, and `ENC_CC`: knob click and turns;
- joystick `up`, `down`, `left`, and `right`.

Repeating a destination creates an alias. The shared MIDI surface
reference-counts aliases so one physical release cannot release a logical input
still held by another source.

Use the parallel controller-action lane only for behavior outside the Micro
surface. Internally these actions form the closed `CodexAppAction` allowlist:

- `toggle-left-sidebar`;
- `toggle-review-panel` and `toggle-maximize-review-panel`;
- `previous-task` and `next-task`;
- `scroll-task-up`, `scroll-task-down`, and `scroll-task-to-bottom`;
- `toggle-plan-mode`;
- `run-environment-action`;
- `open-codex-micro-settings`.

MIDI action bindings fire once on a physical press edge and may declare one
shifted alternative. Disconnect clears held actions and modifiers; actions are
never retried or replayed. Profiles cannot supply arbitrary ChatGPT command
IDs, routes, scripts, DOM selectors, shell commands, or synthesized keyboard
shortcuts. Add a new allowlisted action only for a narrow, testable app behavior
useful beyond one controller.

Declare each relative MIDI encoder as one unit: its CC, captured clockwise and
counter-clockwise values, pulses per step, minimum step interval, pulse
sequence timeout, and direction targets. A direction may target `ENC_CW` or
`ENC_CC`, or one allowlisted controller action. Never infer physical direction from
the numeric values alone.

### Keep protocol behavior at the edge

Only `src/midi/index.ts` imports `@julusian/midi`. A MIDI profile uses the
contracts in `midi-profile.ts`; it does not import the native package.

Ordinary Note/CC decoding, releases, aliases, modifiers, one-shot actions,
relative encoders, reconnects, and feedback replay belong to
`midi-surface.ts`. Use a synchronous, profile-private `createSession` only for
observed vendor connection behavior such as a documented mode or handshake.

A pure `renderLighting` returns complete controlled frames on every render,
including explicit OFF messages. Add an output port only when the adapter sends
documented messages. Direct non-MIDI adapters may omit feedback entirely.

Every local setup creates an ignored `codex-midi.json` in the project root. Its
`type` is the exact key registered in `src/controllers/index.ts`:

```json
{
  "controller": {
    "type": "my-controller"
  }
}
```

MIDI adapters may also override exact port names:

```json
{
  "controller": {
    "type": "my-controller",
    "inputName": "Exact Input Port",
    "outputName": "Exact Output Port"
  }
}
```

Add port overrides only when the confirmed names differ from the profile
defaults. When the profile uses one name for both input and output, `inputName`
covers both; use `outputName` for a separately named output. An input-only MIDI
adapter omits `outputName`.

A direct non-MIDI adapter—such as a Bluetooth game controller—normally uses the
type-only form and ignores MIDI ports. If a real adapter needs a persistent
device selector or another setting, extend `ControllerConfig`, `loadConfig()`,
tests, and this documentation together before writing that field. Preserve an
existing supported `socketPath`, remove stale controller fields, and never put
unknown keys in the file.

Mappings, actions, shortcuts, encoder timing, firmware behavior, vendor modes,
and feedback remain in TypeScript rather than public configuration.

### Verify behavior and state support honestly

Run the complete automated gate:

```sh
bun run verify
```

If an adapter requires a native helper or vendor-specific toolchain, expose and
run an adapter-scoped build or test command as well. Do not silently make that
toolchain a prerequisite for unrelated controller work unless it becomes a
project-wide requirement.

Add generic coverage only for shared behavior. Test vendor behavior through the
adapter's public surface; do not copy an entire profile into an equality
assertion or import private helpers.

Before a live check of any consequential action, prove its emitted sequence
through a test sink or equivalent instrumentation, then confirm the user is
ready.

Before claiming support, exercise and document:

1. cold connection, hot-plug, reconnect, and clean shutdown;
2. every mapped Micro input and controller action;
3. every applicable alias, overlap order, modifier, chord, hold, and forced
   release;
4. every applicable analog threshold, neutral transition, repeat behavior, and
   encoder direction at slow and fast speeds;
5. every supported feedback state, including OFF, with human confirmation when
   perception matters;
6. mode and feedback restoration after reconnect;
7. controller-action behavior on the recorded ChatGPT version and build.

Record official sources, any community research and its license status, capture
procedure, controller firmware, operating-system version, ChatGPT version and
build, exact ports or other device identifiers, observed behavior, and anything
not exercised. A contribution that passes automation but not this live gate is
**implemented but unverified**.
