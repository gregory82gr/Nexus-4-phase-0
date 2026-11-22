----------------------------- MODULE NexusGuard -----------------------------
(***************************************************************************)
(* The NEXUS-4 guardian's library for property modules (D61).              *)
(*                                                                         *)
(* A property module EXTENDS this one. It declares the program's mapped    *)
(* variables (Map: a name for a word of .data, D21), its events (Events: a *)
(* name for an nx.mark number, D58), the guardian's own state (automaton   *)
(* variables holding strings, deadline variables holding a start time),    *)
(* Init for that state, one action per event, and its properties:          *)
(* conjunctions of linear comparisons of the mapped variables, and         *)
(* deadlines written Within(t, n), and a Petri net (places, capacities,    *)
(* Final, DeadlockFree(n)), and idempotent regions (RegionBegin,          *)
(* RegionEnd, IdempotentRegions). The page translates the module into the  *)
(* guardian's table; TLC checks traces of the core against the module      *)
(* itself (tools/tla-check.mjs).                                           *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

VARIABLE now                  \* the clock: cycles of the core

None == -1                    \* a deadline that is not running

\* An event starts a deadline: it runs from now, unless it is running already
\* (then it keeps its start, as the guardian's counter does).
Start(t) == t' = IF t = None THEN now ELSE t

\* An event stops a deadline.
Stop(t) == t' = None

\* Bounded liveness as a safety property (Lamport, "Real Time is Really
\* Simple"): a running deadline has run for at most n cycles.
Within(t, n) == t # None => now - t <= n

\* A Petri net (D62) is written with place variables (a natural number of
\* tokens each) and actions that test them (p >= k) and move tokens
\* (p' = p - k, p' = p + k). The guardian also watches for a dead marking:
\* no transition enabled and the marking not Final. deadAt is the cycle the
\* marking became dead, or None; whoever checks a trace keeps it (the
\* hardware does, and so does the trace module of tools/tla-check.mjs).
VARIABLE deadAt

\* A dead marking lasts at most n cycles.
DeadlockFree(n) == deadAt # None => now - deadAt <= n

\* Idempotent regions (D63, after de Kruijf, Sankaralingam and Jha, PLDI
\* 2012): a region of the program that may run again from its start, as an
\* ORBIT warm restart runs the program again, with the same effect. It is
\* idempotent when it writes no word of the data scratchpad that it read
\* before writing it (an exposed read): no clobber antidependence. Two
\* events open and close a region; whoever checks a trace applies ReadWord
\* and WriteWord to every load and store of the data scratchpad. The
\* guardian remembers IdemWords exposed reads and IdemWords writes; a
\* region that needs more is too large to check, and that is a violation
\* too, so that the check never misses anything.
VARIABLES region,             \* TRUE inside a region
          exposed,            \* the words read there before any write to them
          written             \* the words written there

IdemWords == 8

RegionBegin == region' = TRUE /\ exposed' = {} /\ written' = {}
RegionEnd   == region' = FALSE /\ exposed' = {} /\ written' = {}

ReadWord(a)  == /\ exposed' = IF region /\ a \notin written THEN exposed \cup {a} ELSE exposed
                /\ UNCHANGED <<region, written>>
WriteWord(a) == /\ written' = IF region THEN written \cup {a} ELSE written
                /\ UNCHANGED <<region, exposed>>

NoClobber  == exposed \cap written = {}
RegionFits == Cardinality(exposed) <= IdemWords /\ Cardinality(written) <= IdemWords

IdempotentRegions == NoClobber /\ RegionFits
=============================================================================
