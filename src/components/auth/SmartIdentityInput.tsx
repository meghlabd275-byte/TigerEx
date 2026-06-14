'use client';

import { useMemo, useState } from 'react';
import { Mail, Phone, Search } from 'lucide-react';
import { getSupportedCountries } from '@/lib/countries';
import { buildIdentityState, formatPhoneNumber, IdentityState } from '@/lib/identity';

interface SmartIdentityInputProps {
  value: string;
  country: string;
  onValueChange: (value: string) => void;
  onCountryChange: (country: string) => void;
  onIdentityChange?: (identity: IdentityState) => void;
  label?: string;
  placeholder?: string;
  autoComplete?: string;
}

export function SmartIdentityInput({
  value,
  country,
  onValueChange,
  onCountryChange,
  onIdentityChange,
  label = 'Email or phone',
  placeholder = 'Email or phone number',
  autoComplete = 'username',
}: SmartIdentityInputProps) {
  const [countrySearch, setCountrySearch] = useState('');
  const countries = useMemo(() => getSupportedCountries(), []);
  const identity = useMemo(() => buildIdentityState(value, country), [value, country]);
  const selectedCountry = countries.find((item) => item.region === country) || countries[0];
  const phoneMode = identity.type === 'phone';
  const filteredCountries = countries.filter((item) =>
    `${item.flag} ${item.name} ${item.dialCode}`.toLowerCase().includes(countrySearch.toLowerCase()),
  );

  const handleValue = (nextValue: string) => {
    const nextIdentity = buildIdentityState(nextValue, country);
    onValueChange(nextIdentity.type === 'phone' ? formatPhoneNumber(nextValue) : nextValue);
    onIdentityChange?.(nextIdentity);
  };

  const handleCountry = (nextCountry: string) => {
    onCountryChange(nextCountry);
    onIdentityChange?.(buildIdentityState(value, nextCountry));
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">{label}</label>
      <div className="relative">
        {phoneMode ? (
          <Phone className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
        ) : (
          <Mail className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
        )}
        {phoneMode && (
          <span className="absolute left-10 top-3.5 text-sm text-muted-foreground">
            {selectedCountry?.flag} {selectedCountry?.dialCode}
          </span>
        )}
        <input
          value={value}
          onChange={(event) => handleValue(event.target.value)}
          inputMode={phoneMode ? 'tel' : 'email'}
          autoComplete={autoComplete}
          className={`w-full rounded-xl border border-border bg-background py-3 pr-3 ${phoneMode ? 'pl-28' : 'pl-11'}`}
          placeholder={placeholder}
        />
      </div>
      <div className={`text-xs ${identity.isValid ? 'text-green-500' : 'text-muted-foreground'}`}>
        {identity.type === 'empty' ? 'Type letters for email or numbers for phone; mode updates instantly.' : identity.validationMessage}
      </div>
      {phoneMode && (
        <div className="rounded-xl border border-border bg-background p-3">
          <div className="relative mb-2">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={countrySearch}
              onChange={(event) => setCountrySearch(event.target.value)}
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm"
              placeholder="Search country, flag, or dial code"
            />
          </div>
          <select
            value={country}
            onChange={(event) => handleCountry(event.target.value)}
            className="w-full rounded-lg border border-border bg-background p-2 text-sm"
          >
            {filteredCountries.map((item) => (
              <option key={item.region} value={item.region}>
                {item.flag} {item.name} {item.dialCode}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
