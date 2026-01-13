import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO, isValid } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Check if a string looks like a valid blockchain address
 * - Solana: base58 encoded, typically 32-44 characters
 * - EVM: 0x prefix + 40 hex characters
 */
export function isValidAddressFormat(address: string): boolean {
  if (!address || address.length < 20) return false;
  // EVM address
  if (address.startsWith('0x') && address.length === 42) return true;
  // Solana address (base58, 32-44 chars, no spaces)
  if (address.length >= 32 && address.length <= 44 && !/\s/.test(address)) return true;
  return false;
}

export function formatAddress(address: string, chars = 6): string {
  // If it doesn't look like a valid address, return as-is
  if (!isValidAddressFormat(address)) {
    return address;
  }
  return `${address.slice(0, chars)}...${address.slice(-4)}`;
}

export function formatDate(dateString: string): string {
  if (!dateString) return 'N/A';
  
  try {
    // Try parsing as ISO string first
    let date = parseISO(dateString);
    
    // If that doesn't work, try regular Date constructor
    if (!isValid(date)) {
      date = new Date(dateString);
    }
    
    // If still invalid, return the original string
    if (!isValid(date)) {
      return dateString;
    }
    
    return format(date, 'MMM d, yyyy, h:mm a');
  } catch {
    return dateString;
  }
}

