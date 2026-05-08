# Release System

This document explains how the automated release system works and how to use it.

## Overview

The release system provides:

- **Automated GitHub Actions workflow** for building releases
- **Version management script** for updating all version files
- **Auto-updater support** for seamless user updates
- **Cross-platform builds** for macOS, Linux, and Windows

## Initial Setup

### 1. Generate Signing Keys

Generate a keypair for signing update artifacts when setting up a production release channel or fork:

```bash
# Generate keypair with the project Tauri CLI
bun run tauri signer generate -w ~/.tauri/jean.key

# This outputs:
# Private key: (saved to ~/.tauri/jean.key)
# Public key: dW50cnVzdGVkIGNvbW1lbnQ6...
```

### 2. Configure GitHub Repository

Add these secrets and variables to your GitHub repository (Settings → Secrets and variables → Actions):

- `TAURI_PRIVATE_KEY`: Content of `~/.tauri/jean.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Password you set (if any)
- `TAURI_UPDATER_PUBLIC_KEY`: Repository variable containing the public key for forked/non-default updater channels
- Apple signing secrets (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`) when signed/notarized macOS artifacts are required

### 3. Update Configuration Files

**Update `src-tauri/tauri.conf.json` for your release channel:**

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/coollabsio/jean/releases/latest/download/latest.json"
      ],
      "dialog": true,
      "pubkey": "YOUR_PUBLIC_KEY_FROM_STEP_1"
    }
  }
}
```

The checked-in workflow patches `version`, updater endpoint, updater artifact generation, and optional updater public key at build time. Forked repositories should set `TAURI_UPDATER_PUBLIC_KEY`; otherwise the workflow warns and keeps the checked-in public key.

**Review GitHub workflow in `.github/workflows/release.yml`:**

- Confirm matrix targets match the platforms you intend to publish
- Confirm signing secrets exist for the artifacts you expect to ship
- Confirm release upload behavior for AppImage and `latest.json`

**Update bundle info in `tauri.conf.json`:**

- Change `publisher`, `shortDescription`, `longDescription`
- Update `productName` and `identifier`

## Release Process

### Simple Method

1. **Prepare release:**

   ```bash
   bun run release:prepare v1.0.0
   ```

2. **Script will:**
   - Check git status is clean
   - Run all quality checks (`bun run check:all`)
   - Update versions in `package.json`, `Cargo.toml`, `tauri.conf.json`
   - Ask if you want to commit and push automatically

3. **Create or publish the GitHub release:**
   - Use the prepared version as the release tag, for example `v1.0.0`
   - Publishing a release triggers the release workflow
   - `workflow_dispatch` can also create a draft release for the supplied version

4. **GitHub Actions will:**
   - Build the app for all platforms
   - Generate `latest.json` when updater signing is configured
   - Upload installers, signatures, and patched AppImage updater artifacts

### Manual Method

If you prefer more control:

```bash
# 1. Update versions manually in:
#    - package.json
#    - src-tauri/Cargo.toml
#    - src-tauri/tauri.conf.json

# 2. Run checks
bun run check:all

# 3. Commit and tag
git add .
git commit -m "chore: release v1.0.0"
git tag v1.0.0
git push origin main --tags

# 4. Create or publish the GitHub release for v1.0.0
```

## Auto-Updater

The auto-updater provides:

- **Automatic update checks** 5 seconds after app launch
- **Jean-owned update UX** through `UpdateAvailableModal`, title-bar pending state, and toast actions
- **Background downloads** with progress tracking
- **Seamless installation** with restart prompts
- **Silent error handling** for network issues

### How It Works

1. App waits 5 seconds after launch
2. Silently checks for updates using `@tauri-apps/plugin-updater`
3. If update available, stores the update object and opens `UpdateAvailableModal`
4. User can install immediately or defer into the title-bar pending update indicator
5. Downloads and installs with toast progress
6. Shows a restart toast action that uses `@tauri-apps/plugin-process`

### Implementation

The auto-updater is implemented in `src/App.tsx`:

```typescript
import { check } from '@tauri-apps/plugin-updater'
import { useUIStore } from '@/store/ui-store'

// Inside useEffect:
const checkForUpdates = async () => {
  try {
    const update = await check()
    if (update) {
      pendingUpdateRef.current = update
      useUIStore.getState().setUpdateModalVersion(update.version)
    }
  } catch (error) {
    // Silent fail - don't bother user with network issues
    logger.error('Update check failed:', error)
  }
}
```

### Configuration

The updater is configured in `tauri.conf.json`:

- **Active**: `true` to enable update checks
- **Dialog**: currently `true` in Tauri config, while Jean's frontend owns the visible update modal/toast flow. Keep this aligned when changing updater behavior.
- **Endpoints**: GitHub releases URL for the active release channel
- **Public Key**: updater signing public key for the active release channel

## File Structure

```
.github/workflows/
  release.yml              # GitHub Actions workflow

scripts/
  prepare-release.js       # Version management script

src-tauri/
  tauri.conf.json         # Bundle and updater configuration

package.json              # Release scripts
```

## Release Artifacts

Each release creates:

- **macOS**: `.dmg` installer
- **Windows**: `.msi` installer (when configured)
- **Linux**: `.deb`, `.rpm`, and AppImage artifacts. AppImage is also rebuilt through `scripts/build-appimage.sh` to apply the WebKitGTK compatibility wrapper.
- **Auto-updater**: `latest.json` manifest and `.sig` signature files

## Troubleshooting

**Release workflow doesn't trigger:**

- Ensure tag starts with `v` (e.g., `v1.0.0`)
- Check that tag was pushed: `git push origin --tags`

**Build fails:**

- Verify GitHub secrets are set correctly
- Ensure all tests pass locally: `bun run check:all`

**Auto-updater issues:**

- Check that public key matches the private key used for signing
- Verify endpoint URL matches your GitHub repository
- Check console logs in the app for error details

## Version Strategy

We use semantic versioning (`v1.0.0`):

- **Major** (1.x.x): Breaking changes
- **Minor** (x.1.x): New features, backwards compatible
- **Patch** (x.x.1): Bug fixes, backwards compatible

All three files must have matching versions:

- `package.json` → `"version": "1.0.0"`
- `src-tauri/Cargo.toml` → `version = "1.0.0"`
- `src-tauri/tauri.conf.json` → `"version": "1.0.0"`

The prepare-release script handles this automatically.
