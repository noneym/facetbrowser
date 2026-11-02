// electron-builder afterPack hook for macOS.
// With a Developer ID certificate (CSC_LINK set) electron-builder signs and
// notarizes the app itself after this hook, so we do nothing. Without one
// (forks, local builds) we ad-hoc sign: an unsigned binary is reported as
// "damaged" on Apple Silicon, an ad-hoc signature turns that into the normal
// "unidentified developer" prompt (right-click > Open).
const { execFileSync } = require('child_process')
const path = require('path')

exports.default = async (context) => {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    console.log('  Developer ID certificate present, electron-builder signs and notarizes')
    return
  }
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`  no certificate: ad-hoc signing ${app}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
