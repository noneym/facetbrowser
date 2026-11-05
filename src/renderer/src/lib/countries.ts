import { useI18n } from './i18n'

// ISO 3166-1 alpha-2 codes for gateway providers that target any country.
const CODES = 'AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FO FR GA GB GD GE GF GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP KE KG KH KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MO MQ MR MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NZ OM PA PE PF PG PH PK PL PR PS PT PY QA RE RO RS RU RW SA SC SD SE SG SI SK SL SM SN SO SR SS SV SY SZ TC TD TG TH TJ TL TM TN TO TR TT TW TZ UA UG US UY UZ VC VE VG VI VN VU WS XK YE YT ZA ZM ZW'.split(' ')

export function allCountries(): Array<{ code: string; name: string }> {
  const lang = useI18n.getState().lang
  let names: Intl.DisplayNames | null = null
  try { names = new Intl.DisplayNames([lang === 'tr' ? 'tr' : 'en'], { type: 'region' }) } catch { names = null }
  return CODES.map((code) => ({ code, name: names?.of(code) || code })).sort((a, b) => a.name.localeCompare(b.name, lang))
}
