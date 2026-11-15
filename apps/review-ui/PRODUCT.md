# Review workspace

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers using OpenMembrane who need to understand what needs attention,
review proposed memories, and maintain saved project knowledge.

## Product Purpose

Make memory review understandable without requiring knowledge of the storage
model. Start with an overview, make review decisions explicit, and keep
technical investigation available without making it the main workflow.

## Operating Context

A loopback web interface for one project, backed by the authenticated local
daemon. Local Private and GitHub Team modes retain their existing behavior.

## Capabilities and Constraints

Preserve memory search, editing and superseding, individual and bulk candidate
review, older-memory review, graph exploration and relationship editing,
activity history, diagnostics, and static-export preview and write.
Secret candidates cannot be approved. Exporting confidential memories requires
explicit opt-in. Do not equate team publication with an active merged memory.
Do not introduce external assets, analytics, or provider calls.

## Brand Commitments

Retain the OpenMembrane name. Use familiar developer-tool conventions and
plain-language explanations rather than exposing internal enum names.

## Product Principles

- Show what needs attention before technical detail.
- Explain the consequence of a review action before it is taken.
- Distinguish loading, unavailable data, and an empty queue.
- Preserve access to existing capabilities.
