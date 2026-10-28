// electron-builder hook. There is no Apple Developer ID yet, so the macOS
// bundle gets an ad-hoc signature: Apple Silicon refuses to start unsigned
// binaries at all, while ad-hoc signed ones run after the user clears the
// quarantine flag (documented on the download page).
const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async (context) => {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
