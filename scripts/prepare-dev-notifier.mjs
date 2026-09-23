import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform === 'darwin') {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const bundle = join(root, 'src-tauri/target/debug/bundle/macos/OneMail Dev.app')
  const executable = join(bundle, 'Contents/MacOS/onemail')
  const stamp = join(root, 'src-tauri/target/debug/.onemail-dev-notifier-v1')
  const sources = [
    'src-tauri/src/main.rs',
    'src-tauri/src/lib.rs',
    'src-tauri/src/commands/system.rs',
    'src-tauri/Cargo.toml',
    'src-tauri/tauri.dev.conf.json',
    'scripts/prepare-dev-notifier.mjs',
    ...readdirSync(join(root, 'src-tauri/icons/notification-providers'))
      .map((name) => `src-tauri/icons/notification-providers/${name}`)
  ]
  const stale = !existsSync(executable) || !existsSync(stamp) ||
    sources.some((source) => statSync(join(root, source)).mtimeMs > statSync(stamp).mtimeMs)

  if (stale) {
    execFileSync('pnpm', ['exec', 'tauri', 'build', '--debug', '--config', 'src-tauri/tauri.dev.conf.json', '--bundles', 'app'], { cwd: root, stdio: 'inherit' })
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' })
    mkdirSync(dirname(stamp), { recursive: true })
    writeFileSync(stamp, '')
  }
  execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', bundle], { stdio: 'inherit' })
}
