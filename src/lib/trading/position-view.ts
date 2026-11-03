/**
 * Position payload shared by the futures routes.
 *
 * The trading terminal reads a mix of camelCase and snake_case keys, so both
 * are emitted from one mapper rather than repeated in each route.
 */

export interface PositionPayload {
  id: string;
  positionId: string;
  symbol: string;
  contract_symbol: string;
  side: string;
  quantity: number;
  entry_price: number;
  entryPrice: number;
  mark_price: number;
  markPrice: number;
  leverage: number;
  margin_mode: string;
  marginMode: string;
  position_mode: string;
  margin: number;
  liquidation_price: number;
  liquidationPrice: number;
  unrealized_pnl: number;
  unrealizedPnl: number;
  realized_pnl: number;
  realizedPnl: number;
  status: string;
  openedAt: unknown;
}

export function toPositionPayload(row: Record<string, unknown>): PositionPayload {
  return {
    id: String(row.position_id),
    positionId: String(row.position_id),
    symbol: String(row.symbol),
    contract_symbol: String(row.symbol),
    side: String(row.side),
    quantity: Number(row.quantity),
    entry_price: Number(row.entry_price),
    entryPrice: Number(row.entry_price),
    mark_price: Number(row.mark_price),
    markPrice: Number(row.mark_price),
    leverage: Number(row.leverage),
    margin_mode: String(row.margin_mode),
    marginMode: String(row.margin_mode),
    position_mode: String(row.position_mode),
    margin: Number(row.margin),
    liquidation_price: Number(row.liquidation_price),
    liquidationPrice: Number(row.liquidation_price),
    unrealized_pnl: Number(row.unrealized_pnl),
    unrealizedPnl: Number(row.unrealized_pnl),
    realized_pnl: Number(row.realized_pnl),
    realizedPnl: Number(row.realized_pnl),
    status: String(row.status),
    openedAt: row.opened_at,
  };
}
