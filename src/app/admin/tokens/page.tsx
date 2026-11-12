'use client';

import ListingManager, { type ListingSpec } from '@/components/admin/ListingManager';

/**
 * Token listing administration.
 *
 * A token is listed on a chain that is already listed. A non-native EVM token
 * needs its contract address and decimals, so the wallet can read its balance;
 * the native coin leaves the contract address blank.
 */
const spec: ListingSpec = {
  title: 'Tokens',
  description:
    'List the tokens the exchange reads on each chain. A non-native EVM token requires its contract address and decimals; the native coin leaves the address blank.',
  endpoint: '/api/admin/tokens',
  listKey: 'tokens',
  symbolField: 'symbol',
  deleteQuery: 'tokenId',
  deleteField: 'tokenId',
  fields: [
    { name: 'chainKey', label: 'Chain key', type: 'text', required: true, placeholder: 'tigersmartchain' },
    { name: 'symbol', label: 'Symbol', type: 'text', required: true, placeholder: 'RUSD' },
    { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Royal Tiger USD' },
    { name: 'contractAddress', label: 'Contract address', type: 'text', placeholder: '0x…', help: 'blank for the native coin' },
    { name: 'decimals', label: 'Decimals', type: 'number', step: '1', placeholder: '18', help: '18 for most ERC-20, 6 for USD stablecoins (USDT/USDC/RUSD)' },
    { name: 'status', label: 'Status', type: 'select', options: ['active', 'paused', 'delisting'], required: true },
  ],
  defaults: { decimals: 18, status: 'active' },
};

export default function AdminTokensPage() {
  return <ListingManager spec={spec} />;
}
