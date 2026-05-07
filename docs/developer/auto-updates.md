# Auto-Update System

Automatic update checking and installation system using Tauri's updater plugin, integrated with GitHub releases and user-friendly dialogs.

## Quick Start

### Current Behavior

- Checks for updates 5 seconds after app launch
- Shows `UpdateAvailableModal` when update metadata is available
- Lets the user install now or defer into the title-bar pending update indicator
- Downloads and installs with toast progress
- Offers a restart toast action when installation completes
- Fails silently if network issues occur

### Manual Update Check

Users can manually check for updates via:

- **Menu**: App → Check for Updates

## Architecture

### Update Flow

```
App Launch
    ↓ (5 second delay)
Check GitHub for Updates
    ↓ (if update available)
Show UpdateAvailableModal
    ↓ (if user chooses Update Now or title-bar pending update)
Download & Install Update
    ↓ (when complete)
Show Restart Toast Action
    ↓ (if user accepts)
Restart Application
```

### Components

1. **Auto-checker**: Runs 5 seconds after app launch
2. **Manual checker**: Triggered by the native app menu
3. **Progress tracking**: Logs download progress
4. **User dialogs**: `UpdateAvailableModal` and toast actions
5. **Restart handler**: Uses `@tauri-apps/plugin-process`

## Implementation

### App.tsx Integration

```typescript
// src/App.tsx
import { check } from '@tauri-apps/plugin-updater'
import { logger } from '@/lib/logger'
import { toast } from 'sonner'
import { useUIStore } from '@/store/ui-store'

export function App() {
  const pendingUpdateRef = useRef<any>(null)

  const installAppUpdate = useCallback(async (update) => {
    const toastId = toast.loading(`Downloading update ${update.version}...`)
    useUIStore.getState().setPendingUpdateVersion(null)
    pendingUpdateRef.current = null

    await update.downloadAndInstall((event) => {
      if (event.event === 'Finished') {
        toast.loading('Installing update...', { id: toastId })
      }
    })

    toast.success(`Update ${update.version} installed!`, {
      id: toastId,
      duration: Infinity,
      action: {
        label: 'Restart',
        onClick: async () => {
          const { relaunch } = await import('@tauri-apps/plugin-process')
          await relaunch()
        },
      },
    })
  }, [])

  useEffect(() => {
    const checkForUpdates = async () => {
      if (!isNativeApp()) return
      if (useUIStore.getState().pendingUpdateVersion) return

      try {
        logger.info('Checking for updates...')
        const update = await check()

        if (update) {
          logger.info(`Update available: ${update.version}`)
          pendingUpdateRef.current = update
          useUIStore.getState().setUpdateModalVersion(update.version)
        }
      } catch (error) {
        logger.error('Update check failed:', error)
        // Fail silently - don't bother user with network issues
      }
    }

    // Check for updates 5 seconds after app starts
    const timer = setTimeout(checkForUpdates, 5000)
    const handleInstallPending = () => {
      if (pendingUpdateRef.current) installAppUpdate(pendingUpdateRef.current)
    }
    window.addEventListener('install-pending-update', handleInstallPending)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('install-pending-update', handleInstallPending)
    }
  }, [installAppUpdate])

  return <MainWindow />
}
```

### Manual Update Check

```typescript
// src/hooks/useMainWindowEventListeners.ts
import { listen } from '@/lib/transport'

listen('menu-check-updates', async () => {
  logger.debug('Check for updates menu event received')
  try {
    const update = await check()
    if (update) {
      window.dispatchEvent(
        new CustomEvent('update-available', { detail: update })
      )
      useUIStore.getState().setUpdateModalVersion(update.version)
    } else {
      commandContext.showToast('You are running the latest version', 'success')
    }
  } catch (error) {
    logger.error('Update check failed:', { error: String(error) })
    commandContext.showToast('Failed to check for updates', 'error')
  }
})
```

## Configuration

### Tauri Configuration

```json
// src-tauri/tauri.conf.json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/YOUR_USERNAME/YOUR_REPO/releases/latest/download/latest.json"
      ],
      "dialog": false,
      "pubkey": "YOUR_PUBLIC_KEY_HERE"
    }
  }
}
```

**Key Settings:**

- `active: true`: Enables the updater system
- `endpoints`: GitHub releases URL (template format)
- `dialog: false`: Jean uses `UpdateAvailableModal` and toast actions instead of Tauri's built-in dialogs
- `pubkey`: Public key for signature verification (set during release setup)

### GitHub Releases Integration

The updater checks GitHub releases for:

1. **latest.json**: Update manifest file
2. **Signed installers**: Platform-specific installation files
3. **Signature files**: `.sig` files for verification

Example `latest.json`:

```json
{
  "version": "1.0.1",
  "notes": "Bug fixes and performance improvements",
  "pub_date": "2024-01-15T10:00:00Z",
  "platforms": {
    "darwin-x86_64": {
      "signature": "signature_string",
      "url": "https://github.com/user/repo/releases/download/v1.0.1/app-x86_64.app.tar.gz"
    },
    "darwin-aarch64": {
      "signature": "signature_string",
      "url": "https://github.com/user/repo/releases/download/v1.0.1/app-aarch64.app.tar.gz"
    }
  }
}
```

## Release Integration

### Automatic Generation

The GitHub Actions workflow automatically:

1. Builds signed installers for all platforms
2. Generates `latest.json` manifest
3. Creates GitHub release with all artifacts
4. Publishes release (manual step)

### Manual Release Process

1. Run `bun run release:prepare v1.0.1`
2. Push tags to trigger GitHub Actions
3. Wait for build to complete
4. Manually publish the draft release on GitHub

## User Experience

### Automatic Updates

- **Non-intrusive**: 5-second delay after app launch
- **User choice**: Always asks permission before downloading
- **Progress feedback**: Toast progress during download/install
- **Graceful failure**: Network errors don't bother the user

### Manual Updates

- **Accessible**: Available via the native app menu
- **Immediate feedback**: Shows toast notifications for results
- **Consistent**: Uses same update flow as automatic checks

### Dialog Messages

**Update Available:**

```
Version 1.0.1 is ready to install.
```

**Update Complete:**

```
Update 1.0.1 installed!
Restart
```

**No Updates (Manual Check):**

```
You are running the latest version
```

## Security

### Signature Verification

All updates are cryptographically signed:

1. **Key generation**: `tauri signer generate -w ~/.tauri/myapp.key`
2. **Build signing**: GitHub Actions uses private key to sign releases
3. **Verification**: App uses public key to verify download integrity
4. **Automatic rejection**: Invalid signatures are automatically rejected

### Network Security

- **HTTPS only**: All update checks use HTTPS
- **GitHub infrastructure**: Relies on GitHub's security and availability
- **Graceful degradation**: Network failures don't crash the app

## Development vs Production

### Development

- **Logging**: Detailed update logs in browser console
- **Manual testing**: Can test update flow with local builds
- **Debug mode**: Additional logging and error details

### Production

- **Silent failures**: Network errors don't show user dialogs
- **Minimal logging**: Only essential update events logged
- **User-focused**: Clear modal and toast notifications

## Troubleshooting

### Updates Not Detected

1. **Check endpoint URL**: Verify GitHub repository URL in `tauri.conf.json`
2. **Verify public key**: Ensure public key matches signing key
3. **Check release format**: Ensure GitHub release follows expected structure
4. **Network connectivity**: Test manual update check

### Download Failures

1. **Check signatures**: Verify release was signed correctly
2. **File permissions**: Ensure app has write permissions for updates
3. **Disk space**: Verify sufficient space for download and installation
4. **Network stability**: Check for connection interruptions

### Installation Issues

1. **App permissions**: Verify app can modify itself
2. **Running instances**: Close all app instances before installation
3. **Antivirus software**: Check if antivirus is blocking installation
4. **System updates**: Ensure system is compatible with new version

## Future Enhancements

### Possible Improvements

- **Background downloads**: Download updates silently, install on restart
- **Rollback capability**: Ability to revert to previous version
- **Update channels**: Support for beta/stable release channels

### Advanced Configuration

```json
// Future: More sophisticated updater config
{
  "updater": {
    "active": true,
    "dialog": false,
    "endpoints": ["https://api.example.com/updates"],
    "installMode": "passive",
    "allowDowngrade": false,
    "checkInterval": 3600000
  }
}
```

The auto-update system provides seamless, secure updates while maintaining user control and graceful error handling.
