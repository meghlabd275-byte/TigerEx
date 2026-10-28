'use client';

import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApiResource } from '@/lib/useApiResource';

interface Role {
  role: string;
  permissions: string[];
}

interface AdminUser {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  permissions: string[];
}

interface PermissionsPayload {
  success?: boolean;
  data?: { roles?: Role[]; admins?: AdminUser[] };
}

export default function AdminPermissionsPage() {
  const permissions = useApiResource<PermissionsPayload>('/api/admin/permissions');

  const roles = useMemo(() => permissions.data?.data?.roles ?? [], [permissions.data]);
  const admins = useMemo(() => permissions.data?.data?.admins ?? [], [permissions.data]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Roles &amp; Permissions</h1>
          <button
            onClick={permissions.reload}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {permissions.loading && <p className="text-sm text-gray-500">Loading permissions…</p>}
        {permissions.error && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Permissions are unavailable: {permissions.error}
          </div>
        )}

        {!permissions.loading && !permissions.error && (
          <>
            <h2 className="mb-3 text-lg font-semibold">Role Catalogue</h2>
            {roles.length === 0 ? (
              <div className="mb-8 rounded-lg border bg-white px-4 py-8 text-center text-gray-500">
                No roles are defined.
              </div>
            ) : (
              <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
                {roles.map((role) => (
                  <div key={role.role} className="rounded-lg bg-white p-4 shadow">
                    <div className="mb-2 font-semibold">{role.role}</div>
                    <div className="flex flex-wrap gap-2">
                      {role.permissions.length === 0 ? (
                        <span className="text-sm text-gray-500">No permissions</span>
                      ) : (
                        role.permissions.map((permission) => (
                          <span
                            key={permission}
                            className="rounded bg-gray-100 px-2 py-1 font-mono text-xs text-gray-700"
                          >
                            {permission}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h2 className="mb-3 text-lg font-semibold">Administrators</h2>
            {admins.length === 0 ? (
              <div className="rounded-lg border bg-white px-4 py-8 text-center text-gray-500">
                No administrators are registered.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg bg-white shadow">
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-xs uppercase text-gray-500">
                      <th className="px-6 py-3">Email</th>
                      <th className="px-6 py-3">Username</th>
                      <th className="px-6 py-3">Role</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Permissions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {admins.map((admin) => (
                      <tr key={admin.id}>
                        <td className="px-6 py-4">{admin.email}</td>
                        <td className="px-6 py-4">{admin.username}</td>
                        <td className="px-6 py-4">{admin.role}</td>
                        <td className="px-6 py-4">{admin.status}</td>
                        <td className="px-6 py-4 font-mono text-xs">
                          {admin.permissions.join(', ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
