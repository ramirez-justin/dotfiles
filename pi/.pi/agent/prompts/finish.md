---
description: >-
  Use Superpowers verification-before-completion before declaring work done
argument-hint: "[what to verify]"
---
Use the `verification-before-completion` skill. Do not say this is complete
until the relevant checks have actually run and passed. Apply the direct/formal
scope in `AGENTS.md` and the local `executing-plans` skill. For direct low-risk
work, verify inline without automatic agent dispatch. For formal, nontrivial,
or risky code, config, or workflow-control changes, launch `verifier` for
independent read-only validation before claiming completion. Preserve all
applicable workflow and required verification gates.

`/finish` requests verification, not automatically a formal implementation
plan; it does not downgrade required, requested, or started workflows or review
gates.

$ARGUMENTS
