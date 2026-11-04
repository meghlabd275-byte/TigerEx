'use client';

import AdminResource, { type ResourceSpec } from '@/components/admin/AdminResource';

/** Announcements. */
const spec: ResourceSpec = {
  title: 'Announcements',
  description: 'Notices published to users, with a severity and a publish state.',
  endpoint: '/api/admin/announcements',
  rowsKey: 'data',
  columns: ['id', 'title', 'severity', 'status'],
};

export default function AdminAnnouncementsPage() {
  return <AdminResource spec={spec} />;
}
