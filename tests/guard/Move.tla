--------------------------------- MODULE Move --------------------------------
(***************************************************************************)
(* Hoare contracts (D19, D64) for move(steps), a function that moves the   *)
(* rods: {0 <= steps <= 5 /\ rods + steps <= 40} move(steps)               *)
(* {rods = old rods + steps /\ result = rods}. Its entry marker carries    *)
(* the argument (nx.mark a0, 60) and its exit marker the result            *)
(* (nx.mark a0, 61). No call may begin inside another (an automaton).      *)
(***************************************************************************)
EXTENDS NexusGuard

VARIABLES pos,                \* mapped: the rods
          call,               \* an automaton: "out" or "in" a call
          arg, old            \* ghosts: the argument, and the rods at entry

Map    == [pos |-> "rods"]
Events == [MoveIn |-> 60, MoveOut |-> 61]

Init == call = "out" /\ arg = 0 /\ old = 0

Range == pos >= 0 /\ pos <= 40

\* The precondition, and the ghosts the postcondition will need.
MoveIn  == /\ call = "out" /\ call' = "in"
           /\ Mark >= 0 /\ Mark <= 5
           /\ pos + Mark <= 40
           /\ arg' = Mark /\ old' = pos

\* The postcondition: the rods moved by exactly the argument, and the
\* function returned where they are now.
MoveOut == /\ call = "in" /\ call' = "out"
           /\ pos - old - arg = 0
           /\ Mark - pos = 0
           /\ UNCHANGED <<arg, old>>
=============================================================================
