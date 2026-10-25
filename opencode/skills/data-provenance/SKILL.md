---
name: data-provenance
description: Use when acquiring, transforming, joining, versioning, hashing, documenting, or auditing research data and derived artifacts.
---
# Data-provenance protocol

Preserve source data unchanged and record its origin, stable identifier or URL,
license/consent constraints, retrieval time, release/version, checksum, schema,
units, and known corrections. Never silently replace a source release.

Represent each derived artifact as a lineage step with input hashes, code and
version, parameters, environment, timestamp, row/column effects, exclusions,
and output hash. Make joins, recoding, unit conversions, deduplication,
imputation, and de-identification explicit and testable.

Keep direct identifiers and regulated data out of prompts and logs. Apply the
minimum necessary access and retention. A hash proves byte identity, not
validity, consent, or scientific fitness.

