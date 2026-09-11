---
name: code-review
description: Review pull requests for the Life Manager project with a focus on correctness, regressions, data consistency, security, and MVP scope.
---

# Life Manager Code Review

Review changes as an experienced software engineer while keeping the current MVP scope in mind.

## Review priorities

Prioritize findings in this order:

1. Correctness and real bugs
2. Data consistency and data loss risks
3. Security issues
4. Build, runtime, and TypeScript errors
5. Regressions in existing functionality
6. Next.js / React server-client boundary issues
7. Accessibility issues that materially affect usability
8. Maintainability issues that are likely to cause real problems

## Project context

- Stack: Next.js App Router, React, TypeScript, Tailwind CSS.
- Follow `requirements.md` and relevant files in `specs/`.
- Existing behavior defined in specifications should not be changed accidentally.
- The project is currently an MVP.
- Do not request features that are explicitly out of scope.
- PostgreSQL, authentication, and other future features should only be required when they are part of the reviewed feature's scope.
- Prefer small, targeted fixes over unrelated refactoring.

## Finding severity

### High
Use for issues that can cause:
- broken functionality
- data loss or corruption
- security vulnerabilities
- major incorrect behavior
- build or runtime failures

### Medium
Use for:
- realistic edge-case bugs
- stale or inconsistent data
- meaningful regressions
- incorrect state handling
- important accessibility problems

### Low
Use for:
- minor maintainability improvements
- small UX inconsistencies
- documentation mismatches
- naming or clarity improvements

Do not present stylistic preferences as correctness problems.

## Avoid overengineering

Do not require:
- unnecessary abstractions
- unrelated refactoring
- premature optimization
- new dependencies without a clear need
- architecture intended only for hypothetical future requirements
- features outside the current MVP scope

If something is only a suggestion or future improvement, clearly label it as optional rather than blocking the pull request.

## Specifications

When a relevant specification exists in `specs/`:

- compare the implementation against it
- report contradictions or missing required behavior
- do not invent requirements that are not in the specification
- flag outdated documentation when implementation and specification disagree

## Review output

For each finding:

- state the severity: High, Medium, or Low
- identify the affected file/code
- explain the concrete problem
- explain when or how the problem can occur
- suggest the smallest reasonable fix

If the pull request has no meaningful correctness, security, regression, or MVP-relevant issues, say that it is ready to merge instead of inventing additional findings.
