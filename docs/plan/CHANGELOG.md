# Contract changes

Every change to [contracts.md](contracts.md) after the build starts gets a line here: the date, the work
package, what changed, and who needs to know. Newest first.

| Date | Package | Change | Affects |
| --- | --- | --- | --- |
| 2026-11-16 | S2.4 | Song (contracts §2): optional `volume` on each `tracks` entry and on `drums`, so a compiled song carries its mix. Stated, not changed: a song's `bpm` counts the beat its time signature names. Contracts §4 now says what compiles (muted tracks do not) and what `projectFromSong` rebuilds. Additive. | S2.5's player reads the volumes as the starting track mix. Stage 8's importer, which writes `bpm` for songs in 6/8 and 12/8. |
| 2026-11-16 | S2.6 | Storage (contracts §10): two `localStorage` keys added, `piano-tutor:unsaved:<projectId>` and `piano-tutor:storage-persist`; a `kv` entry `songs:index`; and the storage layer's promises written down (`loadProject`'s result type, validate-on-read, the `Catalog`). Additive. | Stage 3 (S3.1's read-only screen switches on `reason: "invalid"`; S3.8 loads `u-…` songs through `catalog().load`; S3.9's export-all must include nothing from `piano-tutor:unsaved:*`). |
| 2026-11-16 | S2.3 | Contracts §5 now states what each `EditOp` does at its edges (range semantics of `setChords`, what the range operations move, what a locked track refuses, `undefined` in a patch) and what the store offers beyond `ProjectStore` (`undoLabel`, `redoLabel`, `saveError`, `flush`, `dispose`, `ProjectPersistence`). No type changed. | Stage 3's tools and Stage 5's generators, which emit these ops. |
| 2026-11-16 | S2.1 | `TimeMap` gains `meterAt(tick)` and `bpmAt(tick)` (contracts §1), so code holding only a time map can ask how a bar divides. Additive. | Anything that implements `TimeMap` itself rather than calling `makeTimeMap` — nothing does. |
| 2026-11-16 | S1.5 | `Sink` gains an optional `damp(when?)` (contracts §6): silence what is ringing under the sustain pedal without lifting it. Additive. | Stage 2's `AudioEngine`, which takes the sink's place, must implement it; the player calls it at every loop wrap. |
| 2026-11-15 | S0.5 | Added the route `#/credits` (contracts §11). Additive. | Stage 9.6, which planned an About page: extend this one. Later stages that bundle samples or models add their credit here. |
