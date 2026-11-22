-------------------------------- MODULE Rods --------------------------------
(***************************************************************************)
(* The guardian's properties for the rod-control programs of tests/guard,  *)
(* in the NEXUS-4 subset of TLA+ (D20, D61).                               *)
(***************************************************************************)
EXTENDS NexusGuard

VARIABLES pos, cmd, trip,     \* mapped: words of .data
          mode,               \* an automaton
          scramAt             \* a deadline

\* The meaning-preserving map (D21): each variable is the word at a label of .data.
Map == [pos |-> "rods", cmd |-> "command", trip |-> "tripped"]

\* The events: the number each nx.mark carries.
Events == [Withdraw |-> 1, Insert |-> 2, Scram |-> 3, RodsIn |-> 4, Reset |-> 5]

Init == mode = "run" /\ scramAt = None

\* The rods stay in range, the command never runs more than 5 steps from the
\* rods, and the trip flag is 0 or 1.
Safety == /\ pos <= 40
          /\ pos >= 0
          /\ cmd - pos <= 5
          /\ pos - cmd <= 5
          /\ trip <= 1

\* After a scram, the rods are reported in within 90 cycles.
RodsInOnTime == Within(scramAt, 90)

\* No withdrawal after a scram until a reset.
Withdraw == mode = "run" /\ UNCHANGED <<mode, scramAt>>
Insert   == UNCHANGED <<mode, scramAt>>
Scram    == mode' = "scrammed" /\ Start(scramAt)
RodsIn   == UNCHANGED mode /\ Stop(scramAt)
Reset    == mode' = "run" /\ UNCHANGED scramAt
=============================================================================
