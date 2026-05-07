# Build Performance (Local)

The default `[profile.release]` in `src-tauri/Cargo.toml` is tuned for distribution: `lto = true`, `codegen-units = 1`, `opt-level = "s"`, `strip = true`. That is correct for shipped binaries, but a clean local `tauri build` is slower than it needs to be during iteration.

For local iteration, use the `release-fast` profile and `sccache`.

## `release-fast` Profile

Defined in `src-tauri/Cargo.toml`:

```toml
[profile.release-fast]
inherits = "release"
codegen-units = 16
lto = "thin"
opt-level = 2
strip = "debuginfo"
incremental = true
```

Run via:

```bash
bun run tauri:build:fast
```

This wraps:

```bash
tauri build --bundles dmg --config '{"bundle":{"createUpdaterArtifacts":false}}' -- --profile release-fast
```

- `--bundles dmg` still produces the `.app` as an intermediate in `src-tauri/target/release-fast/bundle/macos/Jean.app`.
- `--config '{...}'` disables updater artifacts so local builds do not require release-signing setup.
- Everything after `--` is forwarded to Cargo because Tauri does not expose `--profile` directly.

Tradeoff: the resulting binary is larger and less optimized than `[profile.release]`. Use it for local testing only. CI and release scripts should keep using the default release profile.

## `sccache`

`sccache` caches rustc output across cleans, branch switches, and dependency rebuilds. It helps most on the second and later builds.

### Install

```bash
# macOS
brew install sccache

# Linux
cargo install sccache --locked
```

### Configure

Create `src-tauri/.cargo/config.toml`:

```toml
[build]
rustc-wrapper = "/opt/homebrew/bin/sccache"
```

Use `which sccache` to find the correct path on your machine.

`src-tauri/.cargo/` is gitignored because the path is developer-specific.

### Verify

```bash
sccache --show-stats
```

After a build, confirm that cache hits are non-zero.

## Why Not `mold`/`sold`?

`mold` does not support macOS targets. `sold` can work, but the default linker on recent Xcode versions is already fast enough that it is not the biggest bottleneck for this codebase.

## Single-Architecture macOS Builds

`bun run tauri:build:macos` uses `--target universal-apple-darwin`, which builds both arm64 and x86_64 binaries. For local testing on Apple Silicon, `bun run tauri:build:fast` is usually the better default because it builds only for the host architecture.
