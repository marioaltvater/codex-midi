# Provenance policy

This project reimplements observable behavior for interoperability. It accepts
protocol facts and minimal test fixtures, not proprietary implementation code or
redistributable vendor artifacts.

## Evidence hierarchy

Research official sources first, then use only the additional evidence needed
to verify or fill a documented gap:

1. cite the manufacturer's public product, owner, programmer, protocol, or MIDI
   implementation documentation, including its title, revision, and URL;
2. use community research only as a cited lead or corroboration, recording the
   project, version, URL, and its license or lack of a declared license;
3. capture reproducible messages or events only from hardware and software the
   contributor owns or is otherwise authorized to inspect;
4. label any remaining inference and keep it out of the supported path until it
   is verified.

Publicly visible community code is not automatically licensed for reuse. An
unlicensed or incompatibly licensed project may suggest a fact to verify, but
it cannot supply implementation code or other expressive material. Prefer
independently verified protocol facts; any actual code reuse must have a
compatible license and preserve its required attribution.

Authorized capture should be passive or narrowly targeted to documented
behavior. Do not brute-force a protocol, record unrelated traffic, or inspect
accounts, devices, or software outside the contributor's permission.

For controller work, record the source title, revision or firmware version,
URL when public, community-source license when used, exact port or device names,
capture procedure, and observed bytes or events. State where an adapter differs
from or fills a gap in the official documentation.

For ChatGPT/Codex Micro interoperability, distinguish public product behavior
from observations of the installed app's local device protocol. App build
numbers matter because private integrations can change.

## Allowed repository material

- original bridge and profile source code;
- descriptions of message formats, identifiers, state machines, and behavior;
- small, purpose-limited byte sequences needed by tests;
- synthetic or minimized fixtures with no user content or credentials;
- links and citations to public manufacturer documentation;
- reproducible capture instructions.

## Do not commit

- firmware binaries, application bundles, vendor SDKs, or extracted source;
- copied proprietary implementation code, artwork, manuals, or key legends;
- authentication tokens, socket tokens, account identifiers, task content, or
  unrelated HID/MIDI traffic;
- broad packet dumps when a few minimized messages demonstrate the behavior;
- guessed protocol behavior presented as verified support.

Keep local raw captures under the ignored `.codex-midi/` directory. Derive the
smallest fixture that preserves the behavior being tested, and explain its
origin in the test or controller documentation.

## Contribution declaration

A controller contribution should say:

- which public documents were used;
- which community sources were consulted, their license status, and how they
  were used;
- which facts came from live capture;
- that the contributor was authorized to inspect the device/software involved;
- which controller firmware, macOS version, and ChatGPT build were exercised;
- which behavior remains inferred or untested;
- that no restricted binary, copied vendor implementation, secret, or personal
  data is included.

Product and company names identify compatibility only. They do not imply
affiliation, endorsement, or ownership of those trademarks.
