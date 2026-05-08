# AppImage Build Failure on Arch Linux

## Problem

Building Linux AppImage on Arch Linux fails with error:

```
ERROR: Strip call failed: /tmp/.mount_linuxdQq7uQo/usr/bin/strip: Jean.AppDir/usr/lib/libwebkit2gtk-4.1.so.0: unknown type [0x13] section `.relr.dyn'
```

### Root Cause

1. **Arch Linux uses `.relr.dyn` ELF sections** - Enabled via `-Wl,-z,pack-relative-relocs` since binutils 2.38
2. **linuxdeploy's embedded `strip` binary is too old** - Doesn't recognize section type 0x13 (`.relr.dyn`)
3. **Incompatibility** - linuxdeploy AppImage was built before RELR support was added

## Current Build Commands

Jean now keeps the DEB/RPM build and the AppImage compatibility build as separate package scripts:

```bash
# Builds .deb and .rpm packages
bun run tauri:build:linux

# Builds an AppImage through the WebKitGTK compatibility wrapper
bun run tauri:build:linux:appimage
```

`bun run tauri:build:linux` maps to `tauri build --bundles deb,rpm`. `bun run tauri:build:linux:appimage` runs `scripts/build-appimage.sh`, which sets `NO_STRIP`, replaces `AppRun` with `scripts/appimage-webkit-fix.sh`, repackages the AppImage, and creates updater artifacts when signing keys are available.

## Solutions

### Option 1: Use DEB/RPM Instead (Recommended for Local Arch Builds)

**DEB and RPM builds work successfully on Arch Linux:**

```bash
bun run tauri:build:linux
```

**Current package.json script:**

```json
"tauri:build:linux": "tauri build --bundles deb,rpm"
```

**Pros:**

- Works out of the box
- Standard Linux package formats
- Can be installed with the platform package manager, for example `sudo dpkg -i Jean_<version>_amd64.deb` or `sudo rpm -i Jean-<version>-1.x86_64.rpm`
- Smaller than an unstripped AppImage

**Cons:**

- Not portable (requires package manager)
- Doesn't run without installation

### Option 2: Scripted AppImage Build

Use the dedicated AppImage script:

```bash
bun run tauri:build:linux:appimage
```

The script first attempts `NO_STRIP=true bun run tauri build --bundles appimage`. If Tauri's AppImage phase fails because of the linuxdeploy strip issue, it falls back to manually running linuxdeploy with `NO_STRIP=1`. It then replaces `AppRun` with Jean's WebKitGTK compatibility wrapper and repackages the result.

**Result:** Creates `Jean_<version>_<arch>.AppImage` in `src-tauri/target/release/bundle/appimage/`. If `TAURI_SIGNING_PRIVATE_KEY` is set, it also creates `.tar.gz` and `.sig` updater artifacts.

**Pros:**

- Portable AppImage
- Works on any x86_64 Linux distribution
- Single executable
- Matches the release workflow's AppImage path

**Cons:**

- Larger file size (not stripped)
- Requires Linux and the cached Tauri linuxdeploy binaries
- Still carries the linuxdeploy/RELR workaround

### Option 3: Wait for Tauri/linuxdeploy Fix

This is a known issue:

- Tauri issue #11149: "Calling strip causes Tauri to fail building AppImage"
- linuxdeploy issue #272: "Error building Appimage after latest update"

**Status:** Currently "not planned" in Tauri issue tracker

## Current Status

### Working Solutions

✅ **DEB package** (`Jean_<version>_amd64.deb`) - built by `bun run tauri:build:linux` - **RECOMMENDED for local Arch builds**
✅ **RPM package** (`Jean-<version>-1.x86_64.rpm`) - built by `bun run tauri:build:linux`
✅ **AppImage** (`Jean_<version>_<arch>.AppImage`) - built by `bun run tauri:build:linux:appimage`

### Failed Solutions

❌ Plain `tauri build --bundles appimage` on affected hosts - Fails due to linuxdeploy stripping issue
❌ Relying only on package.json environment variables - `NO_STRIP=true` is not enough for every Tauri/linuxdeploy phase

## Notes

1. **Updater Plugin Warning:** The `__TAURI_BUNDLE_TYPE` warning is harmless - occurs because binary is already stripped by Rust's `strip = true` in Cargo.toml

2. **Signing Key Error:** DEB/RPM build may fail if `TAURI_SIGNING_PRIVATE_KEY` is not set but public key exists in tauri.conf.json

3. **AppImage size:** The AppImage is intentionally not stripped during the workaround, so it is larger than a stripped build. Exact size varies by version and architecture.

## Recommendation

**For Arch Linux local builds:** Use DEB/RPM packages for regular testing. Use `bun run tauri:build:linux:appimage` when portability or release parity is required.
