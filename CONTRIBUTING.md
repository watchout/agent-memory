# Contributing to wasurezu (agent-memory)

Thanks for your interest in contributing. This document outlines how to report bugs, suggest features, and submit code changes.

## Code of Conduct

Be kind. Assume good intent. Review code, not people.

## Reporting Bugs

1. Check [existing issues](https://github.com/watchout/agent-memory/issues) first
2. If new, open an issue using the **Bug Report** template
3. Include:
   - wasurezu version (`wasurezu --version`)
   - Node.js version (`node --version`)
   - OS and architecture
   - DB backend (SQLite / PostgreSQL)
   - Minimal reproduction steps
   - Expected vs actual behavior

## Suggesting Features

1. Open an issue using the **Feature Request** template
2. Describe the problem you're solving (not just the solution)
3. Note whether this fits the core (OSS) or cloud (paid) scope

Core features are always free. Paid features live in the Cloud tier.

## Development Setup

```bash
# Clone
git clone https://github.com/watchout/agent-memory.git
cd agent-memory

# Install
npm install

# Run tests (SQLite - default)
npm test

# Run tests (PostgreSQL - requires running instance)
AGENT_MEMORY_DATABASE_URL=postgresql://localhost/agent_memory_test npm run test:pg

# Run in dev mode
npm run dev

# Build
npm run build
```

### Requirements

- Node.js 18+
- Optional: PostgreSQL 14+ with pgvector (for PG backend testing)

## Pull Request Process

1. **Fork** the repository and create a feature branch from `main`
2. Branch naming:
   - `feat/<short-description>` for new features
   - `fix/<short-description>` for bug fixes
   - `refactor/<short-description>` for refactoring
   - `docs/<short-description>` for documentation
3. Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: add sqlite store`
   - `fix: handle null recovery_quality_score`
   - `docs: update README with demo gif`
4. Write tests for new functionality. PRs without tests may be delayed.
5. Ensure all tests pass: `npm test`
6. Ensure the build succeeds: `npm run build`
7. Update `CHANGELOG.md` under the `[Unreleased]` section
8. Open a PR with a clear description
9. Link related issues

### PR Review

- PRs require review from a maintainer before merge
- Be responsive to feedback; we aim for a fast iteration cycle
- We squash-merge most PRs to keep history linear

## Code Style

- **TypeScript ESM** throughout
- **Max 400 lines per file** as a rule of thumb, 800 is the hard cap
- **No emojis in code/comments/docs** (except user-facing messages if appropriate)
- **Immutable**: don't mutate objects/arrays in place
- **Zod** for runtime validation
- **Try/catch** for error handling; surface errors clearly
- **No comments that repeat the code** — comment the *why*, not the *what*

## Architecture Principles

- **Store abstraction**: DB backends implement `Store` interface (`src/stores/types.ts`). New backends should fit this interface.
- **MCP tools**: defined in `src/index.ts`. Keep tool responses small and structured.
- **Recovery quality**: every recovery operation must call `logRecoveryQuality` so we can measure degradation.
- **Multi-agent by default**: all tables have `agent_id` column. Never hardcode `'default'`.
- **Independence from agent-comms**: wasurezu must work standalone. Integration with agent-comms is optional enhancement.

## Security

- **Never commit secrets** (DATABASE_URL, API keys). Use `.env` (gitignored).
- **Parameterized queries only**. No string concatenation into SQL.
- **Validate all inputs** with Zod at the MCP tool boundary.
- Report security vulnerabilities privately to [security@iyasaka.co](mailto:security@iyasaka.co).

## Release Process

Releases are cut by maintainers:

1. Update `version` in `package.json`
2. Update `CHANGELOG.md` (move `[Unreleased]` to new version section)
3. Commit: `chore: release vX.Y.Z`
4. Tag: `git tag vX.Y.Z`
5. Push: `git push && git push --tags`
6. Publish: `npm publish` (scoped to maintainers)

Alpha versions use `0.1.0-alpha.N` format. Betas use `0.1.0-beta.N`. Stable uses semver `X.Y.Z`.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

See [LICENSE](./LICENSE).

## Questions

- Open a [GitHub Discussion](https://github.com/watchout/agent-memory/discussions) (once enabled)
- Or open an issue tagged `question`

Thanks for contributing to wasurezu.
