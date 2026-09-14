export type RoleAssetCharacterId = 'walter' | 'jesse' | 'skyler' | 'saul' | 'mike' | 'gus' | 'hank' | 'marie'

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
      {
        id: 'walter-oh-no',
        source: 'giphy',
        url: 'https://media.giphy.com/media/5QlwTKQ3kq3N6/giphy.gif',
        tags: ['panic', 'tense', 'default'],
        usageNotes: 'First-frame audited 2026-09-14: Bryan Cranston as Walter, startled/upset indoor close-up.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'walter-i-won',
        source: 'giphy',
        url: 'https://media.giphy.com/media/xT0GqssRweIhlz209i/giphy.gif',
        tags: ['restraint', 'glare', 'default'],
        usageNotes: 'First-frame audited 2026-09-14: Walter on the phone, bandaged nose, "I won" smug close.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'walter-desert-surrender',
        source: 'giphy',
        url: 'https://media.giphy.com/media/xT0GqiRi9X1i9XPVSg/giphy.gif',
        tags: ['desert', 'tense', 'confrontation'],
        usageNotes: 'First-frame audited 2026-09-14: Walter in the desert with hands up, Tohajiilee/arrest energy.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'walter-burning-car',
        source: 'giphy',
        url: 'https://media.giphy.com/media/3oFzlZtqFKcR1qegTu/giphy.gif',
        tags: ['panic', 'tense', 'desert'],
        usageNotes: 'First-frame audited 2026-09-14: Walter walking away from a burning car at a gas station.',
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
      {
        id: 'jesse-angry-defiance',
        source: 'giphy',
        url: 'https://media.giphy.com/media/99WRPEyvToq5i/giphy.gif',
        tags: ['default', 'tense', 'confrontation'],
        usageNotes: 'Jesse defiant, angry pushback, or confrontation energy.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'jesse-scared-retreat',
        source: 'giphy',
        url: 'https://media.giphy.com/media/d7xkF33kyWy54duSRH/giphy.gif',
        tags: ['panic', 'tense'],
        usageNotes: 'Jesse fearful, overwhelmed, or retreating.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'jesse-guilty-breakdown',
        source: 'giphy',
        url: 'https://media.giphy.com/media/10qcQYd6rcfS12/giphy.gif',
        tags: ['panic', 'tense', 'restraint'],
        usageNotes: 'Jesse breakdown, guilt, or emotional collapse. From the finale escape.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'jesse-yeah-science',
        source: 'giphy',
        url: 'https://media.giphy.com/media/8H4BFnRFNlAGY/giphy.gif',
        tags: ['chemistry', 'default'],
        usageNotes: 'First-frame audited 2026-09-14: Aaron Paul as Jesse, beanie, "Yeah, science!" kitchen table.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'jesse-car-laugh',
        source: 'giphy',
        url: 'https://media.giphy.com/media/127LizwUvmw2Pu/giphy.gif',
        tags: ['panic', 'tense', 'default'],
        usageNotes: 'First-frame audited 2026-09-14: Jesse in a car, manic laugh/grimace.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'jesse-yeah-bitch',
        source: 'giphy',
        url: 'https://media.giphy.com/media/XGzGnyuUA05uHK0U9W/giphy.gif',
        tags: ['confrontation', 'desert', 'default'],
        usageNotes: 'First-frame audited 2026-09-14: Jesse outdoors in plaid, "YEAH BITCH!" magnet-heist energy.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'jesse-break-bad',
        source: 'giphy',
        url: 'https://media.giphy.com/media/l41YcUdo6sVMIrvKU/giphy.gif',
        tags: ['tense', 'default'],
        usageNotes: 'First-frame audited 2026-09-14: Jesse in beanie at the wheel, "He\'s just gonna break bad?"',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
    ],
  },
  skyler: {
    characterId: 'skyler',
    displayName: 'Skyler',
    usageNotes:
      'Conservative pool for family-tension, restraint, and confrontation beats. Prefer family/confrontation tags; default is a controlled-restraint fallback.',
    safetyNotes:
      'Avoid pairing with domestic-violence framing or real harm guidance; keep selection tied to fictional emotional tension and boundary-setting.',
    copyrightNotes: platformCopyrightNote,
    gifPools: [
      {
        id: 'skyler-family-pressure',
        source: 'giphy',
        url: 'https://media.giphy.com/media/LBL8F53My1SZa/giphy.gif',
        tags: ['default', 'family', 'tense', 'restraint'],
        usageNotes: 'Default fallback for family pressure, controlled confrontation, or restrained replies.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes:
          'TODO: surfaced via Giphy @breakingbad channel with amc.com source; verify fan-made status and replace with a vetted fan-made reaction GIF if an official clip is detected. ' +
          platformCopyrightNote,
      },
      {
        id: 'skyler-confrontation',
        source: 'giphy',
        url: 'https://media.giphy.com/media/10RCqM2nZpdqOQ/giphy.gif',
        tags: ['confrontation', 'glare', 'tense'],
        usageNotes: 'Direct confrontation, boundary-setting, or clipped challenge.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes:
          'Original source is a Reddit r/reactiongifs fan-made GIF surfaced via Giphy @breakingbad channel; preferred over official-clip GIFs. ' +
          platformCopyrightNote,
      },
      {
        id: 'skyler-protective-fear',
        source: 'giphy',
        url: 'https://media.giphy.com/media/c4rNN6FOS8l6o/giphy.gif',
        tags: ['family', 'panic', 'confrontation'],
        usageNotes: 'Family under threat; protective, strained tension. Skyler\'s terror in the Crawl Space realization scene.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes:
          'Surfaced via Giphy @breakingbad channel; Crawl Space scene featuring Skyler White (Anna Gunn). Verify fan-made status and attribution before production. ' +
          platformCopyrightNote,
      },
      {
        id: 'skyler-wine-table',
        source: 'giphy',
        url: 'https://media.giphy.com/media/P7uX5d4Sx5ogo/giphy.gif',
        tags: ['family', 'restraint', 'default'],
        usageNotes: 'First-frame audited 2026-09-14: Skyler at the dining table pouring wine, domestic strain.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'skyler-looks-down',
        source: 'giphy',
        url: 'https://media.giphy.com/media/2PPWmS8SVcH6kK7FRE/giphy.gif',
        tags: ['confrontation', 'tense'],
        usageNotes: 'First-frame audited 2026-09-14: Skyler looking down over a counter, clipped challenge.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'skyler-dinner-glass',
        source: 'giphy',
        url: 'https://media.giphy.com/media/kpHr0NQoJplh6/giphy.gif',
        tags: ['family', 'tense', 'restraint'],
        usageNotes: 'First-frame audited 2026-09-14: Skyler at dinner with a wine glass, watching someone across the table.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'skyler-get-out',
        source: 'giphy',
        url: 'https://media.giphy.com/media/fNXB5OuYmTgBy/giphy.gif',
        tags: ['confrontation', 'family', 'tense'],
        usageNotes: 'First-frame audited 2026-09-14: Skyler in a hallway, "Get" / telling someone off, Flynn behind her.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
    ],
  },
  saul: {
    characterId: 'saul',
    displayName: 'Saul',
    usageNotes:
      'Pool for lawyer-pitch, panic, and deal beats. Prefer lawyer/business tags for salesmanship; panic for comedic retreat; money/deal for transactions.',
    safetyNotes:
      'Avoid framing as real legal advice or implying official endorsement; keep selection tied to fictional sleazy-lawyer roleplay flavor.',
    copyrightNotes: platformCopyrightNote,
    gifPools: [
      {
        id: 'saul-lawyer-pitch',
        source: 'giphy',
        url: 'https://media.giphy.com/media/iFbDPhB72ZIcl2LbJy/giphy.gif',
        tags: ['default', 'lawyer', 'business', 'deal'],
        usageNotes: 'Default fallback; office pitch, salesmanship, or client-consultation energy.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes:
          'TODO: surfaced via Giphy @bettercallsaulAMC channel with amc.tv source; verify fan-made status and replace with a vetted fan-made reaction GIF if an official clip is detected. ' +
          platformCopyrightNote,
      },
      {
        id: 'saul-office-panic',
        source: 'giphy',
        url: 'https://media.giphy.com/media/h4wZmNF30XcXtm228e/giphy.gif',
        tags: ['panic', 'tense', 'lawyer'],
        usageNotes: 'Comedic panic, retreat, or nervous deflection.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes:
          'TODO: Giphy internal GIF; original source unverified; replace with a vetted fan-made reaction GIF before production. ' +
          platformCopyrightNote,
      },
      {
        id: 'saul-cash-deal',
        source: 'giphy',
        url: 'https://media.giphy.com/media/l0EwYGlvQ7STj3wyc/giphy.gif',
        tags: ['money', 'deal', 'business'],
        usageNotes: 'Cash deal, transaction framing, or sleazy negotiation.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes:
          'TODO: surfaced via Giphy stanaustralia channel (streaming platform); verify fan-made status and replace with a vetted fan-made reaction GIF if an official clip is detected. ' +
          platformCopyrightNote,
      },
      {
        id: 'saul-office-sidle',
        source: 'giphy',
        url: 'https://media.giphy.com/media/AoBwreWrMtT7W/giphy.gif',
        tags: ['lawyer', 'default'],
        usageNotes: 'First-frame audited 2026-09-14: Bob Odenkirk as Saul, pink shirt, office sidle/pitch.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'saul-finger-point',
        source: 'giphy',
        url: 'https://media.giphy.com/media/Bs0GXj3ew6xxK/giphy.gif',
        tags: ['lawyer', 'business', 'deal'],
        usageNotes: 'First-frame audited 2026-09-14: Saul in a dark suit pointing, sales-close energy.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'saul-bathroom-stall',
        source: 'giphy',
        url: 'https://media.giphy.com/media/3o85g3BWHJ48FFio7e/giphy.gif',
        tags: ['panic', 'lawyer', 'tense'],
        usageNotes: 'First-frame audited 2026-09-14: Saul in a tiled stall, caught/nervous consultation.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'saul-door-profile',
        source: 'giphy',
        url: 'https://media.giphy.com/media/ko8HPo4iQxcZi/giphy.gif',
        tags: ['tense', 'restraint'],
        usageNotes: 'First-frame audited 2026-09-14: Saul in profile at a door, low-talk caution.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'saul-finger-guns',
        source: 'giphy',
        url: 'https://media.giphy.com/media/5j62OhVdJYcAfYGsKI/giphy.gif',
        tags: ['lawyer', 'default', 'deal'],
        usageNotes: 'First-frame audited 2026-09-14: Saul finger-guns smile in a hallway.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
    ],
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
      {
        id: 'mike-cold-command',
        source: 'giphy',
        url: 'https://media.giphy.com/media/5TkFkpGVIEQQU/giphy.gif',
        tags: ['confrontation', 'tense', 'glare'],
        usageNotes: 'Mike cold command, non-negotiable directive, or operational tension.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'mike-resigned-calm',
        source: 'giphy',
        url: 'https://media.giphy.com/media/Pkit5v6UWonyFyjwjl/giphy.gif',
        tags: ['restraint', 'tense', 'default'],
        usageNotes: 'Mike resigned, been-through-it-all calm, or low-emotion pressure. "I don\'t think fear is a great motivator."',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'mike-known-to-happen',
        source: 'giphy',
        url: 'https://media.giphy.com/media/3Rf7vIEMzdvriNns5R/giphy.gif',
        tags: ['restraint', 'default'],
        usageNotes: 'First-frame audited 2026-09-14: Mike in a wood-paneled room, dry "it has been known to happen."',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'mike-close-listen',
        source: 'giphy',
        url: 'https://media.giphy.com/media/GGPa1hbSpHpcUWXagb/giphy.gif',
        tags: ['default', 'tense', 'restraint'],
        usageNotes: 'First-frame audited 2026-09-14: Mike close-up, listening, unimpressed.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'mike-desert-yeah',
        source: 'giphy',
        url: 'https://media.giphy.com/media/mBXxvqkSzrEH6zAHKX/giphy.gif',
        tags: ['desert', 'tense', 'glare'],
        usageNotes: 'First-frame audited 2026-09-14: Mike in desert light, "Yeah?"',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'mike-boss-problem',
        source: 'giphy',
        url: 'https://media.giphy.com/media/07swPi9C48QQUTrHex/giphy.gif',
        tags: ['business', 'restraint', 'default'],
        usageNotes: 'First-frame audited 2026-09-14: Mike close-up, "Boss has a problem, he knows how to reach me."',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'mike-insurance',
        source: 'giphy',
        url: 'https://media.giphy.com/media/phVfgRoUTo07OzuPXT/giphy.gif',
        tags: ['business', 'tense', 'restraint'],
        usageNotes: 'First-frame audited 2026-09-14: Mike walking with Gus, "I should be there for insurance."',
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
      {
        id: 'gus-controlled-evaluation',
        source: 'giphy',
        url: 'https://media.giphy.com/media/9epwERliv63IORvOp5/giphy.gif',
        tags: ['default', 'business', 'restraint', 'glare'],
        usageNotes: 'Use when Gus is assessing whether the user is useful, disciplined, or becoming a liability.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'gus-polite-pressure',
        source: 'giphy',
        url: 'https://media.giphy.com/media/WbDhQjgBrpUuk/giphy.gif',
        tags: ['default', 'deal', 'tense', 'restraint'],
        usageNotes: 'Use for courteous pressure, formal meetings, or controlled negotiation beats.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'gus-explain-yourself',
        source: 'giphy',
        url: 'https://media.giphy.com/media/26BRQaiZM0IeyoJfa/giphy.gif',
        tags: ['confrontation', 'glare', 'tense', 'business'],
        usageNotes: 'Use when Gus asks for precision, accountability, or a clear explanation.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'gus-formal-introduction',
        source: 'giphy',
        url: 'https://media.giphy.com/media/djexcuiAT9l7l3iY6I/giphy.gif',
        tags: ['default', 'deal', 'business'],
        usageNotes: 'Use for composed hospitality, first-contact energy, or quietly staged politeness.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'gus-silent-threat',
        source: 'giphy',
        url: 'https://media.giphy.com/media/HENIWUNWswV247B1T9/giphy.gif',
        tags: ['glare', 'tense', 'restraint', 'confrontation'],
        usageNotes: 'Use for silent displeasure, implied threat, or a pause that changes the room.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'gus-business-room',
        source: 'giphy',
        url: 'https://media.giphy.com/media/3og0IRV2vZRkwOjMpG/giphy.gif',
        tags: ['business', 'deal', 'restraint'],
        usageNotes: 'Use for controlled operational conversations and high-stakes business framing.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'gus-command',
        source: 'giphy',
        url: 'https://media.giphy.com/media/xUA7bgLCTSGnh1Qxe8/giphy.gif',
        tags: ['confrontation', 'tense', 'glare'],
        usageNotes: 'Use when Gus gives a short command or makes displeasure feel unavoidable.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
    ],
  },
  hank: {
    characterId: 'hank',
    displayName: 'Hank',
    usageNotes:
      'Visually audited Dean Norris / Hank pool only. Prefer glare/tense for case pressure; default for loud loyalty and office talk; restraint for dry smug energy.',
    safetyNotes: 'Never use for real investigative instruction; keep selection fictional and tonal.',
    copyrightNotes: platformCopyrightNote,
    gifPools: [
      // First-frame audited 2026-07-15: each URL is Dean Norris as Hank (not Walter/random TV).
      {
        id: 'hank-investigative-read',
        source: 'giphy',
        url: 'https://media.giphy.com/media/UvtKiyeWYEhRC/giphy.gif',
        tags: ['default', 'tense', 'glare'],
        usageNotes: 'Looks up from a file - case pressure, realization, or investigative heat.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'hank-hard-closeup',
        source: 'giphy',
        url: 'https://media.giphy.com/media/wlvuqFDPCwBOrAx77M/giphy.gif',
        tags: ['glare', 'confrontation', 'tense'],
        usageNotes: 'Hard close-up stare when jokes dry up or a suspect is under watch.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'hank-realize-book',
        source: 'giphy',
        url: 'https://media.giphy.com/media/kbCOCUKMuwe9fM8bBL/giphy.gif',
        tags: ['tense', 'glare', 'default'],
        usageNotes: 'Reading / realizing - leaves of grass moment energy, or badge pride hit.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'hank-office-talk',
        source: 'giphy',
        url: 'https://media.giphy.com/media/iDC1eZnTKSBwSgc4rq/giphy.gif',
        tags: ['default', 'tense'],
        usageNotes: 'DEA office talk, partner banter, or badge-forward swagger.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'hank-hell-yeah',
        source: 'giphy',
        url: 'https://media.giphy.com/media/iowmvjVUnDFGU/giphy.gif',
        tags: ['default'],
        usageNotes: 'Loud loyalty, cookout surface energy, or forced swagger covering worry.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'hank-asac-stare',
        source: 'giphy',
        url: 'https://media.giphy.com/media/l41YdZ0z4LL2pAh9u/giphy.gif',
        tags: ['confrontation', 'glare', 'tense'],
        usageNotes: 'Direct challenge, ASAC pride, or personal pressure after a hit to ego.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'hank-dry-office',
        source: 'giphy',
        url: 'https://media.giphy.com/media/L0ZAYwHRYJawDqNtoE/giphy.gif',
        tags: ['restraint', 'default'],
        usageNotes: 'Dry office restraint, skeptical half-smile, or understated pressure.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'hank-smug-delight',
        source: 'giphy',
        url: 'https://media.giphy.com/media/dX2WPe4QmYOuY3S97S/giphy.gif',
        tags: ['restraint', 'default', 'family'],
        usageNotes: 'Smug delight, family ribbing surface, or covering worry with a grin.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
    ],
  },
  marie: {
    characterId: 'marie',
    displayName: 'Marie',
    usageNotes:
      'Starter pool, first-frame audited 2026-09-14. Prefer family/restraint; default is the sofa two-shot. Catalog is still thinner than the others.',
    safetyNotes:
      'Do not introduce unlicensed or AI-generated Marie imagery. Keep selection tied to fictional household observation and relationship pressure.',
    copyrightNotes: platformCopyrightNote,
    gifPools: [
      {
        id: 'marie-secrets-sofa',
        source: 'giphy',
        url: 'https://media.giphy.com/media/9itKBqCf0fmDe/giphy.gif',
        tags: ['family', 'restraint', 'default'],
        usageNotes: 'First-frame audited 2026-09-14: Marie on the sofa with Skyler, "We all have our secrets."',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
      {
        id: 'marie-blinds-cry',
        source: 'giphy',
        url: 'https://media.giphy.com/media/131s7DE2m4UWwo/giphy.gif',
        tags: ['family', 'panic', 'tense'],
        usageNotes: 'First-frame audited 2026-09-14: Betsy Brandt as Marie, grimace/cry against window blinds.',
        safetyNotes: fictionalRoleSafetyNote,
        copyrightNotes: platformCopyrightNote,
      },
    ],
  },
}

export type RoleAssets = typeof roleAssets
