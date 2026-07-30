# Release Tagging Workflow

TimeTree releases use [Semantic Versioning](https://semver.org/) with a
`v`-prefixed Git tag, such as `v0.1.0`.

This policy is adapted from RaidGuild Accounting's
[release tagging workflow](https://github.com/raid-guild/accounting/blob/main/docs/tagging-workflow.md).

## Policy

- Release tags point only to reviewed commits on `main`.
- The version in `package.json` must match the tag without the `v` prefix.
- Release tags are annotated and treated as immutable after they are pushed.
- Tags are created intentionally for releases, not automatically for every
  merge to `main`.
- Push the exact release tag rather than using `git push --tags`, which can
  publish unrelated local tags.

Ordinary feature, fix, documentation, and maintenance branches do not increment
the version independently. Before tagging a release, use a dedicated
release-preparation branch, normally reviewed through a pull request, to:

1. choose the next version;
2. set or confirm that version in `package.json`;
3. add any required release notes or migration instructions; and
4. pass the normal review and verification gates.

This keeps the version decision aligned with the final release contents and
avoids conflicting or out-of-order version bumps across concurrent branches.
The initial `v0.1.0` release is already set in `package.json`; this workflow
branch serves as its release preparation.

While the project is on `0.x` versions:

- increment the patch version for backward-compatible fixes and documentation;
- increment the minor version for new product capabilities or breaking
  changes;
- use prerelease identifiers such as `v0.2.0-rc.1` when a release needs testing
  before it becomes final.

## Prepare a Release

1. Create a dedicated release-preparation branch from an up-to-date `main`.
2. Choose the next version and set or confirm it in `package.json`.
3. Include any release notes or migration instructions required by the change.
4. Pass the repository's normal review and verification gates.
5. Merge the reviewed release commit to `main`.
6. Fast-forward a clean local `main`:

   ```bash
   git switch main
   git pull --ff-only origin main
   ```

7. Confirm that `package.json`, `HEAD`, and the intended version agree. Also
   confirm that the tag does not already exist locally or on the remote:

   ```bash
   TAG=v0.2.0
   test "$(git branch --show-current)" = "main"
   test "$(node -p "require('./package.json').version")" = "${TAG#v}"
   test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
   test -z "$(git tag --list "$TAG")"
   test -z "$(git ls-remote --tags origin "refs/tags/$TAG")"
   ```

   Each command exits nonzero when a release precondition is not satisfied.

## Create and Verify the Tag

Create an annotated tag on the reviewed `main` commit:

```bash
TAG=v0.2.0
git tag -a "$TAG" -m "Release $TAG"
```

Verify both the annotation and its target before publishing:

```bash
TAG=v0.2.0
test "$(git cat-file -t "$TAG")" = "tag"
git show --no-patch --decorate "$TAG"
git rev-list -n 1 "$TAG"
git rev-parse HEAD
```

The object-type assertion confirms that the tag is annotated. The final two
commands must return the same commit.

## Publish

Push `main` first, followed by the exact tag:

```bash
TAG=v0.2.0
git push origin main
git push origin "refs/tags/$TAG"
```

After the tag is visible on GitHub, create a GitHub Release from that tag when
human-readable release notes or packaged artifacts are useful.

## Correcting Mistakes

If an incorrect tag has not been pushed, delete it locally and create it again:

```bash
TAG=v0.2.0
git tag -d "$TAG"
```

Do not silently move or force-push a published release tag. If released code
needs a correction, make a new reviewed commit and publish the next patch
version. If exceptional circumstances require removing a published tag,
coordinate the change with the team and document why.
