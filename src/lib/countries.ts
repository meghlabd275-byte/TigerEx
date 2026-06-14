export function regionToFlag(region: string) {
  return region
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

const dialingCodes: Record<string, string> = {
  US: '+1', CA: '+1', GB: '+44', AU: '+61', DE: '+49', FR: '+33', IT: '+39', ES: '+34', NL: '+31',
  SE: '+46', NO: '+47', DK: '+45', FI: '+358', CH: '+41', AT: '+43', IE: '+353', PT: '+351', BE: '+32',
  IN: '+91', CN: '+86', JP: '+81', KR: '+82', SG: '+65', ID: '+62', MY: '+60', TH: '+66', VN: '+84', PH: '+63',
  BD: '+880', PK: '+92', AE: '+971', SA: '+966', QA: '+974', KW: '+965', BH: '+973', OM: '+968', TR: '+90',
  BR: '+55', MX: '+52', AR: '+54', CL: '+56', CO: '+57', PE: '+51', NG: '+234', ZA: '+27', EG: '+20', KE: '+254',
  GH: '+233', MA: '+212', RU: '+7', UA: '+380', PL: '+48', CZ: '+420', RO: '+40', GR: '+30', NZ: '+64'
};

export function getSupportedCountries() {
  const displayNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;
  const regions = typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl
    ? Intl.supportedValuesOf('region')
    : Object.keys(dialingCodes);

  return regions.map((region) => ({
    region,
    name: displayNames?.of(region) || region,
    flag: /^[A-Z]{2}$/.test(region) ? regionToFlag(region) : '🌐',
    dialCode: dialingCodes[region] || '+',
  })).sort((a, b) => a.name.localeCompare(b.name));
}
