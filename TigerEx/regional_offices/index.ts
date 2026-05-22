/**
 * TigerEx Regional Offices Platform
 * Global office locations and contacts
 */
export class RegionalOfficesPlatform {
  private offices = new Map();
  constructor() {
    this.offices.set('US', { location: 'New York', contact: 'us@tigerex.com', phone: '+1-212-555-0100' });
    this.offices.set('UK', { location: 'London', contact: 'uk@tigerex.com', phone: '+44-20-7123-4567' });
    this.offices.set('SG', { location: 'Singapore', contact: 'sg@tigerex.com', phone: '+65-6789-0123' });
    this.offices.set('JP', { location: 'Tokyo', contact: 'jp@tigerex.com', phone: '+81-3-1234-5678' });
    this.offices.set('KR', { location: 'Seoul', contact: 'kr@tigerex.com', phone: '+82-2-1234-5678' });
  }
  async findOffice(country: string) { return this.offices.get(country) || { location: 'Global', contact: 'support@tigerex.com' }; }
  async getAllOffices() { return Array.from(this.offices.entries()).map(([k,v]) => ({ code: k, ...v })); }
}