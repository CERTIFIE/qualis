# Changelog

All notable changes to Qualis are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-11-23

The packages in this release carry version `0.1.1` in their `package.json`.

### Added

- Publish the packages on npmjs as well as GitHub Packages; 0.1.1 is the
  first publication on npmjs (#6, #7).
- Contributing guide and `NOTICE` with the attribution to Qualis (#4).

### Changed

- Releases are built only from tags named `vX.Y.Z` (#7).
- Rewrite the README around the user journey and move the details to the
  documentation site (#5).
- Restructure the documentation site around the user journey (#5).
- Forks may use any name; the credit to Qualis stays (#4).

### Fixed

- Deploy GitHub Pages from its own job, also when no release is
  published (#2, #3).

## [0.1.0] - 2026-11-21

### Added

- First version of Qualis: CLI, core, plugin API and schema packages, the
  UI app, and the C#, Roslyn, ESLint and TypeScript plugins.
- Release pipeline: tests, GitHub Release, GitHub Packages and Pages (#1).

[Unreleased]: https://github.com/CERTIFIE/qualis/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/CERTIFIE/qualis/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/CERTIFIE/qualis/releases/tag/v0.1.0
