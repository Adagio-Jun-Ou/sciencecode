# Enterprise readiness

ScienceCode 0.3 is a hardened local developer/research preview, not an
enterprise commercial GA release.

## Implemented local controls

- Standalone pinned engine and isolated ScienceCode state boundary
- Prompt and preregistration secret preflight
- Credential redaction for captured engine events and logs
- Prompt digests omitted from manifests; optional hash-only request storage
- Exclusive creation for immutable artifacts
- SHA-256 project snapshots with traversal-safe verification
- Sequenced hash-chained audit events with head consistency checks
- Run/preregistration artifact verification and a project-wide local CI gate
- Cross-platform destructive-command guardrails
- Real bundled-engine config tests and Windows/macOS/Linux CI definition
- Exact runtime dependencies and npm lockfile

## What these controls do not provide

- The local audit chain is not externally signed, KMS-backed, or immutable
  against an administrator who can rewrite all files.
- Agent shell permissions are not a kernel/VM/container sandbox.
- Isolated local provider auth is not enterprise SSO, RBAC, or service-account
  management.
- A pinned npm dependency is not a signed or reproducible release by itself.
- Secret-pattern matching is not a complete data-loss-prevention system.
- Scientific agent instructions do not guarantee factual or statistical
  correctness.

## Required before commercial GA

Commercial release still requires signed/reproducible packages, SBOM and
provenance attestations, supported installers, clean CI evidence across
platforms, model/provider compatibility policy, SSO/RBAC at a service boundary,
central immutable audit export, KMS-backed secrets, tenancy isolation,
retention/legal-hold controls, observability/SLOs, load/failure testing,
external security assessment, privacy/compliance documentation, and a supported
upgrade/rollback policy.

ScienceCode must not claim SOC 2, HIPAA, GxP, FedRAMP, ISO 27001, or similar
certification merely because local technical controls exist.

