# Releasing

## Adding changesets

1. Add a changeset. This will prompt you for additional information.

   ```bash
   yarn changeset add
   ```

2. Commit the changeset as part of your PR.

   ```bash
   git add .changeset/
   git commit -m 'Add changeset for my changes'
   ```

## Releasing new package versions

1. Merge the `platformos-tools Release — YYYY-MM-DD` PR

2. Done!

## Upgrading projects that depend on this

This section is intended for internal folks.

### pos-cli

1. Upgrade deps and commit

   ```sh
   git fetch origin main
   git checkout origin/main
   branch="bump-platformos-tools-$(date -u '+%Y-%m-%d')"
   git checkout -b $branch
   # Update dependencies as needed based on the packages that were released
   git add .
   git commit -m 'Bump Platform-OS/platformos-tools packages'
   git push origin $branch
   ```

2. Make your PR

## Release Orchestrator FAQ
### What does this project do?
This does the following tasks:
- compiles all the changeset that live in the `.changeset` folder
- patch bumps all packages where a mono-repo dependency has been bumped
- update the package versions accordingly and generates the changelog
- commits the changes (after user confirmation)
- creates a release PR

### What is the point of the release orchestrator?
This project exists to streamline the release process so that it is consistent and reliable every time it's run. We believe that the release process should be as much of a "one click solution" as possible and this helps us achieve that.

### Why does the release orchestrator enforce starting on the `main` branch with no existing repo changes?
Removes the risk of accidentally sneaking expected changes into a release without proper vetting through normal PR practices.

### Why does the release orchestrator create a new release branch during its process?
This establishes a convention for our release branch names. Additionally this enables us to build CI workflows targeting this branch name pattern to ensure that the release process can be as streamlined as possible while minimizing the window for error.

### Is the release orchestrator a publically available package?
No, while this package sits within the `packages/` directory of the `platformos-tools` repo, this package is intended to be a purely internal tool. We put it within this directory to leverage our existing tsconfig patterns without needing to add additional configuration solely for an internal tool.

### What is the point of composing a release pipeline with flow?
The use of pure functions to compose a release pipeline here helps make sure that we can develop this complex flow in a simple and maintainable way. Each step of the pipeline can be enabled or disabled to do isolated tophatting. Additionally because each step is written as pure functions, this helps make unit testing easier.

### Does this release strategy violate semantic versioning(semver)?
We can understand how some might think that but we disagree. In semantic versioning, when a package releases a minor update, all packages that depend on it should update their dependency range to include the new version, but they do not bump their own version unless they have changes of their own.

By that ommission, one might think we should not update these internal dependencies. Our counter point to this is that there's no other way for these internal dependencies packages to get access to potentially important changes upstream.

#### Consider the example:

A package in the monorepo depends on `@platformos/platformos-common` for shared utilities.
We add important changes to `@platformos/platformos-common` with no breaking changes. This would be a minor version bump.

If we don't patch bump the dependent packages, they would not get the updates until we end up modifying them for unrelated reasons. We split out common functionality into separate packages for reusability, but when used by a dependent package, we consider it as part of that package's functionality.

Our takeaway from this real usecase is that it is necessary to apply these patch version bumps in order to deliver updates consistently to end developers who depend on them.

### Why don't just you use `@changesets/cli`'s `updateInternalDependencies` config option to manage patch version bumps?
For context, this refers to [the library's documented config option](https://github.com/changesets/changesets/blob/main/docs/config-file-options.md#updateinternaldependencies).

At the time of writing this doc; the end of that documentation states: `this is only applied for packages which are already released in the current release. If A depends on B and we only release B then A won't be bumped.`

This affects an important case for us: Nested monorepo dependencies relying on each other. For packages with nested dependency chains within the platformos-tools repo.

Please note we [already have `@changesets/cli` configured with `updateinternaldependencies: patch`](../.changeset/config.json) for its ability to patch bump internal dependencies once they are already in the release.

When we perform a release where there is an update to the minor version of a core package, but no update to packages that depend on it, then `changesets version` (the main command we use to apply a version bump) will not automatically bump those dependent packages. This could result in outdated logic running. The `release-orchestrator` package enables us to automatically resolve any nested internal dependencies within the monorepo so that we don't need to worry about it.

Should `@changesets/cli` ever consider changing `updateinternaldependencies: patch`to apply to all packages outside of the current release, we may scrap this package.
