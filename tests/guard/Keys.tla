-------------------------------- MODULE Keys --------------------------------
(***************************************************************************)
(* A trapped-key interlock for a valve lineup, as a Petri net (D19, D62).  *)
(* Two operators each need both keys, A and B, for one job. Operator 1     *)
(* takes A, then B; operator 2 takes B, then A. If each holds one key,     *)
(* neither can go on: a dead marking, which the guardian reports after 40  *)
(* cycles. When both have done their job and the keys are back, nothing is *)
(* enabled either, but that marking is Final. Operator 2 works days only  *)
(* (an automaton): at night his transitions are not enabled, and if        *)
(* nothing else is, that is a dead marking too.                            *)
(***************************************************************************)
EXTENDS NexusGuard

VARIABLES valve,                       \* mapped: the lineup's valve, 0 closed, 1 open
          keyA, keyB,                  \* places: the keys in their rack
          idle1, hasA1, hasAB1,        \* places: operator 1 (waiting, holds A, holds both)
          idle2, hasB2, hasAB2,        \* places: operator 2 (waiting, holds B, holds both)
          shift                        \* an automaton: "day" or "night"

Map    == [valve |-> "valve"]
Events == [Take1A |-> 10, Take1B |-> 11, Done1 |-> 12,
           Take2B |-> 20, Take2A |-> 21, Done2 |-> 22, CopyA |-> 30,
           Night |-> 40, Day |-> 41]

Init == /\ keyA = 1 /\ keyB = 1
        /\ idle1 = 1 /\ hasA1 = 0 /\ hasAB1 = 0
        /\ idle2 = 1 /\ hasB2 = 0 /\ hasAB2 = 0
        /\ shift = "day"

\* The valve is 0 or 1; each place is bounded (one key of each, one operator).
Valve   == valve >= 0 /\ valve <= 1
Bounded == /\ keyA <= 1 /\ keyB <= 1
           /\ idle1 <= 1 /\ hasA1 <= 1 /\ hasAB1 <= 1
           /\ idle2 <= 1 /\ hasB2 <= 1 /\ hasAB2 <= 1

\* Both operators done (gone) and both keys back in the rack.
Final == idle1 = 0 /\ idle2 = 0 /\ hasAB1 = 0 /\ hasAB2 = 0 /\ keyA = 1 /\ keyB = 1

NoDeadlock == DeadlockFree(40)

Take1A == /\ idle1 >= 1 /\ keyA >= 1
          /\ idle1' = idle1 - 1 /\ keyA' = keyA - 1 /\ hasA1' = hasA1 + 1
          /\ UNCHANGED <<keyB, hasAB1, idle2, hasB2, hasAB2>>
          /\ UNCHANGED shift
Take1B == /\ hasA1 >= 1 /\ keyB >= 1
          /\ hasA1' = hasA1 - 1 /\ keyB' = keyB - 1 /\ hasAB1' = hasAB1 + 1
          /\ UNCHANGED <<keyA, idle1, idle2, hasB2, hasAB2>>
          /\ UNCHANGED shift
Done1  == /\ hasAB1 >= 1
          /\ hasAB1' = hasAB1 - 1 /\ keyA' = keyA + 1 /\ keyB' = keyB + 1
          /\ UNCHANGED <<idle1, hasA1, idle2, hasB2, hasAB2>>
          /\ UNCHANGED shift
Take2B == /\ idle2 >= 1 /\ keyB >= 1
          /\ idle2' = idle2 - 1 /\ keyB' = keyB - 1 /\ hasB2' = hasB2 + 1
          /\ UNCHANGED <<keyA, idle1, hasA1, hasAB1, hasAB2>>
          /\ shift = "day" /\ UNCHANGED shift
Take2A == /\ hasB2 >= 1 /\ keyA >= 1
          /\ hasB2' = hasB2 - 1 /\ keyA' = keyA - 1 /\ hasAB2' = hasAB2 + 1
          /\ UNCHANGED <<keyB, idle1, hasA1, hasAB1, idle2>>
          /\ UNCHANGED shift
Done2  == /\ hasAB2 >= 1
          /\ hasAB2' = hasAB2 - 1 /\ keyA' = keyA + 1 /\ keyB' = keyB + 1
          /\ UNCHANGED <<idle1, hasA1, hasAB1, idle2, hasB2>>
          /\ UNCHANGED shift
\* A copied key: operator 1, still waiting, copies key A in the rack, and the
\* rack holds two (the capacity catches it).
CopyA  == idle1 >= 1 /\ keyA >= 1 /\ keyA' = keyA + 1
          /\ UNCHANGED <<keyB, idle1, hasA1, hasAB1, idle2, hasB2, hasAB2>>
          /\ UNCHANGED shift
\* The shift changes; no tokens move.
Night  == shift' = "night" /\ UNCHANGED <<keyA, keyB, idle1, hasA1, hasAB1, idle2, hasB2, hasAB2>>
Day    == shift' = "day" /\ UNCHANGED <<keyA, keyB, idle1, hasA1, hasAB1, idle2, hasB2, hasAB2>>
=============================================================================
