# Security Production Guide

⚠️ **CRITICAL: Production distributors and forks must own their release identity, signing keys, and updater endpoint.**

## Overview

This guide covers the security configuration that must be reviewed before distributing Jean or a forked Jean build. The checked-in configuration is suitable for the current Jean distribution path, but forks must not reuse another distributor's updater identity or signing setup.

## Critical Security Requirements

### 1. Auto-Updater Keys (CRITICAL)

**Status**: Review for every production distributor

Jean's updater public key and endpoint live in `src-tauri/tauri.conf.json`. A fork or new production channel must generate its own updater keypair, publish its own public key, and keep the private key out of the repository. The GitHub release workflow can also patch the updater public key from the `TAURI_UPDATER_PUBLIC_KEY` repository variable.

#### Generate Proper Updater Keys

1. **Generate a new Ed25519 keypair** using the project Tauri CLI:

   ```bash
   bun run tauri signer generate -w ~/.tauri/jean.key
   ```

2. **Update your configuration**:
   - Copy the **public key** to `src-tauri/tauri.conf.json`:
     ```json
     {
       "plugins": {
         "updater": {
           "pubkey": "YOUR_PUBLIC_KEY_HERE"
         }
       }
     }
     ```
   - Store the **private key** securely for signing releases
   - **Never commit the private key to version control**

3. **Sign your releases**:
   ```bash
   bun run tauri signer sign -k ~/.tauri/jean.key -f path/to/your/app.tar.gz
   ```

#### Environment Variables (Recommended)

For CI/CD, store keys in the release environment. The GitHub workflow reads `TAURI_PRIVATE_KEY` from repository secrets and exposes it to Tauri as `TAURI_SIGNING_PRIVATE_KEY`.

```bash
# In your CI environment
export TAURI_SIGNING_PRIVATE_KEY="your-private-key-content"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="your-key-password"
```

### 2. Application Metadata

**File**: `src-tauri/tauri.conf.json`

For a forked production distribution, update all release identity values:

```json
{
  "productName": "Jean",
  "version": "1.0.0",
  "identifier": "com.yourcompany.jean",
  "bundle": {
    "publisher": "Your Company Name",
    "copyright": "Copyright © 2025 Your Company. All rights reserved."
  }
}
```

### 3. Plugin Permissions Review

**Files**: `src-tauri/capabilities/*.json`

Review and minimize permissions based on Jean's current surfaces. The repository currently uses capability files such as `default.json`, `desktop.json`, and `browser-pane.json`.

```json
{
  "permissions": [
    "core:default",
    "fs:read-file", // Only if you need file reading
    "fs:write-file", // Only if you need file writing
    "notification:default" // Only if you need notifications
    // Remove unused permissions
  ]
}
```

**Security Principle**: Grant only the minimum permissions required for your application to function.

### 4. Content Security Policy (CSP)

Jean has an explicit CSP in `src-tauri/tauri.conf.json` because the app runs in both native Tauri and browser/headless modes. Keep any CSP changes aligned with required asset, IPC, and local-server access.

**File**: `src-tauri/tauri.conf.json`

```json
{
  "security": {
    "csp": "default-src 'self' 'unsafe-inline' 'unsafe-eval' ipc: http://ipc.localhost https://ipc.localhost; img-src 'self' asset: http://asset.localhost https://asset.localhost data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'"
  }
}
```

## Production Deployment Checklist

Before deploying to production, ensure you have:

- [ ] **Generated and configured proper Ed25519 updater keys**
- [ ] **Updated all application metadata** (name, version, identifier, publisher)
- [ ] **Reviewed and minimized plugin permissions**
- [ ] **Set up proper error tracking** and logging
- [ ] **Tested the auto-updater flow** with signed releases
- [ ] **Verified CSP configuration** (if applicable)
- [ ] **Configured proper logging levels** (Info, not Debug)
- [ ] **Set up secure key storage** for CI/CD
- [ ] **Tested application on all target platforms**
- [ ] **Verified code signing certificates** for distribution

## Security Best Practices

### Input Validation

Jean should validate command inputs at the Rust boundary and avoid exposing native-only assumptions to browser/headless mode:

- Filename validation prevents directory traversal attacks
- String length limits prevent buffer overflow attempts
- Data size limits prevent resource exhaustion

### Error Handling

- Sensitive information is not exposed in error messages
- All file operations use atomic writes (write to temp, then rename)
- Failed operations are logged for security monitoring

### Logging

- Configure appropriate log levels for production (Info, not Debug)
- Ensure logs don't contain sensitive information
- Set up log rotation and retention policies

## Security Monitoring

Consider implementing:

1. **Error Tracking**: Services like Sentry or Rollbar
2. **Usage Analytics**: To detect unusual patterns
3. **Update Monitoring**: Track update success rates
4. **Crash Reporting**: To identify potential security issues

## Resources

- [Tauri Security Guide](https://tauri.app/distribute/updater/#signing-updates)
- [Ed25519 Key Generation](https://tauri.app/distribute/updater/#signing-updates)
- [Tauri Plugin Permissions](https://tauri.app/references/v2/permissions/)
- [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)

## Support

If you encounter security issues or need help with configuration:

1. Review the [Tauri documentation](https://tauri.app/)
2. Check the [Tauri Discord community](https://discord.com/invite/tauri)
3. File security issues privately via email (see SECURITY.md)

---

**Remember**: Security is not a one-time setup. Regularly review and update your security configurations as your application evolves.
