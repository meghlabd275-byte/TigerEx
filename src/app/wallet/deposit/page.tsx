"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Copy, CheckCircle, RefreshCw } from "lucide-react";
import { useApiResource, toArray } from "@/lib/useApiResource";

interface NetworkInfo {
  id?: string;
  coin?: string;
  symbol?: string;
  asset?: string;
  network?: string;
  chain?: string;
  min_deposit?: number;
  min_amount?: number;
  confirmations?: number;
}

interface DepositAddress {
  address?: string;
  memo?: string;
  tag?: string;
  network?: string;
  coin?: string;
  min_deposit?: number;
  confirmations?: number;
}

export default function DepositPage() {
  const networks = useApiResource<unknown>("/api/wallet/networks");
  const networkList = useMemo(() => toArray<NetworkInfo>(networks.data), [networks.data]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const selected = useMemo(() => {
    if (networkList.length === 0) return null;
    return networkList.find((n) => networkKey(n) === selectedKey) || networkList[0];
  }, [networkList, selectedKey]);

  const addressPath = selected
    ? `/api/deposit/address?coin=${encodeURIComponent(
        coinOf(selected)
      )}&network=${encodeURIComponent(networkOf(selected))}`
    : null;
  const addressResource = useApiResource<unknown>(addressPath);

  const addressData = (addressResource.data && typeof addressResource.data === "object"
    ? ((addressResource.data as Record<string, unknown>).data ?? addressResource.data)
    : null) as DepositAddress | null;

  useEffect(() => {
    setCopied(false);
  }, [selectedKey]);

  const handleCopy = () => {
    if (!addressData?.address) return;
    navigator.clipboard.writeText(addressData.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-tiger-black to-[#0d0d1a]">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-tiger-black/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-tiger-orange">
              <span className="text-xl font-bold text-white">T</span>
            </div>
            <span className="text-xl font-bold text-white">TigerEx</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/wallet" className="text-sm text-tiger-orange">
              Wallet
            </Link>
          </nav>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-bold text-white">Deposit</h1>
            <p className="text-gray-400">Get your deposit address</p>
          </div>
          <button
            onClick={networks.reload}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {networks.loading && <p className="text-sm text-gray-500">Loading networks…</p>}
        {networks.error && (
          <p className="text-sm text-red-400">Could not load networks: {networks.error}</p>
        )}
        {!networks.loading && !networks.error && networkList.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-gray-500">
            No deposit networks are enabled on this account yet.
          </div>
        )}

        {networkList.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-2 md:grid-cols-4">
            {networkList.map((net) => {
              const key = networkKey(net);
              const isSelected = selected ? networkKey(selected) === key : false;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedKey(key)}
                  className={`rounded-lg border p-3 text-center ${
                    isSelected ? "border-tiger-orange bg-tiger-orange/10" : "border-white/10 bg-white/5"
                  }`}
                >
                  <div className="font-bold text-white">{coinOf(net)}</div>
                  <div className="text-xs text-gray-400">{networkOf(net)}</div>
                </button>
              );
            })}
          </div>
        )}

        {selected && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-6">
            <div className="mb-4 text-center">
              <div className="mb-2 text-sm text-gray-400">
                Deposit {coinOf(selected)} on {networkOf(selected)}
              </div>
              <div className="text-sm text-red-400">
                Only send {coinOf(selected)} to this address
              </div>
            </div>

            {addressResource.loading && (
              <p className="mb-4 text-center text-sm text-gray-500">
                Loading your deposit address…
              </p>
            )}
            {addressResource.error && (
              <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">
                Could not load your deposit address: {addressResource.error}
              </div>
            )}

            {addressData?.address && (
              <>
                <div className="mb-4 break-all rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="mb-1 text-sm text-gray-400">Deposit Address</div>
                  <div className="font-mono text-sm text-white">{addressData.address}</div>
                  {(addressData.memo || addressData.tag) && (
                    <div className="mt-2 text-sm text-yellow-400">
                      Memo/Tag: {addressData.memo || addressData.tag}
                    </div>
                  )}
                </div>

                <button
                  onClick={handleCopy}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-tiger-orange py-3 font-bold text-white"
                >
                  {copied ? <CheckCircle className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                  {copied ? "Copied!" : "Copy Address"}
                </button>
              </>
            )}

            {!addressResource.loading && !addressResource.error && !addressData?.address && (
              <div className="mb-4 rounded-lg border border-white/10 bg-white/5 p-4 text-center text-sm text-gray-500">
                No deposit address is assigned for this network yet.
              </div>
            )}

            <div className="mt-4 text-sm text-gray-400">
              <div>
                Min deposit: {addressData?.min_deposit ?? selected.min_deposit ?? selected.min_amount ?? "—"}{" "}
                {coinOf(selected)}
              </div>
              <div className="mt-1">
                Confirmations required: {addressData?.confirmations ?? selected.confirmations ?? "—"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function coinOf(net: NetworkInfo): string {
  return net.coin || net.symbol || net.asset || "—";
}

function networkOf(net: NetworkInfo): string {
  return net.network || net.chain || "—";
}

function networkKey(net: NetworkInfo): string {
  return `${coinOf(net)}:${networkOf(net)}`;
}
