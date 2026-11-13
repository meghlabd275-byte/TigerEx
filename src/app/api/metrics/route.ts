import { collectMetrics, renderPrometheus } from '@/lib/ops/metrics';
import { NO_STORE } from '@/lib/api/route-guards';

/**
 * Prometheus metrics endpoint.
 *
 * Served in the Prometheus text exposition format. The body contains only
 * aggregate counts and process gauges, never per-user data.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const body = renderPrometheus(collectMetrics());
  return new Response(body, {
    status: 200,
    headers: {
      ...NO_STORE,
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
    },
  });
}
