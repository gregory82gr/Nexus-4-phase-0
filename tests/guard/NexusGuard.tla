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
(* Final, DeadlockFree(n)). The page translates the module into the        *)
(* guardian's table; TLC checks traces of the core against the module      *)
(* itself (tools/tla-check.mjs).                                           *)
(***************************************************************************)
EXTENDS Integers

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
=============================================================================
