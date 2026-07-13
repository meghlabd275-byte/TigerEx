'use client';

import { useState } from 'react';

interface KYCSubmission {
  id: string;
  userId: string;
  username: string;
  level: number;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: string;
  documents: string[];
}

export default function AdminKYCPanel() {
  const [submissions, setSubmissions] = useState<KYCSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleReview = async (submissionId: string, action: 'approve' | 'reject') => {
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`/api/admin/kyc/${submissionId}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (data.success) {
        alert(`KYC ${action}d successfully`);
      }
    } catch (error) {
      console.error('Failed to review KYC:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">KYC Verification</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Pending Review</div>
            <div className="text-2xl font-bold text-yellow-600">23</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Approved Today</div>
            <div className="text-2xl font-bold text-green-600">45</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Rejected Today</div>
            <div className="text-2xl font-bold text-red-600">5</div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">Pending Submissions</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {[
              { id: '1', userId: 'usr_123', username: 'john_doe', level: 2, status: 'pending', submittedAt: '2024-01-15 14:30', documents: ['ID Card', 'Selfie'] },
              { id: '2', userId: 'usr_456', username: 'jane_smith', level: 1, status: 'pending', submittedAt: '2024-01-15 12:15', documents: ['Passport'] },
              { id: '3', userId: 'usr_789', username: 'bob_wilson', level: 3, status: 'pending', submittedAt: '2024-01-15 10:45', documents: ['ID Card', 'Proof of Address', 'Selfie'] },
            ].map((sub) => (
              <div key={sub.id} className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{sub.username}</span>
                      <span className="text-sm text-gray-500">Level {sub.level}</span>
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      Submitted: {sub.submittedAt}
                    </div>
                    <div className="text-sm text-gray-500">
                      Documents: {sub.documents.join(', ')}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReview(sub.id, 'approve')}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleReview(sub.id, 'reject')}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
