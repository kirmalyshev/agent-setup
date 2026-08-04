# Red Team Integration Guide

## Decomposition and constraint classification

Two techniques do the heavy lifting before and after the parallel assault. Both
are stated here in full, so this skill has no dependency on any other.

### Deconstruct — before Phase 1

Break the argument down to what is actually load-bearing:

1. State the claim in one sentence, in the author's own terms.
2. List every component the claim rests on: a fact, a mechanism, a number, an
   actor, a timeline.
3. For each component, ask whether it is **established** (independently
   verifiable) or **asserted** (stated and taken on trust).
4. Note the gap between the stated argument and the actual one. An argument
   usually depends on more than it says out loud, and the unstated parts are
   where it breaks.

The asserted components become the atomic claims the parallel agents attack.

### Challenge — before the counter-argument

Classify every constraint the argument treats as fixed:

| Class | Meaning | Attackable? |
|---|---|---|
| **HARD** | Physics, arithmetic, the law, a signed contract | No |
| **SOFT** | Policy, convention, a budget, a deadline someone chose | Yes — ask who chose it and what changes if they unchoose it |
| **ASSUMPTION** | Unvalidated, often unnoticed, frequently inherited | Prime target |

The most devastating critique is almost always a "constraint" treated as HARD
that is really SOFT. Look for those first.

## Output Format

- **Format:** Steelman + Counter-argument, each with 8 numbered points
- **Length:** 12-16 words per point (strict discipline)
- **Tone:** Direct, substantive, non-performative
- **Must Include:** Constraint classification, convergence identification
- **Must Avoid:** Nitpicking, strawmanning, generic objections
