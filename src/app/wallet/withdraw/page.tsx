"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUp, AlertTriangle, CheckCircle, RefreshCw } from "lucide-react";
import { useApiResource, toArray } from "@/lib/useApiResource";

interface Balance {
  id?: string;
  asset?: string;
  coin?: string;
  symbol?: string;
  network?: string;
  available?: number;
  balance?: number;
}

interface WithdrawalFee {
  coin?: string;
  asset?: string;
  network?: string;
  fee?: number;
  min_withdraw?: number;
  min?: number;
}

interface WithdrawResponse {
  success?: boolean;
  id?: string;
  withdrawal_id?: string;
  error?: string;
}

function coinOf(balance: Balance): string {
  return balance.asset || balance.coin || balance.symbol || "—";
}

function availableOf(balance: Balance): number {
  return balance.available ?? balance.balance ?? 0;
}

export default function WithdrawPage() {
  const balances = useApiResource<unknown>("/api/wallet/balances");
  const balanceList = useMemo(() => toArray<Balance>(balances.data), [balances.data]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [memo, setMemo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const selected = useMemo(() => {
    if (balanceList.length === 0) return null;
    return (
      balanceList.find((b) => `${coinOf(b)}:${b.network ?? ""}` === selectedKey) || balanceList[0]
    );
  }, [balanceList, selectedKey]);

  const feePath = selected
    ? `/api/withdrawal/fee?coin=${encodeURIComponent(coinOf(selected))}${
        selected.network ? `&network=${encodeURIComponent(selected.network)}` : ""
      }`
    : null;
  const feeResource = useApiResource<unknown>(feePath);
  const feeData = (feeResource.data && typeof feeResource.data === "object"
    ? ((feeResource.data as Record<string, unknown>).data ?? feeResource.data)
    : null) as WithdrawalFee | null;

  const networkFee = feeData?.fee ?? null;
  const numericAmount = Number(amount);
  const receive =
    networkFee !== null && Number.isFinite(numericAmount) && numericAmount > 0
      ? Math.max(0, numericAmount - networkFee)
      : null;

  const submit = async () => {
    if (!selected) return;
    setResult(null);
    setSubmitting(true);
    try {
      const token =
        typeof window !== "undefined"
          ? window.localStorage.getItem("token") || window.localStorage.getItem("auth_token")
          : null;
      const response = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          coin: coinOf(selected),
          network: selected.network,
          amount: numericAmount,
          address,
          memo: memo || undefined,
        }),
      });
      const data = (await response.json()) as WithdrawResponse;
      if (response.ok && data.success !== false) {
        setResult({
          ok: true,
          message: `Withdrawal submitted${
            data.id || data.withdrawal_id ? ` (id ${data.id || data.withdrawal_id})` : ""
          }.`,
        });
        setAmount("");
        setAddress("");
        setMemo("");
      } else {
        setResult({ ok: false, message: data.error || "Withdrawal failed." });
      }
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : "Withdrawal failed.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    Boolean(selected) &&
    numericAmount > 0 &&
    address.trim().length > 0 &&
    !submitting;

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
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-bold text-white">Withdraw</h1>
            <p className="text-gray-400">Withdraw crypto to external wallet</p>
          </div>
          <button
            onClick={balances.reload}
            className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {balances.loading && <p className="text-sm text-gray-500">Loading balances…</p>}
        {balances.error && (
          <p className="text-sm text-red-400">Could not load balances: {balances.error}</p>
        )}
        {!balances.loading && !balances.error && balanceList.length === 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-gray-500">
            You have no balances available to withdraw.
          </div>
        )}

        {selected && (
          <>
            <div className="mb-6 grid grid-cols-3 gap-2">
              {balanceList.map((balance) => {
                const key = `${coinOf(balance)}:${balance.network ?? ""}`;
                const isSelected = `${coinOf(selected)}:${selected.network ?? ""}` === key;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedKey(key)}
                    className={`rounded-lg border p-3 text-center ${
                      isSelected
                        ? "border-tiger-orange bg-tiger-orange/10"
                        : "border-white/10 bg-white/5"
                    }`}
                  >
                    <div className="font-bold text-white">{coinOf(balance)}</div>
                    <div className="text-xs text-gray-400">
                      {availableOf(balance).toLocaleString(undefined, {
                        maximumFractionDigits: 8,
                      })}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-6">
              <div className="mb-4">
                <label className="mb-2 block text-sm text-gray-400">Recipient Address</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={`Enter ${coinOf(selected)} address`}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 font-mono text-white"
                />
              </div>

              <div className="mb-4">
                <label className="mb-2 block text-sm text-gray-400">
                  Amount ({coinOf(selected)})
                </label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 font-mono text-white"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Available:{" "}
                  {availableOf(selected).toLocaleString(undefined, { maximumFractionDigits: 8 })}
                </p>
              </div>

              <div className="mb-4">
                <label className="mb-2 block text-sm text-gray-400">
                  Memo / Tag (if required)
                </label>
                <input
                  type="text"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 font-mono text-white"
                />
              </div>

              <div className="mb-4 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-400" />
                  <div className="text-sm text-yellow-400">
                    Ensure the address is correct. Wrong addresses may result in permanent loss of
                    funds.
                  </div>
                </div>
              </div>

              <div className="mb-4 rounded-lg bg-white/5 p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Network Fee</span>
                  <span className="font-mono text-white">
                    {feeResource.loading
                      ? "…"
                      : networkFee === null
                        ? "—"
                        : `${networkFee} ${coinOf(selected)}`}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">You will receive</span>
                  <span className="font-mono text-white">
                    {receive === null
                      ? "—"
                      : `${receive.toFixed(8)} ${coinOf(selected)}`}
                  </span>
                </div>
              </div>

              {result && (
                <div
                  className={`mb-4 flex items-start gap-2 rounded-lg p-3 text-sm ${
                    result.ok
                      ? "bg-green-500/10 text-green-400"
                      : "bg-red-500/10 text-red-400"
                  }`}
                >
                  {result.ok && <CheckCircle className="h-5 w-5" />}
                  <span>{result.message}</span>
                </div>
              )}

              <button
                onClick={submit}
                disabled={!canSubmit}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-tiger-orange py-3 font-bold text-white disabled:opacity-50"
              >
                <ArrowUp className="h-5 w-5" />
                {submitting ? "Submitting…" : "Withdraw"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
