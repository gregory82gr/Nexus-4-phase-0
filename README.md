# NEXUS-4 — Critical-Systems Processor & VHDL Workbench

**A single-file VHDL course, a time-predictable RISC-V processor for critical systems, and a hardware guardian that checks formal properties while the processor runs.**

[![License: MIT](https://img.shields.io/badge/License-MIT-22d3ee.svg)](LICENSE)
![Single file](https://img.shields.io/badge/build-none%20%C2%B7%20one%20HTML%20file-3ddc84)
![Simulation only](https://img.shields.io/badge/scope-simulation%20only-ffb000)
![Status](https://img.shields.io/badge/status-phase%200%20in%20development-a78bfa)
[![Differential tests](https://github.com/gregory82gr/Nexus-4-phase-0/actions/workflows/differential.yml/badge.svg)](https://github.com/gregory82gr/Nexus-4-phase-0/actions/workflows/differential.yml)

> **Status: work in progress.** This repository is in Phase 0. What exists today:
> - the console skeleton (`index.html`: overview, course plan, verification, roadmap, About),
> - the GHDL oracle tooling and its calibration examples,
> - the GitHub Actions workflow that runs them on every push.
>
> The simulator kernel and the course chapters are being built. This README also describes the design that has been decided; a feature exists only when the [roadmap](#roadmap) marks it as available.

NEXUS-4 will run entirely in the browser from one `index.html`, like its siblings. It has three parts that build on each other:

1. **A complete, interactive VHDL course.** It is written for software engineers who can program but have never designed hardware. It runs on its own VHDL simulator, written in JavaScript, which shows every delta cycle.
2. **A RISC-V processor at RTL level, for critical systems.** The core is RV32I, multi-cycle and in-order. It is written in VHDL and runs on the same simulator, next to a reference model of the instruction set that checks it on every instruction.
3. **A hardware guardian.** This is a small, hardwired unit derived from a formal specification. It watches the processor and steps in when a safety, bounded-liveness or idempotency property is violated, whether the cause is a design error or a radiation-induced bit flip.

NEXUS-4 is the fourth system in the NEXUS series:
- [NEXUS-1](https://github.com/gregory82gr/nexus1), the nuclear plant ([live demo](https://gregory82gr.github.io/Nexus-1-phase-0))
- [NEXUS-2](https://github.com/gregory82gr/Nexus-2-phase-0), the satellite constellation
- [NEXUS-3](https://github.com/gregory82gr/Nexus-3-phase-0), the shared-memory multiprocessor

It reuses their design language. Its processor is meant for the first two: the protection channel of the NEXUS-1 plant and the on-board computer of a NEXUS-2 satellite.

> **Simulation only.** NEXUS-4 is a demonstration and study tool. Its processor has not been synthesized for, or qualified on, any real device. It is not certified to any safety standard and must not be used to protect any real plant, vehicle or person. Standards are cited for orientation only (see [Standards awareness](#standards-awareness)).

---

## Why NEXUS-4

NEXUS-3 was about **hiding** time: out-of-order cores, caches, prefetching and latency tolerance. NEXUS-4 is about the opposite: making time **predictable**, and making a processor **checkable**.

In a critical system, being fast on average matters less than two other questions:
- Will this instruction sequence always finish within N cycles?
- Can we tell, while it runs, that the software still respects its specification?

NEXUS-4 is built around those two questions.

---

## Part 1 — The VHDL course (Phase 0)

### Approach

The course explains VHDL through ideas its readers already know:

| VHDL | Software analogy used in the course |
|---|---|
| Signal assignment | Recording an event: the change is scheduled, not applied |
| Delta cycle | A commit: all scheduled changes apply together and wake their handlers |
| Process | An event handler or projection that reacts to changes |
| Variable | Local state inside the handler, updated immediately |
| Finite state machine | The states of an aggregate |

### Planned structure

- **Part I, the mindset shift:**
  - hardware is not a program
  - entity and architecture as interface and implementation
  - combinational logic
  - the simulation kernel and delta cycles
  - signals versus variables
- **Part II, synchronous design:**
  - clocks, flip-flops and reset
  - inferred latches
  - state machines
  - the nine values of `std_logic` and `numeric_std`
- **Part III, structure:**
  - hierarchy, generics and `generate`
  - packages
  - memories and register files
- **Part IV, verification:**
  - self-checking testbenches
  - what becomes hardware and what exists only in simulation
- **Bridge:** from an ALU to a datapath, leading into Part 2.

Every chapter is planned to include:
- a live editor
- a waveform viewer
- a delta-cycle inspector
- a "for the software engineer" box
- a "trap" box
- a scored drill, in the style of the Training Mode of NEXUS-2 and NEXUS-3

### The language subset

The simulator implements **VHDL-93 plus selected VHDL-2008 features**: `process(all)`, reading output ports, conditional assignment inside processes, reduction operators and `to_string`.

One rule decides what is in: a feature is supported if the processor or its testbench needs it, or if it is needed to teach a semantic trap. Examples:
- `std_logic` resolution is in, because a tri-state bus is too good a lesson to skip.
- Access types, file I/O and `textio`, configurations, protected types and generic packages are out.

Examples that need features outside the subset are shown as pre-computed GHDL runs, clearly marked as such.

---

## Part 2 — The processor (Phases 1 and 2)

### Core

| Aspect | Choice | Why |
|---|---|---|
| Instruction set | RISC-V RV32I subset | Small, open and formally specified. Its reserved custom opcode space holds the guardian's marker instructions |
| Microarchitecture | Multi-cycle, in-order | Each instruction class takes a fixed number of cycles, so worst-case execution time is a sum. The guardian sees one completed instruction at a time, with exceptions that point at an exact instruction |
| Memory | Scratchpad, no caches | No hit-or-miss timing to bound |
| Branches | No dynamic prediction | Same reason |
| Programs | Hand-written assembly | Through the NEXUS-4 assembler, with an extended assembly Help and a visual instruction encoder |

A reference model of the instruction set, written in JavaScript, runs in the browser next to the RTL core. The two are compared after every instruction, so the reader can watch the implementation keep to its specification.

### Two fault-tolerance profiles (Phase 2)

The same VHDL design builds two profiles through generics and `generate`:

| | PLANT (NEXUS-1) | ORBIT (NEXUS-2) |
|---|---|---|
| Main threat | Systematic faults: design errors and common-cause failures | Random faults: single-event upsets and accumulated radiation dose |
| Mechanisms | Lockstep with comparator, watchdog, guardian mandatory | SEC-DED ECC on register file and memory with scrubbing, TMR on the program counter and control FSM, watchdog |
| On a detected fault | **Fail-safe**: trip | **Fail-operational**: safe mode |

The reader can flip any bit of the running processor and watch which mechanism catches it, or see that nothing does.

---

## Part 3 — The guardian (Phase 3)

NEXUS-4 follows a Simplex-style architecture:
- The **processor** is the complex channel that runs the control software.
- The **guardian** is a simple, hardwired, verified unit. It runs no software and steps in on any property violation, whatever the cause.

The guardian has to stay much simpler than what it guards. It is built only from:
- combinational invariant checks,
- small finite automata,
- counters,
- linear comparisons of a few values.

### What it checks

| Formal lens | Hardware form in the guardian | Status in plan |
|---|---|---|
| TLA+ invariants and temporal safety | Invariant checks and small automata over committed state | First |
| Bounded liveness ("within N cycles") | Deadline counters. A bounded liveness property is a safety property | First |
| Petri nets | Places as token counters, transitions as marker instructions; a transition that is not enabled is a violation | Second |
| Idempotency | Inside a declared idempotent region, a write to an address already read in that region is a violation | Third |
| Hoare contracts | Pre- and post-conditions at function entry and exit, restricted to linear comparisons | Fourth |

### What it cannot check

- **Unbounded liveness** ("eventually"). No run-time monitor can detect its violation in finite time.
- **Fairness**, for the same reason.

The course says so openly.

### How properties reach the guardian

- **Properties** are written in a small subset of TLA+ syntax, not in a new language. They are translated into automaton and counter tables that are loaded into the guardian.
- **A declared, meaning-preserving map** connects domain variables, such as rod position or trip state, to memory addresses and marker events. The guardian only sees bits; the map is what gives them meaning.

---

## Verification approach

No NEXUS-4 component is trusted without an independent oracle:

| NEXUS-4 component | Checked against |
|---|---|
| VHDL simulator (JavaScript) | [GHDL](https://github.com/ghdl/ghdl): every course example runs in both, and they must agree delta cycle by delta cycle |
| Assembler (JavaScript) | GNU binutils for RISC-V: byte-for-byte encodings |
| RTL processor | The in-browser reference model of the instruction set, on every instruction |
| Reference model | An established RISC-V reference simulator, offline |

GHDL and binutils are used only during development. They are not part of `index.html`.

### Continuous integration (GitHub Actions)

The [differential tests workflow](.github/workflows/differential.yml) runs on every push and every pull request. It:
1. runs on `ubuntu-24.04`,
2. installs GHDL 4.1 from the Ubuntu archive,
3. runs `node tools/differential.mjs`.

Any difference fails the build, and the badge at the top of this README shows the result of the latest run.

For every example in `tests/examples/`, the workflow does three things:

1. **It runs the example through GHDL** with `--std=08 --trace-signals`. After every simulation cycle, GHDL prints every scalar signal with its value and its event flag. Composite signals appear as their scalar parts, for example `m(1)(0)` or `r.n`. This is a delta-level ground truth, which VCD waveforms are not: VCD merges the delta cycles of a time step and cannot hold arrays of vectors.
2. **It checks GHDL against the example's own expectations.** These are the `-- @expect` lines in the file header, for example `-- @expect-event: .delta_chain(rtl).c1 @ 1ns +3`. This proves the oracle behaves as calibrated in the CI environment. The trace format is a debugging format, so the tools refuse any GHDL other than 4.1.x.
3. **It loads the NEXUS-4 kernel straight out of `index.html`** (from `<script id="nexus4-kernel">`, with no build step), runs the same example, and compares the two traces cycle by cycle: values, event flags and `report` / `assert` messages. Until the kernel exists, this step is reported as skipped and only steps 1 and 2 run.

**One calibrated exception.** When a process assigns a signal the value it already has, the VHDL standard still records a transaction. Nothing in the NEXUS-4 subset can observe such a transaction, so GHDL leaves it out of its trace, including the delta cycle it would create. The kernel keeps these transactions in its own log, because the difference between a transaction and an event is part of the course. Before comparing, the tools drop them, as GHDL does. The `unreset_register` example pins this behaviour, so a change in a future GHDL would be caught.

To run the tests locally (Linux with GHDL 4.1 and Node 22):

```bash
node tools/differential.mjs                                # all examples
node tools/differential.mjs tests/examples/delta_chain.vhd # one example
node tools/oracle.mjs tests/examples/delta_chain.vhd       # GHDL's parsed trace as JSON
```

---

## Roadmap

| Phase | Content | Status |
|---|---|---|
| 0 | VHDL simulator kernel, the VHDL course, GHDL differential tests | In development: console skeleton, oracle tooling and CI in place |
| 1 | Assembler and assembly Help, multi-cycle RV32I core, reference model of the instruction set | Planned |
| 2 | PLANT and ORBIT fault-tolerance profiles, fault-injection drills | Planned |
| 3 | The guardian, lenses in the order above | Planned |
| 4 (optional) | 5-stage in-order pipeline as a refinement of the multi-cycle core: same ISA, same tests, equivalence as the goal | Optional |

Each phase is meant to be complete and usable on its own.

---

## Standards awareness

NEXUS-4 is shaped by the following documents. It claims compliance with none of them.

| Document | Relevance |
|---|---|
| IEEE 1076 (VHDL) | The language. NEXUS-4 implements a documented subset |
| RISC-V Unprivileged ISA specification | The instruction set of the core |
| IEC 62566 | HDL-programmed devices in nuclear I&C performing category A functions. It treats microprocessors as outside its scope and stresses simplicity and determinism; this is why the guardian, not the processor, carries the safety role in the PLANT profile |
| ECSS-E-ST-20-40C, ECSS-Q-ST-60-03C | Space engineering and product assurance for ASIC, FPGA and IP cores (ORBIT profile) |

---

## Project structure

```text
index.html                          the whole application: HTML, CSS and JavaScript in one file
                                    (the simulator kernel is in <script id="nexus4-kernel">)
tests/examples/*.vhd                example designs; each header names its top entity, stop time and expectations
tools/oracle.mjs                    runs GHDL and parses its delta-level trace
tools/kernel-runner.mjs             loads the kernel straight out of index.html into Node
tools/differential.mjs              checks GHDL against the expectations and compares it with the kernel
.github/workflows/differential.yml  runs the differential tests on every push and pull request
LICENSE                             MIT License
README.md                           this file
```

Screenshots for this README will go in `docs/` once there is something worth showing.

## Quick start

1. Download `index.html`.
2. Open it in a current browser (Chrome, Edge, Firefox or Safari).

Nothing needs to be installed or built, and no server is needed. Google Fonts are loaded from a CDN; without them the browser uses system fonts. At this stage the console shows the overview, the course plan, the verification approach, the roadmap and About.

---

## Author

**Grigorios Agathangelidis** — software engineer and author of the NEXUS book series on Domain-Driven Design and formal methods ([Leanpub](https://leanpub.com/u/grigorios-kyriakos-agathangelidis)).

## Acknowledgements

- [GHDL](https://github.com/ghdl/ghdl), used as the reference simulator during development.
- GNU binutils for RISC-V, used as the reference assembler during development.
- The RISC-V specifications published by RISC-V International.

NEXUS-4 is an independent project. It is not affiliated with, endorsed by or connected to RISC-V International, any processor vendor, any nuclear operator or regulator, or any space agency. RISC-V is a trademark of RISC-V International.

## License

Released under the [MIT License](LICENSE). Copyright © 2026 Grigorios Agathangelidis.
