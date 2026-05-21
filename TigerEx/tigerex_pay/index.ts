/** Crypto Pay Platform */
export class CryptoPayPlatform { async pay(to: string, asset: string, amount: number): Promise<string> { return `PAY-${Date.now()}`; }}

/** Crypto Card Platform */
export class CryptoCardPlatform { async order(): Promise<string> { return `CARD-${Date.now()}`; } async spend(tx: string): Promise<void> { }}