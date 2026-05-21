/**
 * Validators
 * 
 * Input validation for all exchange APIs
 */

import { ValidationError } from '../errors';

// User validators
export const userValidators = {
  email: (value: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) throw new ValidationError('Invalid email format', 'email');
    return true;
  },
  
  password: (value: string) => {
    if (value.length < 8) throw new ValidationError('Password must be at least 8 characters', 'password');
    if (!/[A-Z]/.test(value)) throw new ValidationError('Password must contain uppercase', 'password');
    if (!/[a-z]/.test(value)) throw new ValidationError('Password must contain lowercase', 'password');
    if (!/[0-9]/.test(value)) throw new ValidationError('Password must contain number', 'password');
    return true;
  },
  
  username: (value: string) => {
    if (value.length < 3) throw new ValidationError('Username must be at least 3 characters', 'username');
    if (value.length > 20) throw new ValidationError('Username must be at most 20 characters', 'username');
    if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new ValidationError('Username can only contain letters, numbers, underscore', 'username');
    return true;
  }
};

// Trading validators
export const tradingValidators = {
  orderSide: (value: string) => {
    if (!['buy', 'sell'].includes(value.toLowerCase())) {
      throw new ValidationError('Order side must be buy or sell', 'side');
    }
    return true;
  },
  
  orderType: (value: string) => {
    const validTypes = ['market', 'limit', 'stop_market', 'stop_limit', 'take_profit', 'trailing'];
    if (!validTypes.includes(value.toLowerCase())) {
      throw new ValidationError(`Invalid order type: ${value}`, 'type');
    }
    return true;
  },
  
  price: (value: number, minPrice = 0) => {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new ValidationError('Price must be a number', 'price');
    }
    if (value <= minPrice) {
      throw new ValidationError(`Price must be greater than ${minPrice}`, 'price');
    }
    return true;
  },
  
  quantity: (value: number, minQty = 0) => {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new ValidationError('Quantity must be a number', 'quantity');
    }
    if (value <= minQty) {
      throw new ValidationError(`Quantity must be greater than ${minQty}`, 'quantity');
    }
    return true;
  },
  
  leverage: (value: number) => {
    const validLeverage = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100];
    if (!validLeverage.includes(value)) {
      throw new ValidationError(`Invalid leverage: ${value}`, 'leverage');
    }
    return true;
  }
};

// Wallet validators
export const walletValidators = {
  address: (value: string, network: string) => {
    // Basic validation - in production use network-specific validators
    if (!value || value.length < 20) {
      throw new ValidationError('Invalid wallet address', 'address');
    }
    return true;
  },
  
  amount: (value: number, minAmount = 0) => {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new ValidationError('Amount must be a number', 'amount');
    }
    if (value <= minAmount) {
      throw new ValidationError(`Amount must be greater than ${minAmount}`, 'amount');
    }
    if (value > 1e15) {
      throw new ValidationError('Amount exceeds maximum', 'amount');
    }
    return true;
  }
};

// KYC validators
export const kycValidators = {
  documentType: (value: string) => {
    const validTypes = ['passport', 'drivers_license', 'national_id'];
    if (!validTypes.includes(value)) {
      throw new ValidationError('Invalid document type', 'documentType');
    }
    return true;
  },
  
  country: (value: string) => {
    if (!value || value.length !== 2) {
      throw new ValidationError('Invalid country code', 'country');
    }
    return true;
  }
};

// Utility function
export function validateAll<T>(validators: Record<string, (value: unknown) => boolean, data: T): void {
  for (const [field, validator] of Object.entries(validators)) {
    const value = (data as Record<string, unknown>)[field];
    if (value !== undefined) {
      validator(value);
    }
  }
}