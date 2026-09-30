# 0005: S3 artifact storage

- Status: Accepted
- Date: 2026-09-29
- Source: AGENT.md

## Context

Screenshots and traces need scalable storage and private access.

## Decision

Store binary evidence in S3-compatible storage, with metadata and keys in PostgreSQL. Local development uses MinIO.

## Consequences

Separate artifact authorization and retention from binary storage. Phase 0 provisions a private bucket; adapters arrive in Phase 5.

Local MinIO images are built from pinned upstream source releases because the published Docker Hub and Quay images are unavailable. This does not change the storage interface. The community repositories are archived, so production requires a maintained S3-compatible service. See [operations](../docs/OPERATIONS.md).

## Alternatives

Database binary storage increases database load and complicates retention.

## Verification

Local bucket initialization/private-access tests now; tenant-scoped artifact-access tests later.

## Phase 5 implementation update

The S3 adapter and tenant-authorized download API are implemented. Local setup can use existing native or remote private storage without Docker. See [ADR 0011](0011-private-evidence-lifecycle.md) for lease-fenced upload acknowledgement, bounded capture, privacy and retention limitations; the original S3 architectural decision is unchanged.
