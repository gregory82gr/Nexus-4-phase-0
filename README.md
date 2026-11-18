# NEXUS-4 — Critical-Systems Processor & VHDL Workbench

**A single-file VHDL course, a time-predictable RISC-V processor for critical systems, and a hardware guardian that checks formal properties while the processor runs.**

[![License: MIT](https://img.shields.io/badge/License-MIT-22d3ee.svg)](LICENSE)
![Single file](https://img.shields.io/badge/build-none%20%C2%B7%20one%20HTML%20file-3ddc84)
![Simulation only](https://img.shields.io/badge/scope-simulation%20only-ffb000)
![Status](https://img.shields.io/badge/status-phase%200%20in%20development-a78bfa)
[![Differential tests](https://github.com/gregory82gr/Nexus-4-phase-0/actions/workflows/differential.yml/badge.svg)](https://github.com/gregory82gr/Nexus-4-phase-0/actions/workflows/differential.yml)

> **Status: work in progress.** This repository is in Phase 0. What exists today:
> - the console (`index.html`: overview, simulator, course plan, verification, roadmap, About),
> - the **simulator workbench**, live: a VHDL editor, waveforms and a delta-cycle inspector running on the kernel in the browser (see [The simulator workbench](#the-simulator-workbench-live)),
> - the **simulator kernel v0.3** (hierarchy, packages and subprograms; see [Kernel status](#kernel-status)), which agrees with GHDL delta cycle by delta cycle on all 20 examples,
> - the GHDL oracle tooling, its examples, and mutation checks that prove the tests can fail,
> - the GitHub Actions workflow that runs all of it on every push.
>
> The course chapters come next; they will be built on the workbench. This README also describes the design that has been decided; a feature exists only when the [roadmap](#roadmap) marks it as available.

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

### The simulator workbench (live)

![The workbench: waveforms in delta-cycle view and the inspector at 1 ns, delta +1](docs/workbench-delta-cycles.png)

The **Simulator** page runs the kernel in the browser. Pick one of the examples, or write your own design, and run it:
- **Editor.** Syntax highlighting and line numbers; `Ctrl+Enter` runs. A VHDL error, a run-time error or a construct the kernel does not support yet is reported with its line, and the line is marked.
- **Waveforms.** Two views of the same run. *Delta cycles* gives every simulation cycle its own column, so a zero-delay chain shows as a staircase at one point in time. *Time* is the usual waveform view, where the delta cycles of a time step collapse and only a small `×n` mark says they were there. Vectors are shown as buses (binary, hex or decimal; signed values in decimal) and expand into their scalar parts. A transaction that is not an event is marked with a dot, and a transaction GHDL leaves out (see [the calibrated exception](#continuous-integration-github-actions)) with a hollow dot.
- **Delta-cycle inspector.** For every cycle, the three phases of the simulation cycle: which drivers were updated (events, and transactions without events), which processes woke up and why, and what they did (the assignments they scheduled, with the time each value is due, and their messages). A short note explains the cycle in software terms.

The examples in the workbench are copies of `tests/examples/*.vhd`, embedded in `index.html` by `tools/embed-examples.mjs`, and CI fails if the copies differ from the files. So an unedited example in the workbench is exactly the file that CI has compared with GHDL; the page says so, and says "edited · not verified" as soon as you change it. A run stops after 5,000 cycles.

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
3. checks that the examples embedded in `index.html` are the current files (`node tools/embed-examples.mjs --check`),
4. runs `node tools/differential.mjs`,
5. runs `node tools/mutations.mjs`.

Any difference fails the build, and the badge at the top of this README shows the result of the latest run.

For every example in `tests/examples/`, the workflow does three things:

1. **It runs the example through GHDL** with `--std=08 --trace-signals`. After every simulation cycle, GHDL prints every scalar signal with its value and its event flag. Composite signals appear as their scalar parts, for example `m(1)(0)` or `r.n`. This is a delta-level ground truth, which VCD waveforms are not: VCD merges the delta cycles of a time step and cannot hold arrays of vectors.
2. **It checks GHDL against the example's own expectations.** These are the `-- @expect` lines in the file header, for example `-- @expect-event: .delta_chain(rtl).c1 @ 1ns +3`. This proves the oracle behaves as calibrated in the CI environment. The trace format is a debugging format, so the tools refuse any GHDL other than 4.1.x.
3. **It loads the NEXUS-4 kernel straight out of `index.html`** (from `<script id="nexus4-kernel">`, with no build step), runs the same example, and compares the two traces cycle by cycle. It compares:
   - cycle labels,
   - values,
   - active and event flags,
   - every message: `report` and `assert` messages, and also the warnings of the `ieee` library, such as `NUMERIC_STD."<": metavalue detected, returning FALSE`.

   Messages are compared as a set per time step, because the language does not fix the order in which processes run within one delta cycle.

The kernel grows construct by construct:
- **Pending.** An example that uses a construct the kernel does not support yet makes the kernel throw an error with the code `NEXUS4_UNSUPPORTED`, and the example is reported as **pending** rather than failed.
- **Required.** An example whose header says `-- @kernel: required` may never be pending. Once an example passes, it is marked required, so it cannot silently fall back.

**One calibrated exception.** Consider an inertial assignment that meets all of these conditions:
- it has a single zero-delay element,
- it gives a signal the value its driver already has,
- the driver has nothing else pending.

The VHDL standard still records a transaction for it, but nothing in the NEXUS-4 subset can observe that transaction, so GHDL leaves it out of its trace, including the delta cycle it would create. A delay, `transport`, a second waveform element or a pending transaction all make GHDL keep it. The kernel keeps these transactions and tags them, because the difference between a transaction and an event is part of the course. The comparison leaves out exactly the tagged ones. The `transaction_elision` and `unreset_register` examples pin this behaviour, so a change in a future GHDL would be caught.

**One known GHDL defect.** GHDL 4.1's trace sometimes leaves out the signals declared inside an `if ... generate` that has more than one alternative (`else` or `elsif`). Whether it does depends on the alternative chosen and on whether the condition is a constant or a generic, and `--disp-tree` crashes with "GHDL Bug occurred" on such designs. The kernel simulates these signals like any other and marks them *optional*: the comparison checks them whenever GHDL shows them and does not count them missing when it does not. Their effects on the signals outside the generate are always compared. The `fault_profiles` example exercises this.

**Mutation checks.** A test suite that cannot fail proves nothing. `tools/mutations.mjs` breaks the kernel in 28 specific ways, and the differential tests must fail on every broken copy. The breakages cover:
- **the simulation cycle:**
  - inertial delay behaving like transport,
  - a wrong resolution function,
  - `rising_edge` ignoring the previous value,
  - a frozen delta counter,
  - immediate signal assignment,
  - a `failure` that does not stop the run,
  - no wake-up on events,
  - an ignored `wait until` condition,
  - missing transaction tagging;
- **composite values and `numeric_std`:**
  - a number instead of `'X'` for metavalues,
  - signed compared as unsigned,
  - missing metavalue warnings,
  - `to_hstring` without `To_X01`,
  - reversed concatenation,
  - swapped `to` / `downto`,
  - `case` ignoring its choices,
  - `exit` behaving like `next`,
  - zero instead of sign extension;
- **hierarchy and subprograms:**
  - instance paths without the entity name,
  - port drivers that start from the actual's value instead of the port's,
  - the for-generate index missing from names,
  - procedure waits that ignore signal parameters,
  - out variable parameters not copied back,
  - local bounds taken from the argument not set,
  - inverted string comparison (used by generics),
  - overloads resolved to the first declaration,
  - default parameter values ignored,
  - a selected assignment driving the wrong target.

Two of them survived their first run and exposed real gaps:
- `rising_edge` on a clock coming from `'X'` or `'Z'`, now covered by `edge_detection.vhd`;
- signed comparisons with negative numbers, now covered by `numeric_std_traps.vhd`.

The workflow runs these checks after the differential tests.

To run the tests locally (Linux with GHDL 4.1 and Node 22):

```bash
node tools/differential.mjs                                # all examples
node tools/differential.mjs tests/examples/delta_chain.vhd # one example
node tools/oracle.mjs tests/examples/delta_chain.vhd       # GHDL's parsed trace as JSON
node tools/mutations.mjs                                   # the tests must catch a broken kernel
node tools/embed-examples.mjs                              # after changing an example: copy it into index.html
```

### Kernel status

| Version | Stage | Supported |
|---|---|---|
| 0.1.0 | Scalar signals | `std_logic` / `std_ulogic`, `boolean`, `integer` and its subtypes, `time`. Signals, variables and constants. Processes with sensitivity lists, `process(all)` or `wait` (on / until / for). Concurrent and conditional signal assignments. Waveforms with `after`, `transport` and inertial delay. Resolution of multiple drivers. `if`, `null`, `report`, `assert` (severity `failure` stops the run). `rising_edge`, `falling_edge`, `now`, `'event`, `'last_value`, `'image`, `to_string` |
| 0.2.0 | Composite types and `numeric_std` | User enumeration, integer, array and record types and subtypes. `std_logic_vector`, `std_ulogic_vector`, `unsigned`, `signed`. Composite signals split into scalar leaves, exactly as GHDL shows them. Indexing (also with a dynamic index), slices, record fields, as sources and as targets. Positional, named and record aggregates, string and bit-string literals, concatenation. Logical operators and reductions on vectors. `numeric_std`: `+`, `-`, comparisons, `to_integer`, `to_unsigned`, `to_signed`, `resize`, `shift_left`, `shift_right`, with the library's behaviour and warnings on `'U'` / `'X'`. `to_hstring`, `to_ostring`, `'length`, `'range`, `'left`, `'right`, `'high`, `'low`, `'pos`, `'val`. `case` (with full-coverage checking), `for`, `while` and plain loops with `exit` / `next` and labels |
| 0.3.0 – 0.3.1 | Hierarchy and subprograms | Several design units in one file. Entity instantiation (`entity work.x`) and component declaration plus instantiation. Generics with defaults, positional and named port and generic maps, `open` outputs, default and constant inputs. A port connected to a signal is the same signal under a second name, so both change in the same delta cycle (as GHDL shows). Instance paths exactly as GHDL names them (`.top(arch).u1@cell(rtl).a`). `for ... generate` and `if ... generate` with `elsif` / `else`, with local signals. `with ... select`. Packages and package bodies in `work`, with constants, types and subprograms. Functions and procedures: overloading, named association, default values, locals whose bounds come from the argument (`v'range`), `return`. Procedures with `signal` and `variable` parameters of mode in, out and inout that may `wait`. Object aliases. String comparison. The checks a compiler would make: a pure function may not read signals, a function may not wait, an input port may not be assigned. Recursion is not supported yet. 0.3.1 adds, for the workbench, a description of the design (signals with their scalar parts, processes with their lines) and an optional cycle limit; the simulation itself is unchanged |

**Speed (measured at v0.2):** about 20,000 rising clock edges per second for a 32-bit counter writing a 32 × 32 register file (1,057 signal bits), with snapshots and the event log turned off. Snapshots of every bit after every cycle are only taken for the tests.

Next: the course chapters, written on top of the workbench.

## Roadmap

| Phase | Content | Status |
|---|---|---|
| 0 | VHDL simulator kernel and workbench, the VHDL course, GHDL differential tests | In development: kernel v0.3 (hierarchy, packages, functions and procedures, `generate`), the simulator workbench (live), oracle tooling, mutation checks and CI in place; the course chapters are next |
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
tools/mutations.mjs                 breaks the kernel on purpose; every broken copy must fail the tests
tools/embed-examples.mjs            copies tests/examples into index.html for the workbench (--check: CI)
docs/                               screenshots for this README
.github/workflows/differential.yml  runs the differential tests on every push and pull request
LICENSE                             MIT License
README.md                           this file
```

## Quick start

1. Download `index.html`.
2. Open it in a current browser (Chrome, Edge, Firefox or Safari).

Nothing needs to be installed or built, and no server is needed. Google Fonts are loaded from a CDN; without them the browser uses system fonts. At this stage the console shows the overview, the simulator workbench, the course plan, the verification approach, the roadmap and About.

---

## Author

**Grigorios Agathangelidis** — electrical and software engineer and author of the NEXUS book series on Domain-Driven Design and formal methods ([Leanpub](https://leanpub.com/u/grigorios-kyriakos-agathangelidis)).

## Acknowledgements

- [GHDL](https://github.com/ghdl/ghdl), used as the reference simulator during development.
- GNU binutils for RISC-V, used as the reference assembler during development.
- The RISC-V specifications published by RISC-V International.

NEXUS-4 is an independent project. It is not affiliated with, endorsed by or connected to RISC-V International, any processor vendor, any nuclear operator or regulator, or any space agency. RISC-V is a trademark of RISC-V International.

## License

Released under the [MIT License](LICENSE). Copyright © 2026 Grigorios Agathangelidis.
