/**
 * TigerEx NFT Storage & IPFS
 * 
 * IPFS pinning, NFT metadata storage,
 *-Arweave backup, CDN delivery
 */

import { EventEmitter } from 'events';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export enum StorageProvider {
  IPFS = 'ipfs',
  ARWEAVE = 'arweave',
  AWS_S3 = 'aws_s3',
  PINATA = 'pinata',
  NFT_STORAGE = 'nft_storage',
  WEB3_STORAGE = 'web3_storage'
}

export enum ContentType {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  MODEL_3D = 'model_3d',
  PDF = 'pdf',
  JSON = 'json'
}

export interface StoredContent {
  id: string;
  cid: string;
  provider: StorageProvider;
  contentType: ContentType;
  size: number;
  mimeType: string;
  uploadedAt: number;
  pinned: boolean;
  pinExpiry?: number;
  gatewayUrls: string[];
}

export interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  external_url?: string;
  background_color?: string;
  attributes: {
    trait_type: string;
    value: string | number;
    display_type?: string;
  }[];
  properties: {
    files: { uri: string; type: string; cdn?: boolean }[];
    category: string;
    creators: { address: string; share: number }[];
  };
}

export interface PinRequest {
  cid: string;
  expiry?: number;
}

export interface GatewayConfig {
  subdomain: boolean;
  customDomain?: string;
  cacheRules: {
    enableCache: boolean;
    ttl: number;
  };
}

// ============================================================================
// NFT STORAGE SERVICE
// ============================================================================

export class NFTStorageService {
  private contents: Map<string, StoredContent> = new Maps();
  private pinQueue: Map<string, PinRequest> = new Maps();
  private counter = 1;

  // Upload content
  async upload(params: {
    data: Buffer;
    contentType: ContentType;
    mimeType: string;
    provider: StorageProvider;
  }): Promise<{ cid: string; gatewayUrl: string }> {
    const cid = `Qm${Math.random().toString(36).substr(2, 44)}`;
    const gatewayUrl = `https://${cid}.ipfs.tigerex.com`;

    const content: StoredContent = {
      id: `cnt_${this.counter++}`,
      cid,
      provider: params.provider,
      contentType: params.contentType,
      size: params.data.length,
      mimeType: params.mimeType,
      uploadedAt: Date.now(),
      pinned: params.provider === StorageProvider.NFT_STORAGE,
      gatewayUrls: [gatewayUrl]
    };

    this.contents.set(content.id, content);
    return { cid, gatewayUrl };
  }

  async uploadMetadata(metadata: NFTMetadata, provider: StorageProvider): Promise<{ cid: string; url: string }> {
    const data = Buffer.from(JSON.stringify(metadata));
    const result = await this.upload({
      data,
      contentType: ContentType.JSON,
      mimeType: 'application/json',
      provider
    });

    return {
      cid: result.cid,
      url: result.gatewayUrl
    };
  }

  // Retrieve content
  async getContent(cid: string): Promise<StoredContent | null> {
    return Array.from(this.contents.values())
      .find(c => c.cid === cid) || null;
  }

  async downloadContent(cid: string): Promise<{ data: Buffer; mimeType: string } | null> {
    const content = await this.getContent(cid);
    if (!content) return null;

    return {
      data: Buffer.alloc(content.size),
      mimeType: content.mimeType
    };
  }

  // Pin content (keep alive)
  async pinContent(cid: string, expiry?: number): Promise<{ pinned: boolean }> {
    const content = await this.getContent(cid);
    if (!content) return { pinned: false };

    content.pinned = true;
    content.pinExpiry = expiry || (Date.now() + 365 * 24 * 60 * 60 * 1000);

    return { pinned: true };
  }

  async unpinContent(cid: string): Promise<{ unpinned: boolean }> {
    const content = await this.getContent(cid);
    if (!content) return { unpinned: false };

    content.pinned = false;
    return { unpinned: true };
  }

  // Batch upload
  async batchUpload(files: {
    data: Buffer;
    name: string;
    contentType: ContentType;
  }[]): Promise<{ uploaded: { cid: string; name: string }[] }> {
    const uploaded: { cid: string; name: string }[] = [];

    for (const file of files) {
      const result = await this.upload({
        data: file.data,
        contentType: file.contentType,
        mimeType: this.getMimeType(file.name),
        provider: StorageProvider.NFT_STORAGE
      });
      uploaded.push({ cid: result.cid, name: file.name });
    }

    return { uploaded };
  }

  private getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      json: 'application/json'
    };
    return types[ext || ''] || 'application/octet-stream';
  }

  // IPNS (mutable names)
  async createIPNS(name: string, contentcid: string): Promise<{ ipnsKey: string }> {
    return { ipnsKey: `${name.replace(/\s+/g, '-').toLowerCase()}.tigerex.com` };
  }

  async updateIPNS(ipnsKey: string, newCid: string): Promise<{ updated: boolean }> {
    return { updated: true };
  }

  // Gateway config
  async getGatewayConfig(): Promise<GatewayConfig> {
    return {
      subdomain: true,
      cacheRules: {
        enableCache: true,
        ttl: 86400
      }
    };
  }

  // Analytics
  async getStorageStats(): Promise<{
    totalStored: number;
    totalSize: number;
    pinnedCount: number;
    providers: Record<string, number>;
  }> {
    const contents = Array.from(this.contents.values());

    return {
      totalStored: contents.length,
      totalSize: contents.reduce((sum, c) => sum + c.size, 0),
      pinnedCount: contents.filter(c => c.pinned).length,
      providers: {
        nft_storage: contents.filter(c => c.provider === StorageProvider.NFT_STORAGE).length,
        ipfs: contents.filter(c => c.provider === StorageProvider.IPFS).length,
        arweave: contents.filter(c => c.provider === StorageProvider.ARWEAVE).length
      }
    };
  }
}

export const nftStorageService = new NFTStorageService();

export default NFTStorageService;
export { StorageProvider, ContentType, StoredContent, NFTMetadata, PinRequest, GatewayConfig };