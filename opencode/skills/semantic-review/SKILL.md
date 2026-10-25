---
name: semantic-review
description: Use when reviewing manuscripts, citations, reported calculations, linked data, code, or figures for consistency with immutable ScienceCode records.
---
# Semantic consistency review

Review only an immutable manuscript artifact or saved revision. Create the
record with:

    sciencecode review run ARTIFACT_URL --chat CHAT_ID

or:

    sciencecode review run --revision REVISION_ID --chat CHAT_ID

Verify the resulting review before using it:

    sciencecode review verify REVIEW_ID

The deterministic pass resolves ScienceCode evidence IDs, exact spans, pages,
and ingested DOI metadata; checks literal numbers and explicit calculation
directives; and verifies manifest-bound data, code, and figure links. It does
not prove entailment, statistical validity, or visual/code agreement.

For load-bearing findings, delegate the immutable review ID to the
semantic-reviewer. That critic must inspect exact evidence and artifacts,
recalculate important values, and keep proposed manuscript changes separate as
immutable revisions. Never rewrite an archived source or substitute a rejected
revision.
