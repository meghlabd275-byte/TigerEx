"use client";

import { useState, useEffect, useRef, useCallback } from 'react';

interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  className?: string;
}

export default function OtpInput({
  length = 6,
  value,
  onChange,
  disabled = false,
  error,
  className = '',
}: OtpInputProps) {
  const [otp, setOtp] = useState<string[]>(Array(length).fill(''));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Initialize OTP array from value
  useEffect(() => {
    const chars = value.split('');
    const newOtp = Array(length).fill('');
    chars.forEach((char, index) => {
      if (index < length) {
        newOtp[index] = char;
      }
    });
    setOtp(newOtp);
  }, [value, length]);

  // Focus first input on mount
  useEffect(() => {
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, []);

  const handleChange = useCallback((index: number, char: string) => {
    if (!/^\d*$/.test(char)) return; // Only allow digits

    const newOtp = [...otp];
    newOtp[index] = char;
    const newValue = newOtp.join('');
    
    onChange(newValue);

    // Auto-focus next input
    if (char && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }, [otp, length, onChange]);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (otp[index]) {
        const newOtp = [...otp];
        newOtp[index] = '';
        onChange(newOtp.join(''));
      } else if (index > 0) {
        // Move to previous input and clear it
        inputRefs.current[index - 1]?.focus();
        const newOtp = [...otp];
        newOtp[index - 1] = '';
        onChange(newOtp.join(''));
      }
    }
  }, [otp, onChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').trim();
    
    if (!/^\d+$/.test(pastedData)) return;

    const chars = pastedData.split('').slice(0, length);
    const newOtp = [...otp];
    
    chars.forEach((char, index) => {
      if (index < length) {
        newOtp[index] = char;
      }
    });
    
    onChange(newOtp.join(''));
    
    // Focus the next empty input or the last input
    const nextEmptyIndex = newOtp.findIndex(val => val === '');
    if (nextEmptyIndex !== -1) {
      inputRefs.current[nextEmptyIndex]?.focus();
    } else {
      inputRefs.current[length - 1]?.focus();
    }
  }, [otp, length, onChange]);

  const handleFocus = useCallback((index: number) => {
    // Select the entire value on focus
    inputRefs.current[index]?.select();
  }, []);

  return (
    <div className={className}>
      <div className="flex justify-center gap-2 sm:gap-3">
        {otp.map((digit, index) => (
          <input
            key={index}
            ref={(el) => { inputRefs.current[index] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handlePaste}
            onFocus={() => handleFocus(index)}
            disabled={disabled}
            className={`
              w-10 h-12 sm:w-12 sm:h-14 text-center text-lg sm:text-xl font-bold
              border-2 rounded-lg outline-none transition-all
              ${error 
                ? 'border-red-500 focus:border-red-500 bg-red-50 dark:bg-red-900/20' 
                : 'border-gray-300 dark:border-gray-600 focus:border-blue-500 bg-white dark:bg-gray-800'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              text-gray-900 dark:text-white
            `}
          />
        ))}
      </div>
      {error && (
        <p className="mt-2 text-center text-sm text-red-500">{error}</p>
      )}
    </div>
  );
}
