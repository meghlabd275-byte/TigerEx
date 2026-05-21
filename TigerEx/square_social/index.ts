/** Square Social - Community platform */

export class SquarePlatform { async post(content: string): Promise<string> { return `POST-${Date.now()}`; } async like(postId: string): Promise<void> { } }

/** Coinbase One - Subscription */
export class CoinbaseOne { async subscribe(): Promise<void> { } async getFeeDiscount(): Promise<number> { return 0; }}