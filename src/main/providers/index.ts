import type { ProviderAccount, ProviderBalance, ProviderCountry, ProviderGenerateOptions, ProviderId } from '@shared/cloud'
import type { ProxyConfig } from '@shared/types'
import { gonzoproxy } from './gonzoproxy'
import { twocaptcha } from './twocaptcha'
import { proxycheap } from './proxycheap'

// A proxy an adapter hands back; name and tags override the defaults.
export type ProviderProxy = ProxyConfig & { name?: string; tags?: string[] }

export interface ProviderAdapter {
  id: ProviderId
  name: string
  // Fields the user fills in when connecting the account.
  fields: Array<{ key: string; label: string; secret?: boolean; hint?: string; optional?: boolean }>
  balance(acc: ProviderAccount): Promise<ProviderBalance>
  countries(acc: ProviderAccount): Promise<ProviderCountry[]>
  generate(acc: ProviderAccount, opts: ProviderGenerateOptions): Promise<ProviderProxy[]>
  canGenerate: boolean
  // 'generate' builds gateway logins on demand; 'import' lists proxies the
  // account already bought (all matches; the caller applies the count).
  mode?: 'generate' | 'import'
  // Import providers that can also build logins on a rotating gateway plan
  // (opts.pool = 'rotating').
  rotatingPool?: boolean
}

export const providers: Record<ProviderId, ProviderAdapter> = { gonzoproxy, '2captcha': twocaptcha, proxycheap }

export function providerMeta(): Array<Pick<ProviderAdapter, 'id' | 'name' | 'fields' | 'canGenerate'> & { mode: 'generate' | 'import'; rotatingPool: boolean }> {
  return Object.values(providers).map((p) => ({ id: p.id, name: p.name, fields: p.fields, canGenerate: p.canGenerate, mode: p.mode || 'generate', rotatingPool: !!p.rotatingPool }))
}
