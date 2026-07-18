# PreSonus ATOM

The ATOM is the bundled reference controller. Its complete adapter lives in one
file:

```text
src/controllers/atom/index.ts
```

That file owns the physical mapping, relative encoders, native-mode session,
composite Quick Setup message, and pad-lighting renderer. Shared Note/CC
decoding, aliases, modifiers, controller actions, pacing, reconnects, and
lighting replay come from `src/controllers/midi-surface.ts`.

Default CoreMIDI input and output names are both `ATOM`. A configuration file
may override those exact port names; it cannot override the mappings or ATOM
protocol.

<p align="center">
  <img
    src="../assets/atom-codex-layout.svg"
    alt="PreSonus ATOM layout showing the Codex task, action, microphone, and submit pads"
    width="760"
  >
</p>
<p align="center"><sub>Default ATOM pad roles. Side controls retain their hardware labels; only the controls listed below are mapped.</sub></p>

## Pad layout

ATOM pad notes count upward from the bottom row:

```text
13 ----    14 AG00   15 AG01   16 ----
 9 AG02    10 AG03   11 AG04   12 AG05
 5 ACT06    6 ACT07   7 ACT08    8 ACT09
 1 ----     2 ACT10   3 ACT10    4 ACT12
```

The corresponding MIDI notes are 36 through 51. Pads 13, 16, and 1 (notes 48,
51, and 36) represent positions the Codex Micro does not expose and remain off.

Pads 2 and 3 intentionally map to the same `ACT10` destination. ChatGPT
presents the Micro microphone control as a double-width slot and handles both
physical pads as one reference-counted logical key.

The six `AG` pads are Codex task slots, not permanently assigned tasks. Their
order follows the Agent keys mode in ChatGPT's Codex Micro settings and can
change with task recency.

## Dedicated controls

| ATOM control | MIDI | Codex behavior |
| --- | ---: | --- |
| Encoder 1 turn | CC 14 | Micro encoder turn |
| Encoder 2 turn | CC 15 | Previous task counter-clockwise; next task clockwise |
| Encoder 3 turn | CC 16 | Intentionally unmapped |
| Encoder 4 turn | CC 17 | Scroll visible task up counter-clockwise; down clockwise |
| Set Loop | CC 85 | Micro encoder click (`ENC`) |
| Song Setup, orange rectangular button | CC 86 | Micro encoder click (`ENC`) |
| Select | CC 103 | Micro encoder click (`ENC`) |
| Click / Count In | CC 105 | Micro encoder click (`ENC`) |
| Shift | CC 32 | Hold the shifted action layer |
| Show / Hide | CC 29 | Toggle the left sidebar |
| Shift + Show / Hide | CC 32 + CC 29 | Toggle the review panel |
| Preset / Focus | CC 27 | Toggle Plan mode |
| Nudge / Quantize | CC 30 | Scroll to the bottom of the visible task |
| Quick Setup, black circular button | Channel-10 note-off sweep | Open Codex Micro settings |
| Zoom | CC 104 | Maximize or restore the review panel |
| Play | CC 109 | Run the default environment action |
| Up | CC 87 | Micro joystick up |
| Down | CC 89 | Micro joystick down |
| Left | CC 90 | Micro joystick left |
| Right | CC 102 | Micro joystick right |

Set Loop, Song Setup, Select, and Click / Count In are reference-counted aliases
for the same Micro encoder switch. Holding any alias keeps `ENC` pressed;
ChatGPT decides when the press becomes the Micro-settings long press.

Up, Down, Left, and Right remain genuine Micro joystick inputs. Preset and
Show/Hide no longer alias those directions: they use the separate controller-
action lane, so their behavior does not depend on configurable keyboard
shortcuts.

Encoder 2 reacts on the first detent but throttles rapid successive task
changes. Encoder 4 uses small, precise scroll steps when turned slowly and
accelerates as its captured ticks arrive more quickly.

Shift is held while CC 32 is nonzero and released immediately at value zero:

```text
B0 20 7F   Shift down
B0 20 00   Shift up
```

The shared MIDI surface clears modifier state when the controller disconnects.
Shift changes Show/Hide to the review-panel action; it does not emit both the
shifted and unshifted action.

### Quick Setup composite message

The black circular **Quick Setup** button is not the orange rectangular
**Song Setup** button. It emits no conventional press message. In native mode,
one click produces an ordered channel-10 note-off sweep covering all 16 pads:

```text
89 24 00
89 25 00
...
89 33 00
```

The ATOM session recognizes only that complete sequence and then requests the
Codex Micro settings route once. A mismatch resets the partial sequence, and a
partial sweep has no action. This composite signature is ATOM-specific and
does not complicate the shared MIDI decoder.

Editor, Record, and Stop remain unmapped. ChatGPT currently exposes no clean
controller actions for opening the project in its default editor or stopping the
active environment action, and this project does not synthesize keyboard
shortcuts as a fallback.

## Encoders

ATOM Encoder 1 is not itself a MIDI push switch; the button aliases above
provide click and hold.

The mapped encoders use relative CC messages with the same captured direction
values:

| Physical direction | Value |
| --- | ---: |
| Clockwise | 1 (`01`) |
| Counter-clockwise | 65 (`41`) |

An input-only capture on 18 July 2026 confirmed the same relative format for
the mapped encoders: clockwise sends `01`, while counter-clockwise sends `41`
on CC 14, 15, and 17. Encoder 3 was also observed on CC 16 but remains unused.
The monitor's leading `+...ms` value is elapsed time since the previous
message; it is not part of the MIDI event and does not control speed.

Encoder 1 retains its separately calibrated Micro behavior: five physical
ticks produce one Micro step, with a 50 ms guard against duplicate steps. Its
Micro event names are deliberately opposite the ATOM wire direction because
that mapping was verified in ChatGPT. Encoder 2 changes task on its first tick
and rate-limits subsequent changes to one every 400 ms. Encoder 4 sends every
tick as a precise native wheel event, using a smaller step for slow turns and a
larger step for fast turns. Encoder 3 is left unused. The values and targets
live in the ATOM adapter, not runtime configuration.

Encoder 1 remains a faithful Micro knob: in ChatGPT's default knob mode it
moves among composer controls or options, click opens or selects the highlighted
control, and hold opens Codex Micro settings. In Reasoning mode, ChatGPT applies
turns to reasoning effort. Encoder 2 instead moves between tasks, while Encoder
4 sends native scroll steps to the focused ChatGPT task. These additional
actions never enter the Project2077 report stream.

## Lighting

The ATOM adapter renders Codex state as:

- idle: white;
- thinking: blue;
- complete or unread: green;
- needs input: amber;
- error: pink/red;
- microphone pads 2 and 3: steady full white (`127, 127, 127`);
- pad 4, Codex/submit: softened bright blue (`25, 25, 127`);
- pad 5, Fast: yellow (`127, 127, 0`);
- pad 6, Approve: green (`0, 127, 0`);
- pad 7, Reject: red (`127, 0, 0`);
- pad 8, Fork task: dim purple (`50, 0, 50`);
- unused pads: off.

ATOM renders green-dominant completed-task colors as pure green, avoiding the
teal cast produced by the controller's LEDs.

Occupied inactive task pads are dimmer than the selected task. The selected
task follows the Micro breathing effect. ChatGPT's automatic lighting timeout
normally sends an all-off state. The ATOM adapter translates that into steady
20% lighting for every mapped pad instead: task pads retain a supplied color
or fall back to neutral white, and action pads retain their function colors.
Only unused pads 1, 13, and 16 remain off.

The profile's private `renderAtomPadLighting()` returns four messages for each
pad: pad state on MIDI channel 1, followed by RGB components on channels 2, 3,
and 4. It returns a complete frame for every controlled pad, including
explicit OFF messages. The shared surface sends changed frames and replays the
current lighting after reconnect.

## Native mode

The profile's private `createAtomNativeModeSession()` owns the ATOM handshake:

```text
8F 00 7F   enter native mode
BF 7F 7F   native-mode acknowledgement
8F 00 00   leave native mode
```

It waits for the initial acknowledgement, retries the handshake once, replays
lighting when ready, and returns the device to ordinary mode on clean shutdown.
It does not send a periodic native-mode watchdog: hardware testing showed that
ATOM acknowledged the initial off-to-on negotiation but not a redundant ON
request while already in native mode.

## Hardware difference

Codex Micro's joystick is analog. ATOM's direction cluster is digital, so it
replicates the four directions but cannot emit arbitrary angles or distances.
The normalized controller surface retains magnitude for a future controller
that supports analog movement.

## Evidence and verification

Standard notes, CC assignments, and channels are grounded in PreSonus's
[ATOM Owner's Manual](https://www.fmicassets.com/Damroot/Original/10078/OM_ATOM_EN.pdf),
especially its MIDI Mapping and Advanced Setup sections. Shift's press/release
form, the Quick Setup composite sequence, native-mode negotiation, and RGB
messages are interoperability observations from authorized local ATOM hardware
and the working bridge; the public manual does not specify those host details.

The channel order and intensity range were independently verified on the local
controller. Two public projects were also consulted as research leads: the raw
[Studio One capture](https://github.com/kmitch95120/Reaper-ATOM-Integration/blob/c05c404f8d1e5c24d71d363452cf333f81bd94f2/Explore/new_song_capture.txt#L9-L31)
and [tested color table](https://github.com/kmitch95120/Reaper-ATOM-Integration/blob/c05c404f8d1e5c24d71d363452cf333f81bd94f2/REAPER/Scripts/ATOM/COLORS.lua#L12-L28)
in Reaper-ATOM-Integration, which has no declared license, and an independent
[ATOM protocol experiment](https://github.com/EMATech/AtomCtrl/blob/dd8ea54ae97a247efba7854b97ee836e6ea5fcea/main.py#L85-L97)
licensed under GPL-3.0. They were used only to corroborate questions and local
observations; no implementation code or other expressive material was copied.

Evidence collected on 16–18 July 2026 used macOS 27.0, ChatGPT
**26.715.31925**, build **5551**, and exact input and output names `ATOM`; the
controller firmware was not queried. An input-only capture used:

```sh
bun run midi:monitor -- --input "ATOM"
```

A manual device check confirmed both ports, native-mode acknowledgement, the
established Micro controls, lighting output, and clean exit. The same live pass
identified and corrected Encoder 1's Micro event mapping. A later input-only
capture established the mapped encoders' physical direction bytes. A final
in-app pass on 18 July confirmed the controller-action mappings and additional
encoders behave as documented.

The tracked ATOM regression exercises the exported profile through the shared
MIDI surface and raw input rather than importing private helpers or copying its
mapping object. That automated coverage protects the reference profile.
