# Documentation guide

## Current documentation

- [`../README.MD`](../README.MD) — development, testing, packaging, publishing, and live-test instructions.
- [`../overview.md`](../overview.md) — Azure DevOps Marketplace listing content.

## Historical design records

The [`superpowers/`](superpowers/) directory contains dated specifications and
implementation plans. These documents record how features were designed and
implemented; they are not a second user manual and their example commands or
file lists may describe an earlier revision. For current behavior, use the
root README and the source code.

### Specifications

- Feature additions: inline rename, search, and the proposed export feature.
- Security hardening and test coverage.
- UI improvements and icon rendering.
- Organization-wide count cache.
- Merge target selection.
- Branch-based publishing and sharing.
- Live-test harness, including the API and local Playwright phases.

### Implementation plans

The plans provide task-level implementation history for the features above.
Completed plans should be treated as an audit trail; unchecked task boxes do
not necessarily indicate current repository work.

## Documentation maintenance

When behavior changes, update the root README and Marketplace overview in the
same change. Update a dated specification only when correcting its historical
record; add a dated note rather than rewriting the original design.