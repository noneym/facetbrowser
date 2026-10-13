import type { ProviderAccount, ProviderBalance, ProviderCountry, ProviderGenerateOptions, ProviderId } from '@shared/cloud'
import type { ProxyConfig } from '@shared/types'
import { gonzoproxy } from './gonzoproxy'
import { twocaptcha } from './twocaptcha'

export interface ProviderAdapter {
  id: ProviderId
  name: string
  // Fields the user fills in when connecting the account.
  fields: Array<{ key: string; label: string; secret?: boolean; hint?: string; optional?: boolean }>
  balance(acc: ProviderAccount): Promise<ProviderBalance>
  countries(acc: ProviderAccount): Promise<ProviderCountry[]>
  generate(acc: ProviderAccount, opts: ProviderGenerateOptions): Promise<ProxyConfig[]>
  canGenerate: boolean
}

export const providers: Record<ProviderId, ProviderAdapter> = { gonzoproxy, '2captcha': twocaptcha }

export function providerMeta(): Array<Pick<ProviderAdapter, 'id' | 'name' | 'fields' | 'canGenerate'>> {
  return Object.values(providers).map((p) => ({ id: p.id, name: p.name, fields: p.fields, canGenerate: p.canGenerate }))
}
