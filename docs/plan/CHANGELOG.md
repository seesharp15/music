# Contract changes

Every change to [contracts.md](contracts.md) after the build starts gets a line here: the date, the work
package, what changed, and who needs to know. Newest first.

| Date | Package | Change | Affects |
| --- | --- | --- | --- |
| 2026-11-16 | S2.3 | Contracts §5 now states what each `EditOp` does at its edges (range semantics of `setChords`, what the range operations move, what a locked track refuses, `undefined` in a patch) and what the store offers beyond `ProjectStore` (`undoLabel`, `redoLabel`, `saveError`, `flush`, `dispose`, `ProjectPersistence`). No type changed. | Stage 3's tools and Stage 5's generators, which emit these ops. |
| 2026-11-16 | S2.1 | `TimeMap` gains `meterAt(tick)` and `bpmAt(tick)` (contracts §1), so code holding only a time map can ask how a bar divides. Additive. | Anything that implements `TimeMap` itself rather than calling `makeTimeMap` — nothing does. |
| 2026-11-16 | S1.5 | `Sink` gains an optional `damp(when?)` (contracts §6): silence what is ringing under the sustain pedal without lifting it. Additive. | Stage 2's `AudioEngine`, which takes the sink's place, must implement it; the player calls it at every loop wrap. |
| 2026-11-15 | S0.5 | Added the route `#/credits` (contracts §11). Additive. | Stage 9.6, which planned an About page: extend this one. Later stages that bundle samples or models add their credit here. |
