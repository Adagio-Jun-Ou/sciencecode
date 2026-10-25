---
name: procedure-development
description: Use to draft, translate, validate, or review laboratory, analytical, computational, XDL, or Opentrons procedures.
---
# Procedure development

Create a ScienceCode Procedure Studio record with:

- objective, domain, context of use, immutable evidence IDs, and explicit
  supersession instead of in-place edits;
- materials, identifiers, units, equipment, software, calibration, and setup;
- dependency-linked steps with parameters, expected observations, acceptance
  criteria, deviation actions, hazards, and outputs;
- positive and negative controls, blanks, replicates, sample tracking, data
  capture, and predefined acceptance criteria;
- a protocol-specific hazard register using controls above PPE where necessary,
  training, emergency response, stop conditions, waste, ethics, biosafety, and
  authorization requirements;
- the mandatory policy external_human_control_only.

Use templates/procedure.json as a starting point. Link source material through
ScienceCode evidence, write the edited JSON outside .sciencecode, then use:

- sciencecode procedure create SPEC.json;
- sciencecode procedure assess PROCEDURE_ID;
- sciencecode procedure verify PROCEDURE_ID;
- sciencecode procedure assessment verify ASSESSMENT_ID.

The assessment is a deterministic structural dry-run, not a physical or
facility simulation. XDL 2.0 and Opentrons results are non-executable mapping
previews until independently bound to exact hardware, labware or graph,
capacity limits, vendor software, and simulator output.

Never fabricate or enter a human decision. A named reviewer must use Procedure
Studio or sciencecode procedure decide, explicitly attest to the limited
scope, and add an expiry for external physical-execution scope. ScienceCode
does not verify identity or authority and never enables hardware. Any newer
assessment or superseding plan makes an earlier approval ineffective.
