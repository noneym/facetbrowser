import type { FeaturedExtension } from './types'

// Curated Web Store picks shown on the Extensions page. IDs are the public
// Chrome Web Store ids; the app downloads the CRX straight from Google.
export const FEATURED_EXTENSIONS: FeaturedExtension[] = [
  { id: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa', name: '1Password', highlight: true, blurb: ['Şifreler ve passkey\'ler. Profilde eklenti simgesine tıklayıp hesabına bir kez giriş yap.', 'Passwords and passkeys. Click the extension icon in the profile and sign in once.'] },
  { id: 'nngceckbapebfimnlniiiahkandclblb', name: 'Bitwarden', blurb: ['Açık kaynak şifre yöneticisi, passkey destekli.', 'Open-source password manager with passkey support.'] },
  { id: 'hlkenndednhfkekhgcdicdfddnkalmdm', name: 'Cookie-Editor', blurb: ['Çerezleri görüntüle, düzenle, JSON veya Netscape olarak dışa ve içe aktar.', 'View, edit, export and import cookies as JSON or Netscape.'] },
  { id: 'ojfebgpkimhlhcblbalbfjblapadhbol', name: 'EditThisCookie (V3)', blurb: ['Klasik çerez düzenleyici; dışa aktarımı FacetBrowser\'ın çerez içe aktarımıyla uyumlu.', 'The classic cookie editor; its export matches FacetBrowser\'s cookie import.'] },
  { id: 'okpidcojinmlaakglciglbpcpajaibco', name: 'J2TEAM Cookies', blurb: ['Çerezleri şifreli dosya olarak al ve ver, hesap taşımak için.', 'Export and import cookies as an encrypted file, handy for moving accounts.'] },
  { id: 'ddkjiahejlhfcafbddmgiahcphecmpfh', name: 'uBlock Origin Lite', blurb: ['Reklam ve izleyici engelleme (Manifest V3).', 'Ad and tracker blocking (Manifest V3).'] },
  { id: 'pkehgijcmpdhfbdbbnkijodmdjhbjlgp', name: 'Privacy Badger', blurb: ['Gizli izleyicileri otomatik engeller.', 'Blocks hidden trackers automatically.'] },
  { id: 'nkbihfbeogaeaoehlefnkodbefgpgknn', name: 'MetaMask', blurb: ['Ethereum cüzdanı; her profil kendi cüzdanını tutar.', 'Ethereum wallet; each profile keeps its own wallet.'] },
  { id: 'bfnaelmomeimhlpmgjnjophhpkkoljpa', name: 'Phantom', blurb: ['Solana, Ethereum ve Bitcoin cüzdanı.', 'Solana, Ethereum and Bitcoin wallet.'] },
  { id: 'aapbdbdomjkkjkaonfhkkikfgjllcleb', name: 'Google Translate', blurb: ['Sayfaları ve seçili metni çevir.', 'Translate pages and selected text.'] },
  { id: 'dhdgffkkebhmkfjojejmpbldmpobfkfo', name: 'Tampermonkey', blurb: ['Kullanıcı betikleri (userscript) çalıştır.', 'Run userscripts.'] },
  { id: 'edacconmaakjimmfgnblocblbcdcpbko', name: 'Session Buddy', blurb: ['Sekme oturumlarını kaydet ve geri yükle.', 'Save and restore tab sessions.'] },
  { id: 'eimadpbcbfnmbkopoojfekhnkhdbieeh', name: 'Dark Reader', blurb: ['Her site için karanlık tema.', 'Dark theme for every site.'] }
]

// Only a password manager's own store may be copied between profiles (its
// sign-in), and only on explicit request. Nothing else is ever shared.
export const SHAREABLE_EXTENSION_IDS = ['aeblfdkhhhdcdjpifhhbdiojplfjncoa'] // 1Password

export const WEBSTORE_ID_RE = /^[a-p]{32}$/

// Accepts a bare id or any chromewebstore.google.com / chrome.google.com URL.
export function parseWebStoreId(input: string): string | null {
  const s = input.trim()
  if (WEBSTORE_ID_RE.test(s)) return s
  const m = s.match(/([a-p]{32})(?:[/?#]|$)/)
  return m ? m[1] : null
}
