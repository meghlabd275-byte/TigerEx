'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, shortenId } from '@/lib/dex/format';

interface ListingsResponse {
  listings: Array<{
    listing_id: string;
    collection: string;
    token_id: string;
    seller_id: string;
    buyer_id: string | null;
    price: number;
    currency: string;
    status: string;
    created_at: string;
    sold_at: string | null;
  }>;
}

export default function DexNftPage() {
  const listings = useApiResource<ListingsResponse>('/api/dex/nft');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ collection: '', tokenId: '', price: '', currency: 'RUSD' });

  const rows = listings.data?.listings ?? [];

  const list = async () => {
    setBusy('list');
    setMessage(null);
    try {
      const body = await apiRequest<{ listingId: string }>('/api/dex/nft', {
        method: 'POST',
        body: {
          action: 'list',
          collection: form.collection,
          tokenId: form.tokenId,
          price: Number(form.price),
          currency: form.currency,
        },
      });
      setMessage({ ok: true, text: `Listed as ${shortenId(body.listingId)}.` });
      setForm({ collection: '', tokenId: '', price: '', currency: form.currency });
      listings.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not list the NFT.' });
    } finally {
      setBusy(null);
    }
  };

  const buy = async (listingId: string) => {
    setBusy(listingId);
    setMessage(null);
    try {
      const body = await apiRequest<{ sale: { price: number; fee: number; sellerProceeds: number } }>('/api/dex/nft', {
        method: 'POST',
        body: { action: 'buy', listingId },
      });
      setMessage({
        ok: true,
        text: `Bought for ${formatAmount(body.sale.price)}; seller received ${formatAmount(body.sale.sellerProceeds)}.`,
      });
      listings.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The purchase was refused.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DexShell
      title="NFT marketplace"
      subtitle="List and buy NFTs against a ledger asset; the sale settles atomically between seller and buyer."
      actions={
        <button
          onClick={listings.reload}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      }
    >
      {message && (
        <p
          className={`mb-4 rounded-md px-3 py-2 text-sm ${
            message.ok
              ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="List an NFT">
          <label className="block text-xs text-gray-500 dark:text-slate-400">Collection</label>
          <input
            className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={form.collection}
            onChange={(event) => setForm((current) => ({ ...current, collection: event.target.value }))}
          />
          <label className="block text-xs text-gray-500 dark:text-slate-400">Token id</label>
          <input
            className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={form.tokenId}
            onChange={(event) => setForm((current) => ({ ...current, tokenId: event.target.value }))}
          />
          <label className="block text-xs text-gray-500 dark:text-slate-400">Price</label>
          <input
            className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            type="number"
            min="0"
            value={form.price}
            onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
          />
          <label className="block text-xs text-gray-500 dark:text-slate-400">Currency</label>
          <input
            className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={form.currency}
            onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
          />
          <button
            onClick={list}
            disabled={busy !== null || !form.collection || !form.tokenId || !form.price}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-orange-600 px-4 py-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {busy === 'list' && <Loader2 className="h-4 w-4 animate-spin" />} List
          </button>
        </Panel>

        <Panel title="Listings" className="lg:col-span-2">
          {listings.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading listings…</p>}
          {listings.error && <p className="text-sm text-red-600 dark:text-red-400">{listings.error}</p>}
          {!listings.loading && rows.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-slate-400">No NFT is listed yet.</p>
          )}
          {rows.length > 0 && (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Collection</Th>
                  <Th>Token</Th>
                  <Th>Seller</Th>
                  <Th right>Price</Th>
                  <Th>Status</Th>
                  <Th right>Action</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((listing) => (
                  <tr key={listing.listing_id}>
                    <Td>{listing.collection}</Td>
                    <Td>#{listing.token_id}</Td>
                    <Td>{shortenId(listing.seller_id)}</Td>
                    <Td right>
                      {formatAmount(listing.price)} {listing.currency}
                    </Td>
                    <Td>{listing.status}</Td>
                    <Td right>
                      <button
                        onClick={() => buy(listing.listing_id)}
                        disabled={busy !== null || listing.status !== 'listed'}
                        className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-2 py-1 text-xs text-white hover:bg-orange-700 disabled:opacity-40"
                      >
                        {busy === listing.listing_id && <Loader2 className="h-3 w-3 animate-spin" />} Buy
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </div>
    </DexShell>
  );
}
