/**
 * TIGEREX REGIONAL OFFICES PLATFORM
 * Production - Global office locations and contacts
 */

export interface Office {
  code: string;
  location: string;
  contact: string;
  phone: string;
  timezone: string;
  address?: string;
  hours?: string;
}

export class RegionalOfficesPlatform {
  private offices = new Map();

  constructor() {
    this.offices.set('US', { code: 'US', location: 'New York', contact: 'us@tigerex.com', phone: '+1-212-555-0100', timezone: 'America/New_York', address: '350 Fifth Avenue, New York, NY', hours: '9AM-6PM EST' });
    this.offices.set('UK', { code: 'UK', location: 'London', contact: 'uk@tigerex.com', phone: '+44-20-7123-4567', timezone: 'Europe/London', address: '25 Old Broad Street, London', hours: '9AM-6PM GMT' });
    this.offices.set('SG', { code: 'SG', location: 'Singapore', contact: 'sg@tigerex.com', phone: '+65-6789-0123', timezone: 'Asia/Singapore', address: '海洋金融中心, Marina Bay', hours: '9AM-6PM SGT' });
    this.offices.set('JP', { code: 'JP', location: 'Tokyo', contact: 'jp@tigerex.com', phone: '+81-3-1234-5678', timezone: 'Asia/Tokyo', address: '東京都千代田区', hours: '9AM-6PM JST' });
    this.offices.set('KR', { code: 'KR', location: 'Seoul', contact: 'kr@tigerex.com', phone: '+82-2-1234-5678', timezone: 'Asia/Seoul', address: '서울시종로구', hours: '9AM-6PM KST' });
    this.offices.set('AU', { code: 'AU', location: 'Sydney', contact: 'au@tigerex.com', phone: '+61-2-1234-5678', timezone: 'Australia/Sydney', address: 'NSW 2000', hours: '9AM-6PM AEDT' });
    this.offices.set('AE', { code: 'AE', location: 'Dubai', contact: 'ae@tigerex.com', phone: '+971-4-123-4567', timezone: 'Asia/Dubai', address: 'Dubai International Financial Centre', hours: '9AM-6PM GST' });
    this.offices.set('DE', { code: 'DE', location: 'Frankfurt', contact: 'de@tigerex.com', phone: '+49-69-1234-5678', timezone: 'Europe/Berlin', address: 'MainTower, Frankfurt', hours: '9AM-6PM CET' });
  }

  async findOffice(country: string): Promise<Office | null> {
    return this.offices.get(country) || null;
  }

  async getAllOffices(): Promise<Office[]> {
    return Array.from(this.offices.values());
  }

  getOfficeByTimezone(timezone: string): Office | undefined {
    return Array.from(this.offices.values()).find(o => o.timezone === timezone);
  }
}

export default RegionalOfficesPlatform;