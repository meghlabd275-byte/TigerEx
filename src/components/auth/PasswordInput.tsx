"use client";

import { useState, useCallback } from 'react';
import { Eye, EyeOff, Check, X, AlertCircle } from 'lucide-react';

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  showStrength?: boolean;
  className?: string;
  id?: string;
  name?: string;
  required?: boolean;
}

export type PasswordStrength = 'weak' | 'medium' | 'strong';

interface PasswordRequirements {
  length: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  special: boolean;
}

export default function PasswordInput({
  value,
  onChange,
  placeholder = 'Enter password',
  disabled = false,
  error,
  showStrength = false,
  className = '',
  id,
  name,
  required = false,
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false);

  const checkRequirements = useCallback((): PasswordRequirements => {
    return {
      length: value.length >= 8,
      uppercase: /[A-Z]/.test(value),
      lowercase: /[a-z]/.test(value),
      number: /[0-9]/.test(value),
      special: /[!@#$%^&*(),.?":{}|<>]/.test(value),
    };
  }, [value]);

  const calculateStrength = useCallback((): PasswordStrength => {
    const reqs = checkRequirements();
    const metCount = Object.values(reqs).filter(Boolean).length;
    
    if (metCount <= 2) return 'weak';
    if (metCount <= 4) return 'medium';
    return 'strong';
  }, [checkRequirements]);

  const getStrengthColor = useCallback((): string => {
    const strength = calculateStrength();
    switch (strength) {
      case 'weak':
        return 'bg-red-500';
      case 'medium':
        return 'bg-yellow-500';
      case 'strong':
        return 'bg-green-500';
    }
  }, [calculateStrength]);

  const getStrengthLabel = useCallback((): string => {
    const strength = calculateStrength();
    switch (strength) {
      case 'weak':
        return 'Weak';
      case 'medium':
        return 'Medium';
      case 'strong':
        return 'Strong';
    }
  }, [calculateStrength]);

  const requirements = showStrength ? checkRequirements() : null;
  const strength = showStrength ? calculateStrength() : null;

  return (
    <div className={className}>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className={`
            w-full px-4 py-3 pr-12 border-2 rounded-lg outline-none transition-all
            bg-white dark:bg-gray-800
            ${error || (touched && value && !checkRequirements().length)
              ? 'border-red-500 focus:border-red-500' 
              : 'border-gray-300 dark:border-gray-600 focus:border-blue-500'
            }
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500
          `}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          {showPassword ? (
            <EyeOff className="w-5 h-5" />
          ) : (
            <Eye className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-1 mt-1">
          <AlertCircle className="w-4 h-4 text-red-500" />
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}

      {/* Password strength indicator */}
      {showStrength && value && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-600 dark:text-gray-400">Password strength</span>
            <span className={`
              text-sm font-medium
              ${strength === 'weak' ? 'text-red-500' : ''}
              ${strength === 'medium' ? 'text-yellow-500' : ''}
              ${strength === 'strong' ? 'text-green-500' : ''}
            `}>
              {getStrengthLabel()}
            </span>
          </div>
          <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full ${getStrengthColor()} transition-all duration-300`}
              style={{
                width: strength === 'weak' ? '33%' : strength === 'medium' ? '66%' : '100%',
              }}
            />
          </div>
        </div>
      )}

      {/* Password requirements */}
      {showStrength && requirements && value && (
        <div className="mt-3 space-y-1">
          <RequirementItem 
            met={requirements.length} 
            label="At least 8 characters" 
          />
          <RequirementItem 
            met={requirements.uppercase} 
            label="One uppercase letter (A-Z)" 
          />
          <RequirementItem 
            met={requirements.lowercase} 
            label="One lowercase letter (a-z)" 
          />
          <RequirementItem 
            met={requirements.number} 
            label="One number (0-9)" 
          />
          <RequirementItem 
            met={requirements.special} 
            label="One special character (!@#$%^&*)" 
          />
        </div>
      )}
    </div>
  );
}

interface RequirementItemProps {
  met: boolean;
  label: string;
}

function RequirementItem({ met, label }: RequirementItemProps) {
  return (
    <div className={`flex items-center gap-2 text-sm ${met ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
      {met ? (
        <Check className="w-4 h-4" />
      ) : (
        <X className="w-4 h-4" />
      )}
      <span>{label}</span>
    </div>
  );
}
