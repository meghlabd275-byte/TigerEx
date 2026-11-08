import { NextRequest } from 'next/server';
import { requireApiKey, v1Error, v1Ok } from '@/lib/api/v1-guard';
import { getOrder, cancelSpotOrder, SpotError } from '@/lib/trading/spot-engine';

/** Fetch one of the key owner's orders. Requires the `read` permission. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await requireApiKey(request, 'read', '');
  if ('error' in auth) return auth.error;

  const order = getOrder(auth.identity.userId, id);
  if (!order) return v1Error('ORDER_NOT_FOUND', 'No order with that id', 404);
  return v1Ok({ order });
}

/** Cancel one of the key owner's resting orders. Requires the `trade` permission. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await requireApiKey(request, 'trade', '');
  if ('error' in auth) return auth.error;

  try {
    const order = cancelSpotOrder(auth.identity.userId, id);
    return v1Ok({ order });
  } catch (error) {
    if (error instanceof SpotError) return v1Error(error.code, error.message, error.status);
    throw error;
  }
}
