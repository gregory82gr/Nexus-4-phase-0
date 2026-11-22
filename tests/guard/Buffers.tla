------------------------------- MODULE Buffers ------------------------------
(***************************************************************************)
(* Idempotent regions (D63): the programs of tests/guard/idem_*.s mark     *)
(* regions with two markers, and the guardian checks that no region writes *)
(* a word it read before writing it there. A region like that can be run  *)
(* again from its start, after an ORBIT warm restart, with the same effect.*)
(***************************************************************************)
EXTENDS NexusGuard

VARIABLES count               \* mapped: a counter in .data

Map    == [count |-> "count"]
Events == [IdemBegin |-> 50, IdemEnd |-> 51]

Init == TRUE

Counted == count >= 0

IdemBegin == RegionBegin
IdemEnd   == RegionEnd

Regions == IdempotentRegions
=============================================================================
