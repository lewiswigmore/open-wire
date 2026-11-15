---
name: repository-versioning
description: Use when deciding whether a fix or change needs a release version bump, choosing a release version, or updating package versions in OpenWire.
---

# Repository versioning

1. Determine whether the change requires a release version bump. Keep the current
   version for changes that do not require a release, or when the user explicitly
   defers the bump.
2. For every required bump, increment the minor component and reset patch to zero:
   `X.Y.Z` becomes `X.(Y+1).0`, including fixes and changes while major is zero.
   For example, `0.6.3` becomes `0.7.0`.
   Increment major only when the user explicitly instructs a major version upgrade;
   then use `(X+1).0.0`. Scope, breaking changes, conventional SemVer expectations,
   or a massive capability alone are not authorization for a major bump.
3. Keep `package.json`'s version aligned with both the top-level version and
   `packages[""].version` in `package-lock.json`. Prefer
   `npm version minor --no-git-tag-version` (or `major` when explicitly authorized),
   then review the diff for unrelated changes.

Complete when the selected version follows this policy and all three package
version fields agree. If the bump is deferred, report that explicitly.
Any release tag must match the package version; tagging and publishing require
separate user authorization.
