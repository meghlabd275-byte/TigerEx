"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { User, Wallet, CheckCircle, RefreshCw } from "lucide-react";
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

interface TransferResponse {
  success?: boolean;
  id?: string;
  transfer_id?: string;
  error?: string;
}

function coinOf(balance: Balance): string {
  return balance.asset || balance.coin || balance.symbol || "—";
}

function availableOf(balance: Balance): number {
  return balance.available ?? balance.balance ?? 0;
}

export default function TransferPage() {
  const balances = useApiResource<unknown>("/api/wallet/balances");
  const balanceList = useMemo(() => toArray<Balance>(balances.data), [balances.data]);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [mode, setMode] = useState<"internal" | "external">("internal");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const selected = useMemo(() => {
    if (balanceList.length === 0) return null;
    return (
      balanceList.find((b) => `${coinOf(b)}:${b.network ?? ""}` === selectedKey) || balanceList[0]
    );
  }, [balanceList, selectedKey]);

  const submit = async () => {
    if (!selected) return;
    setResult(null);
    setSubmitting(true);
    try {
      const token =
        typeof window !== "undefined"
          ? window.localStorage.getItem("token") || window.localStorage.getItem("auth_token")
          : null;
      const response = await fetch("/api/wallet/transfers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          coin: coinOf(selected),
          amount: Number(amount),
          recipient,
          mode,
        }),
      });
      const data = (await response.json()) as TransferResponse;
      if (response.ok && data.success !== false) {
        setResult({
          ok: true,
          message: `Transfer submitted${
            data.id || data.transfer_id ? ` (id ${data.id || data.transfer_id})` : ""
          }.`,
        });
        setAmount("");
        setRecipient("");
      } else {
        setResult({ ok: false, message: data.error || "Transfer failed." });
      }
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : "Transfer failed.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    Boolean(selected) && Number(amount) > 0 && recipient.trim().length > 0 && !submitting;

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
            <h1 className="mb-2 text-3xl font-bold text-white">Transfer</h1>
            <p className="text-gray-400">Transfer between wallets</p>
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
            You have no balances available to transfer.
          </div>
        )}

        {selected && (
          <>
            <div className="mb-4 flex rounded-lg border border-white/10 bg-white/5 p-1">
              <button
                onClick={() => setMode("internal")}
                className={`flex-1 rounded py-2 ${
                  mode === "internal" ? "bg-white/10 text-white" : "text-gray-400"
                }`}
              >
                <User className="mr-1 inline h-4 w-4" /> Internal
              </button>
              <button
                onClick={() => setMode("external")}
                className={`flex-1 rounded py-2 ${
                  mode === "external" ? "bg-white/10 text-white" : "text-gray-400"
                }`}
              >
                <Wallet className="mr-1 inline h-4 w-4" /> External
              </button>
            </div>

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
                <label className="mb-2 block text-sm text-gray-400">
                  {mode === "internal" ? "Recipient Email/Username" : "Recipient Address"}
                </label>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder={mode === "internal" ? "email@example.com" : "0x..."}
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

              <div className="mb-4 rounded-lg bg-white/5 p-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Fee</span>
                  <span className="font-mono text-white">0 {coinOf(selected)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">You send</span>
                  <span className="font-mono text-white">
                    {amount || "0.00"} {coinOf(selected)}
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
                className="w-full rounded-lg bg-tiger-orange py-3 font-bold text-white disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Transfer"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
