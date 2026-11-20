import { describe, expect, it } from 'vitest'
import { DEFAULT_EXCLUSIONS, exclusionList, isDomainName } from './exclusions'
import { isExcludedDomain, isSensitiveField, stripUrl } from './rules'

describe('stripUrl', () => {
  it('drops the query and the fragment', () => {
    expect(stripUrl('https://example.com/a/b?token=abc#x')).toBe('https://example.com/a/b')
    expect(stripUrl('https://example.com/a?x=1')).toBe('https://example.com/a')
    expect(stripUrl('https://example.com/a#section')).toBe('https://example.com/a')
  })

  it('drops the credentials of the URL', () => {
    expect(stripUrl('https://user:pw@example.com/a')).toBe('https://example.com/a')
    expect(stripUrl('https://token@example.com/a')).toBe('https://example.com/a')
  })

  it('keeps the port, lowercases the host and keeps the case of the path', () => {
    expect(stripUrl('http://localhost:3000/App?x=1')).toBe('http://localhost:3000/App')
    expect(stripUrl('https://EXAMPLE.com/Path')).toBe('https://example.com/Path')
  })

  it('gives the same reference whatever the query', () => {
    expect(stripUrl('https://example.com/a?id=1')).toBe(stripUrl('https://example.com/a?id=2'))
  })

  it('keeps a bare origin as a root path', () => {
    expect(stripUrl('https://example.com')).toBe('https://example.com/')
  })

  it('refuses everything but http and https', () => {
    for (const raw of [
      'file:///Users/me/secret.html',
      'cate://newtab',
      'about:blank',
      'javascript:alert(1)',
      'data:text/html,<p>x</p>',
      'chrome://settings',
      'not a url',
      '',
    ]) expect(stripUrl(raw), raw).toBeNull()
  })

  it('masks a long token-like path segment with * (Q5)', () => {
    expect(stripUrl('https://example.com/reset/aB3dE5gH7jK9mN1pQ')).toBe('https://example.com/reset/*')
    expect(stripUrl('https://example.com/share/550e8400-e29b-41d4-a716-446655440000')).toBe('https://example.com/share/*')
    expect(stripUrl('https://example.com/api/v1/users/0123456789abcdef0123/orders')).toBe('https://example.com/api/v1/users/*/orders')
  })

  it('masks a segment of 16 characters or more whatever it holds, a digit or not', () => {
    expect(stripUrl('https://example.com/share/abcdefghijklmnop')).toBe('https://example.com/share/*')
    expect(stripUrl('https://example.com/share/ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe('https://example.com/share/*')
    expect(stripUrl('https://example.com/docs/internationalization')).toBe('https://example.com/docs/*')
    expect(stripUrl('https://example.com/blog/how-to-set-up-a-custom-domain')).toBe('https://example.com/blog/*')
    expect(stripUrl('https://example.com/d/Ab_Cd-Ef_Gh-Ij_Kl')).toBe('https://example.com/d/*')
    expect(stripUrl('https://example.com/f/report_final.pdf')).toBe('https://example.com/f/*')
  })

  it('keeps a segment of 15 characters or less, and masks one of exactly 16', () => {
    expect(stripUrl('https://example.com/reset/abc123')).toBe('https://example.com/reset/abc123')
    expect(stripUrl('https://example.com/share/abcdefghijklmno')).toBe('https://example.com/share/abcdefghijklmno')
    expect(stripUrl('https://example.com/share/abcdefghijklmnop')).toBe('https://example.com/share/*')
    expect(stripUrl('https://example.com/share/abcdefg-hijklmn')).toBe('https://example.com/share/abcdefg-hijklmn')
    expect(stripUrl('https://example.com/share/abcdefg-hijklmno')).toBe('https://example.com/share/*')
    expect(stripUrl('https://example.com/orders/new')).toBe('https://example.com/orders/new')
  })

  it('masks a segment that holds a run of 16 characters or more, wherever the run sits in it', () => {
    for (const segment of ['abcdefghijklmnop!', '!abcdefghijklmnop', 'id:abcdefghijklmnop', 'x%20abcdefghijklmnop', 'abcdefghijklmnop%20x', 'a!abcdefghijklmnop!b']) {
      expect(stripUrl(`https://example.com/share/${segment}`), segment).toBe('https://example.com/share/*')
    }
    for (const segment of ['abcdefghijklmno!', '!abcdefghijklmno', 'abcdefghijklmn!op', 'abcdefgh!ijklmnop-q-r']) {
      expect(stripUrl(`https://example.com/share/${segment}`), segment).toBe(`https://example.com/share/${segment}`)
    }
  })

  it('masks an email address in the path, written or percent-encoded', () => {
    expect(stripUrl('https://example.com/users/jane.doe@example.com/profile')).toBe('https://example.com/users/*/profile')
    expect(stripUrl('https://example.com/users/jane%40example.com')).toBe('https://example.com/users/*')
    expect(stripUrl('https://example.com/users/a@b')).toBe('https://example.com/users/*')
    expect(stripUrl('https://example.com/users/j%40d')).toBe('https://example.com/users/*')
  })

  it('masks a base64 token with + or =, written or percent-encoded, whatever its length', () => {
    expect(stripUrl('https://example.com/t/ab+cd')).toBe('https://example.com/t/*')
    expect(stripUrl('https://example.com/t/dG9rZW4=')).toBe('https://example.com/t/*')
    expect(stripUrl('https://example.com/t/YWJj%2BZGVm')).toBe('https://example.com/t/*')
    expect(stripUrl('https://example.com/t/YWJjZA%3D%3D')).toBe('https://example.com/t/*')
    expect(stripUrl('https://example.com/t/YWJj%2bZGVm')).toBe('https://example.com/t/*')
    expect(stripUrl('https://example.com/t/YWJjZA%3d%3d')).toBe('https://example.com/t/*')
  })

  it('masks a segment whose decoded form is long, and keeps one that cannot be decoded and is short', () => {
    expect(stripUrl('https://example.com/s/%61%62%63%64%65%66%67%68%69%6a%6b%6c%6d%6e%6f%70')).toBe('https://example.com/s/*')
    expect(stripUrl('https://example.com/s/100%')).toBe('https://example.com/s/100%')
    expect(stripUrl('https://example.com/s/a%20b')).toBe('https://example.com/s/a%20b')
  })

  it('masks every such segment of a path and leaves the others', () => {
    expect(stripUrl('https://example.com/a/jane@example.com/b/abcdefghijklmnop/c/dG9rZW4=/d')).toBe('https://example.com/a/*/b/*/c/*/d')
  })

  it('gives a masked address back unchanged', () => {
    const once = stripUrl('https://example.com/users/jane.doe@example.com/t/abcdefghijklmnop/dG9rZW4=')!
    expect(once).toBe('https://example.com/users/*/t/*/*')
    expect(stripUrl(once)).toBe(once)
  })

  it('drops path parameters, where legacy session ids travel', () => {
    expect(stripUrl('https://example.com/shop;jsessionid=ABCDEF1234567890ABCDEF/cart')).toBe('https://example.com/shop/cart')
  })
})

describe('isSensitiveField', () => {
  it('flags a password input whatever its case', () => {
    expect(isSensitiveField({ type: 'password' })).toBe(true)
    expect(isSensitiveField({ type: 'PassWord' })).toBe(true)
    expect(isSensitiveField({ type: ' password ' })).toBe(true)
  })

  it('flags every cc-* autocomplete, one-time-code, current-password and new-password', () => {
    for (const autocomplete of [
      'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-name', 'cc-given-name',
      'cc-additional-name', 'cc-family-name', 'cc-type', 'one-time-code', 'current-password', 'new-password',
    ]) expect(isSensitiveField({ type: 'text', autocomplete }), autocomplete).toBe(true)
  })

  it('reads the raw autocomplete: mixed case and composed values', () => {
    expect(isSensitiveField({ autocomplete: 'Current-Password' })).toBe(true)
    expect(isSensitiveField({ autocomplete: 'ONE-TIME-CODE' })).toBe(true)
    expect(isSensitiveField({ autocomplete: 'section-pay billing cc-csc' })).toBe(true)
    expect(isSensitiveField({ autocomplete: 'shipping new-password' })).toBe(true)
    expect(isSensitiveField({ autocomplete: '  cc-number  ' })).toBe(true)
  })

  it('splits the words of autocomplete on any white space', () => {
    expect(isSensitiveField({ autocomplete: 'billing\tcc-number' })).toBe(true)
    expect(isSensitiveField({ autocomplete: 'shipping\ncc-csc' })).toBe(true)
    expect(isSensitiveField({ autocomplete: 'section-a   one-time-code' })).toBe(true)
    expect(isSensitiveField({ autocomplete: 'billing cc-number' })).toBe(true)
    expect(isSensitiveField({ autocomplete: 'billing cc-number' })).toBe(true)
    expect(isSensitiveField({ autocomplete: 'billing-cc-number' })).toBe(false)
  })

  it('does not flag the other fields', () => {
    expect(isSensitiveField({ type: 'text', autocomplete: 'email' })).toBe(false)
    expect(isSensitiveField({ type: 'text', autocomplete: 'off' })).toBe(false)
    expect(isSensitiveField({ type: 'email', autocomplete: 'username' })).toBe(false)
    expect(isSensitiveField({ type: 'text', autocomplete: 'cc' })).toBe(false)
    expect(isSensitiveField({ type: 'text', autocomplete: 'accordion' })).toBe(false)
    expect(isSensitiveField({})).toBe(false)
    expect(isSensitiveField({ type: null, autocomplete: null })).toBe(false)
  })
})

describe('isExcludedDomain', () => {
  const list = ['exemple.fr', 'mail.google.com']

  it('matches the domain and its subdomains', () => {
    expect(isExcludedDomain('exemple.fr', list)).toBe(true)
    expect(isExcludedDomain('www.exemple.fr', list)).toBe(true)
    expect(isExcludedDomain('a.b.exemple.fr', list)).toBe(true)
    expect(isExcludedDomain('mail.google.com', list)).toBe(true)
  })

  it('does not match a close domain', () => {
    expect(isExcludedDomain('banque-exemple.fr', list)).toBe(false)
    expect(isExcludedDomain('notexemple.fr', list)).toBe(false)
    expect(isExcludedDomain('exemple.fr.evil.com', list)).toBe(false)
    expect(isExcludedDomain('google.com', list)).toBe(false)
    expect(isExcludedDomain('exemple.com', list)).toBe(false)
  })

  it('ignores the case, a trailing dot, a port and a full URL', () => {
    expect(isExcludedDomain('WWW.Exemple.FR', list)).toBe(true)
    expect(isExcludedDomain('www.exemple.fr.', list)).toBe(true)
    expect(isExcludedDomain('www.exemple.fr:8443', list)).toBe(true)
    expect(isExcludedDomain('https://user:pw@www.exemple.fr:8443/a?b=1#c', list)).toBe(true)
  })

  it('fails closed on what it cannot read', () => {
    expect(isExcludedDomain('', list)).toBe(true)
    expect(isExcludedDomain('http://', list)).toBe(true)
  })
})

describe('the default exclusion list', () => {
  const categories = Object.keys(DEFAULT_EXCLUSIONS)

  it('covers bank, mail, health, HR, payroll and password managers', () => {
    expect(categories).toEqual(['banque', 'mail', 'sante', 'rh', 'paie', 'motsDePasse'])
    for (const category of categories) expect(DEFAULT_EXCLUSIONS[category as keyof typeof DEFAULT_EXCLUSIONS].length, category).toBeGreaterThan(0)
  })

  it('holds bare lowercase domains', () => {
    for (const domains of Object.values(DEFAULT_EXCLUSIONS)) {
      for (const domain of domains) expect(domain, domain).toMatch(/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?)+$/)
    }
  })

  it('excludes a domain of every category, subdomains included', () => {
    const list = exclusionList({ ajoutees: [], retirees: [] })
    for (const [category, domains] of Object.entries(DEFAULT_EXCLUSIONS)) {
      expect(isExcludedDomain(domains[0], list), category).toBe(true)
      expect(isExcludedDomain(`www.${domains[0]}`, list), category).toBe(true)
    }
  })
})

describe('exclusionList', () => {
  const all = Object.values(DEFAULT_EXCLUSIONS).flat()

  it('is the default list without a user change', () => {
    expect(exclusionList({ ajoutees: [], retirees: [] }).sort()).toEqual([...new Set(all)].sort())
  })

  it('adds the domains the user adds, normalized', () => {
    const list = exclusionList({ ajoutees: ['Intranet.Exemple.FR', ' client.exemple.fr '], retirees: [] })
    expect(list).toContain('intranet.exemple.fr')
    expect(list).toContain('client.exemple.fr')
  })

  it('removes a default domain the user removes', () => {
    const first = all[0]
    expect(exclusionList({ ajoutees: [], retirees: [first] })).not.toContain(first)
    expect(exclusionList({ ajoutees: [], retirees: [first.toUpperCase()] })).not.toContain(first)
  })

  it('lets a removal win over an addition of the same domain', () => {
    expect(exclusionList({ ajoutees: ['exemple.fr'], retirees: ['exemple.fr'] })).not.toContain('exemple.fr')
  })
})

describe('isDomainName', () => {
  const label = (length: number) => 'a'.repeat(length)

  it('takes a bare lowercase domain of at least two labels', () => {
    for (const name of ['exemple.fr', 'mail.exemple.fr', 'a.b', 'a-b.fr', 'a1.fr', '1a.fr', 'xn--80ak6aa92e.com', 'exemple.fr.co']) {
      expect(isDomainName(name), name).toBe(true)
    }
  })

  it('refuses what is not one', () => {
    for (const name of [
      '', 'exemple', 'Exemple.fr', 'exemple.FR', '-a.fr', 'a-.fr', 'a..fr', '.fr', 'a.fr.', ' a.fr', 'a.fr ', 'a b.fr', 'a_b.fr',
      'https://a.fr', 'a.fr/x', 'a.fr:80', 'a@b.fr', '*.a.fr',
    ]) expect(isDomainName(name), name).toBe(false)
  })

  it('takes a label of 63 characters and refuses one of 64', () => {
    expect(isDomainName(`${label(63)}.fr`)).toBe(true)
    expect(isDomainName(`a.${label(63)}`)).toBe(true)
    expect(isDomainName(`${label(64)}.fr`)).toBe(false)
    expect(isDomainName(`a.${label(64)}`)).toBe(false)
  })

  it('takes a name of 253 characters and refuses one of 254', () => {
    const at253 = [label(63), label(63), label(63), label(61)].join('.')
    expect(at253).toHaveLength(253)
    expect(isDomainName(at253)).toBe(true)
    expect(isDomainName([label(63), label(63), label(63), label(62)].join('.'))).toBe(false)
  })
})
