'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { DexShell, Panel, TableWrap, Th, Td } from '@/components/dex/DexShell';
import { useApiResource } from '@/lib/useApiResource';
import { apiRequest } from '@/lib/api/client-request';
import { formatAmount, formatNumber, formatPercent } from '@/lib/dex/format';

interface ProjectsResponse {
  projects: Array<{
    projectId: string;
    name: string;
    symbol: string;
    kind: string;
    totalSupply: number;
    price: number;
    raiseTarget: number;
    raised: number;
    sold: number;
    contributors: number;
    startAt: string | null;
    endAt: string | null;
    status: string;
    softCap: number | null;
    hardCap: number | null;
  }>;
}

export default function DexLaunchpadPage() {
  const projects = useApiResource<ProjectsResponse>('/api/dex/launchpad');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = projects.data?.projects ?? [];

  const contribute = async (projectId: string) => {
    setBusy(projectId);
    setMessage(null);
    try {
      const body = await apiRequest<{ result: { amount: number; tokens: number } }>('/api/dex/launchpad', {
        method: 'POST',
        body: { projectId, amount: Number(amounts[projectId]) },
      });
      setMessage({
        ok: true,
        text: `Contributed ${formatAmount(body.result.amount)} for ${formatAmount(body.result.tokens)} tokens.`,
      });
      setAmounts((current) => ({ ...current, [projectId]: '' }));
      projects.reload();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'The contribution was refused.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DexShell
      title="Launchpad"
      subtitle="Contribute to a launch. The contribution is settled through the ledger and the project's tokens are credited on the spot."
      actions={
        <button
          onClick={projects.reload}
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

      <Panel title="Launches">
        {projects.loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading launches…</p>}
        {projects.error && <p className="text-sm text-red-600 dark:text-red-400">{projects.error}</p>}
        {!projects.loading && rows.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400">
            No launch exists yet. An administrator opens a launch from the DEX admin console.
          </p>
        )}
        {rows.length > 0 && (
          <TableWrap>
            <thead>
              <tr>
                <Th>Project</Th>
                <Th>Kind</Th>
                <Th right>Price</Th>
                <Th right>Raised</Th>
                <Th right>Target</Th>
                <Th right>Progress</Th>
                <Th right>Contributors</Th>
                <Th>Status</Th>
                <Th right>Contribute</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((project) => {
                const progress = project.raiseTarget > 0 ? project.raised / project.raiseTarget : 0;
                const open = project.status === 'active';
                return (
                  <tr key={project.projectId}>
                    <Td>
                      {project.name} <span className="text-xs text-gray-400">({project.symbol})</span>
                    </Td>
                    <Td className="uppercase">{project.kind}</Td>
                    <Td right>{formatNumber(project.price, 6)}</Td>
                    <Td right>{formatAmount(project.raised)}</Td>
                    <Td right>{formatAmount(project.raiseTarget)}</Td>
                    <Td right>{formatPercent(progress)}</Td>
                    <Td right>{formatNumber(project.contributors, 0)}</Td>
                    <Td>{project.status}</Td>
                    <Td right>
                      <div className="flex items-center justify-end gap-2">
                        <input
                          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          type="number"
                          min="0"
                          value={amounts[project.projectId] ?? ''}
                          onChange={(event) =>
                            setAmounts((current) => ({ ...current, [project.projectId]: event.target.value }))
                          }
                        />
                        <button
                          onClick={() => contribute(project.projectId)}
                          disabled={busy !== null || !open}
                          title={open ? 'Contribute to this launch' : 'This launch is not open for contributions'}
                          className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-2 py-1 text-xs text-white hover:bg-orange-700 disabled:opacity-40"
                        >
                          {busy === project.projectId && <Loader2 className="h-3 w-3 animate-spin" />} Contribute
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </DexShell>
  );
}
