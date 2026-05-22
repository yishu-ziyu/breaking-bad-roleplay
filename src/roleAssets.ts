export type RoleAssetCharacterId = 'walter' | 'jesse' | 'skyler' | 'saul' | 'mike' | 'gus'

export type RoleGifTag =
  | 'default'
  | 'tense'
  | 'chemistry'
  | 'panic'
  | 'lawyer'
  | 'glare'
  | 'money'
  | 'desert'
  | 'family'
  | 'deal'
  | 'business'
  | 'restraint'
  | 'confrontation'

export type RoleGifAsset = {
  id: string
  source: 'giphy'
  url: string
  tags: RoleGifTag[]
  usageNotes: string
  safetyNotes: string
  copyrightNotes: string
}

export type RoleAssetRegistryEntry = {
  characterId: RoleAssetCharacterId
  displayName: string
  gifPools: RoleGifAsset[]
  usageNotes: string
  safetyNotes: string
  copyrightNotes: string
}

const platformCopyrightNote =
  'Externally hosted GIF; verify platform terms, attribution requirements, and regional availability before production use.'

const fictionalRoleSafetyNote =
  'Use only for fictional roleplay flavor. Do not present as official Breaking Bad media, endorsement, or actor-generated speech.'

export const roleAssets: Record<RoleAssetCharacterId, RoleAssetRegistryEntry> = {
  walter: {
    characterId: 'walter',
    displayName: 'Walter',
    usageNotes:
      'Most complete pool. Prefer chemistry/desert/family tags for context-specific replies; use glare or tense for controlled menace.',
    safetyNotes:
      'Avoid pairing with explicit criminal instructions or real-world harm guidance; keep selection tied to fictional tension and emotional state.',
    copyrightNotes: platformCopyrightNote,
    gifPools: [
      {
        id: 'walter-controlled-glare',
        source: 'giphy',
        url: 'https://media.giphy.com/media/3oFzm9r8nz1CmqYtmU/giphy.gif',
        tags: ['default', 'glare', 'tense', 'confrontation'],
        usageNotes: 'General Walter fallback for clipped, defensive, or intimidating replies.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'walter-chemistry-focus',
        source: 'giphy',
        url: 'https://media.giphy.com/media/R3S6MfUoKvBVS/giphy.gif',
        tags: ['chemistry', 'default', 'business'],
        usageNotes: 'Use when the reply references chemistry, precision, process, or technical confidence.',
        safetyNotes:
          'Keep usage abstract and dramatic; do not pair with actionable drug manufacturing or hazardous chemistry instructions.',
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'walter-lab-intensity',
        source: 'giphy',
        url: 'https://media.giphy.com/media/3oFzmkkwfOGlzZ0gxi/giphy.gif',
        tags: ['chemistry', 'tense', 'business'],
        usageNotes: 'Good match for calculated escalation, lab context, or Walter asserting expertise.',
        safetyNotes:
          'Use for mood only; avoid making the GIF selection imply procedural illegal activity guidance.',
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'walter-cornered-panic',
        source: 'giphy',
        url: 'https://media.giphy.com/media/3ohc11UljvpPKWeNva/giphy.gif',
        tags: ['panic', 'tense', 'glare', 'confrontation'],
        usageNotes: 'Use when Walter is pressured, cornered, exposed, or losing control.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'walter-desert-standoff',
        source: 'giphy',
        url: 'https://media.giphy.com/media/NUBp5KcV0PJBe/giphy.gif',
        tags: ['desert', 'tense', 'deal', 'confrontation'],
        usageNotes: 'Use for desert, RV, Albuquerque, standoff, or irreversible-choice moments.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'walter-desert-fallout',
        source: 'giphy',
        url: 'https://media.giphy.com/media/CzlpZQRcd5Wjm/giphy.gif',
        tags: ['desert', 'panic', 'tense'],
        usageNotes: 'Use for aftermath, panic, heat, escape, or plans going visibly wrong.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'walter-family-pressure',
        source: 'giphy',
        url: 'https://media.giphy.com/media/l0HUjziiiniIsRUY0/giphy.gif',
        tags: ['family', 'tense', 'restraint'],
        usageNotes: 'Use when the reply rationalizes family, guilt, secrecy, or protection.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
    ],
  },
  jesse: {
    characterId: 'jesse',
    displayName: 'Jesse',
    usageNotes: 'Small conservative pool. Prefer panic/tense tags for emotionally volatile replies.',
    safetyNotes: 'Avoid glamorizing substance use or self-destructive behavior; keep selection character-emotional.',
    copyrightNotes: platformCopyrightNote,
    gifPools: [
      {
        id: 'jesse-panic-fallback',
        source: 'giphy',
        url: 'https://media.giphy.com/media/u7UgRRotar5du/giphy.gif',
        tags: ['default', 'panic', 'tense'],
        usageNotes: 'Fallback for Jesse replies that are anxious, defensive, or overwhelmed.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
    ],
  },
  skyler: {
    characterId: 'skyler',
    displayName: 'Skyler',
    usageNotes:
      'Intentionally empty until Skyler-specific GIFs are vetted. Use text-only fallback rather than mislabeling another character or scene.',
    safetyNotes: 'Do not substitute unrelated domestic-conflict GIFs that could distort tone or character intent.',
    copyrightNotes: 'No GIFs are registered yet; add only vetted externally hosted assets with clear usage notes.',
    gifPools: [],
  },
  saul: {
    characterId: 'saul',
    displayName: 'Saul',
    usageNotes:
      'Intentionally empty until Saul-specific legal-office or salesmanship GIFs are vetted. Text-only fallback is preferred for now.',
    safetyNotes: 'Avoid using generic lawyer GIFs that imply real legal advice or misrepresent source media.',
    copyrightNotes: 'No GIFs are registered yet; add only vetted externally hosted assets with clear usage notes.',
    gifPools: [],
  },
  mike: {
    characterId: 'mike',
    displayName: 'Mike',
    usageNotes: 'Small pool for restrained, watchful, operationally tense moments.',
    safetyNotes: 'Avoid pairing with explicit violence instructions; use for mood, silence, or caution.',
    copyrightNotes: platformCopyrightNote,
    gifPools: [
      {
        id: 'mike-watchful-restraint',
        source: 'giphy',
        url: 'https://media.giphy.com/media/xT8qBgvOUl9mj2fe6c/giphy.gif',
        tags: ['default', 'tense', 'glare', 'restraint'],
        usageNotes: 'Fallback for terse Mike replies, surveillance energy, or low-emotion pressure.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
    ],
  },
  gus: {
    characterId: 'gus',
    displayName: 'Gus',
    usageNotes: 'Small pool for calm business pressure, controlled hospitality, and quiet threat.',
    safetyNotes: 'Avoid framing business formality as real coercion guidance; keep selection fictional and tonal.',
    copyrightNotes: platformCopyrightNote,
    gifPools: [
      {
        id: 'gus-calm-business',
        source: 'giphy',
        url: 'https://media.giphy.com/media/BRWAInZmzzBm0/giphy.gif',
        tags: ['default', 'deal', 'business', 'tense', 'restraint'],
        usageNotes: 'Use for polite but threatening Gus replies, meetings, deals, or controlled evaluation.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
    ],
  },
}

export type RoleAssets = typeof roleAssets
