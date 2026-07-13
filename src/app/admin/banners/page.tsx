'use client';

import { useState } from 'react';

interface Banner {
  id: string;
  title: string;
  image: string;
  link: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'scheduled' | 'expired';
}

export default function AdminBannersPage() {
  const [banners, setBanners] = useState<Banner[]>([
    { id: '1', title: 'New Year Promo', image: '/banners/newyear.jpg', link: '/promo/newyear', startDate: '2024-01-01', endDate: '2024-01-31', status: 'active' },
    { id: '2', title: 'Futures Launch', image: '/banners/futures.jpg', link: '/futures', startDate: '2024-02-01', endDate: '2024-02-28', status: 'scheduled' },
    { id: '3', title: 'Winter Sale', image: '/banners/winter.jpg', link: '/promo/winter', startDate: '2023-12-01', endDate: '2023-12-31', status: 'expired' },
  ]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">Banner Management</h1>
        
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Create New Banner</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input type="text" className="w-full px-3 py-2 border rounded-lg" placeholder="Banner title" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Link</label>
              <input type="text" className="w-full px-3 py-2 border rounded-lg" placeholder="/promo/link" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Start Date</label>
              <input type="date" className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">End Date</label>
              <input type="date" className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Banner Image</label>
              <input type="file" className="w-full px-3 py-2 border rounded-lg" accept="image/*" />
            </div>
          </div>
          <button className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Create Banner
          </button>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">Active Banners</h2>
          </div>
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Image</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Link</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {banners.map((banner) => (
                <tr key={banner.id}>
                  <td className="px-6 py-4 font-medium">{banner.title}</td>
                  <td className="px-6 py-4">
                    <div className="w-20 h-10 bg-gray-200 rounded"></div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{banner.link}</td>
                  <td className="px-6 py-4 text-sm">
                    {banner.startDate} - {banner.endDate}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      banner.status === 'active' ? 'bg-green-100 text-green-800' :
                      banner.status === 'scheduled' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {banner.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <button className="text-blue-600 hover:text-blue-800 mr-3">Edit</button>
                    <button className="text-red-600 hover:text-red-800">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
