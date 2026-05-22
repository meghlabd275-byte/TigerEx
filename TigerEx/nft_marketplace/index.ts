/**
 * TigerEx NFT Marketplace - Complete NFT Trading Platform
 * 
 * Comprehensive NFT marketplace like Crypto.com NFT, OpenSea, Binance NFT
 * Features: Minting, Collections, Trading, Auctions, Staking, NFT-backed loans
 */

import { EventEmitter } from 'events';
import { Logger } from '../common/logger';
import { Database } from '../database_schema';

// ============================================================
// NFT TYPES & INTERFACES
// ============================================================

export enum NFTStandard {
  ERC721 = 'ERC721',
  ERC1155 = 'ERC1155',
  SOL = 'SPL',
  TON = 'TON'
}

export enum NftCategory {
  ART = 'Art',
  COLLECTIBLE = 'Collectible',
  GAMING = 'Gaming',
  SPORTS = 'Sports',
  MUSIC = 'Music',
  DOMAIN = 'Domain',
  UTILITY = 'Utility',
  PFP = 'PFP'
}

export enum AuctionType {
  ENGLISH = 'english',
  DUTCH = 'dutch',
  SEALED_BID = 'sealed_bid',
  FIXED_PRICE = 'fixed_price'
}

export enum SaleStatus {
  LISTED = 'listed',
  SOLD = 'sold',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired'
}

export interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  external_url?: string;
  attributes: NFTAttribute[];
  animation_url?: string;
  background_color?: string;
}

export interface NFTAttribute {
  trait_type: string;
  value: string | number;
  display_type?: string;
}

export interface NFTCollection {
  id: string;
  name: string;
  symbol: string;
  description: string;
  creator: string;
  owner: string;
  standard: NFTStandard;
  category: NftCategory;
  royalty_fee: number; // 0-10000 = 0-100%
  blockchain: string;
  total_supply: number;
  minted_count: number;
  floor_price: number;
  listed_count: number;
  volume_traded: number;
  verified: boolean;
  featured: boolean;
  created_at: Date;
}

export interface NFT {
  id: string;
  collection_id: string;
  token_id: string;
  owner: string;
  creator: string;
  metadata: NFTMetadata;
  standard: NFTStandard;
  blockchain: string;
  uri: string;
  is_listed: boolean;
  listing_price?: number;
  listing_currency?: string;
  auction_type?: AuctionType;
  auction_end?: Date;
  bids: NFTAuctionBid[];
  provenance: NFTTransfer[];
  rarity_rank?: number;
  status: 'owned' | 'burned';
  created_at: Date;
  updated_at: Date;
}

export interface NFTAuctionBid {
  bidder: string;
  amount: number;
  currency: string;
  timestamp: Date;
  tx_hash: string;
}

export interface NFTTransfer {
  from: string;
  to: string;
  price: number;
  currency: string;
  timestamp: Date;
  tx_hash: string;
}

export interface NFTListing {
  nft_id: string;
  seller: string;
  price: number;
  currency: string;
  auction_type?: AuctionType;
  start_price?: number;
  end_price?: number;
  start_time?: Date;
  end_time?: Date;
  status: SaleStatus;
  created_at: Date;
}

export interface NFTOffer {
  id: string;
  nft_id: string;
  buyer: string;
  amount: number;
  currency: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  expires_at: Date;
  created_at: Date;
}

// ============================================================
// NFT MARKETPLACE CLASS
// ============================================================

export class NFTMarketplace {
  private logger: Logger;
  private db: Database;
  private collections: Map<string, NFTCollection> = new Map();
  private nfts: Map<string, NFT> = new Map();
  private listings: Map<string, NFTListing> = new Map();
  private offers: Map<string, NFTOffer> = new Map();
  private eventEmitter: EventEmitter;
  
  private readonly ROYALTY_FEE_MIN = 0;
  private readonly ROYALTY_FEE_MAX = 1000; // 10% max
  private readonly LISTING_FEE = 0;
  private readonly PLATFORM_FEE_SELLER = 250; // 2.5% seller fee
  private readonly PLATFORM_FEE_BUYER = 0;
  
  constructor(db: Database) {
    this.db = db;
    this.logger = new Logger('NFTMarketplace');
    this.eventEmitter = new EventEmitter();
  }

  // Collection Management
  async createCollection(params: {
    name: string;
    symbol: string;
    description: string;
    category: NftCategory;
    standard: NFTStandard;
    blockchain: string;
    royalty_fee: number;
    creator: string;
  }): Promise<NFTCollection> {
    if (params.royalty_fee < this.ROYALTY_FEE_MIN || params.royalty_fee > this.ROYALTY_FEE_MAX) {
      throw new Error(`Royalty fee must be between ${this.ROYALTY_FEE_MIN/100}% and ${this.ROYALTY_FEE_MAX/100}%`);
    }

    const collection: NFTCollection = {
      id: this.generateId(),
      name: params.name,
      symbol: params.symbol.toUpperCase(),
      description: params.description,
      creator: params.creator,
      owner: params.creator,
      standard: params.standard,
      category: params.category,
      royalty_fee: params.royalty_fee,
      blockchain: params.blockchain,
      total_supply: 0,
      minted_count: 0,
      floor_price: 0,
      listed_count: 0,
      volume_traded: 0,
      verified: false,
      featured: false,
      created_at: new Date()
    };

    this.collections.set(collection.id, collection);
    this.eventEmitter.emit('collection_created', collection);
    this.logger.info(`Collection created: ${collection.id} - ${collection.name}`);
    return collection;
  }

  async getCollection(collectionId: string): Promise<NFTCollection | null> {
    return this.collections.get(collectionId) || null;
  }

  async getTrendingCollections(limit: number = 10): Promise<NFTCollection[]> {
    return Array.from(this.collections.values())
      .sort((a, b) => b.volume_traded - a.volume_traded)
      .slice(0, limit);
  }

  // NFT Minting
  async mintNFT(params: {
    collection_id: string;
    owner: string;
    creator: string;
    metadata: NFTMetadata;
    standard: NFTStandard;
    blockchain: string;
  }): Promise<NFT> {
    const collection = this.collections.get(params.collection_id);
    if (!collection) {
      throw new Error('Collection not found');
    }

    if (!params.metadata.name || !params.metadata.image) {
      throw new Error('Invalid metadata: name and image are required');
    }

    const tokenId = String(collection.minted_count + 1);
    const uri = `https://nft.tigerex.com/${params.collection_id}/${tokenId}`;

    const nft: NFT = {
      id: this.generateId(),
      collection_id: params.collection_id,
      token_id: tokenId,
      owner: params.owner,
      creator: params.creator,
      metadata: params.metadata,
      standard: params.standard,
      blockchain: params.blockchain,
      uri: uri,
      is_listed: false,
      bids: [],
      provenance: [{
        from: '0x0000000000000000000000000000000000000000',
        to: params.owner,
        price: 0,
        currency: '',
        timestamp: new Date(),
        tx_hash: ''
      }],
      status: 'owned',
      created_at: new Date(),
      updated_at: new Date()
    };

    this.nfts.set(nft.id, nft);
    collection.minted_count++;
    collection.total_supply++;
    this.collections.set(params.collection_id, collection);

    this.eventEmitter.emit('nft_minted', nft);
    this.logger.info(`NFT minted: ${nft.id} in collection ${params.collection_id}`);
    return nft;
  }

  async batchMintNFT(params: {
    collection_id: string;
    owner: string;
    creator: string;
    metadatas: NFTMetadata[];
    standard: NFTStandard;
    blockchain: string;
  }): Promise<NFT[]> {
    const results: NFT[] = [];
    for (const metadata of params.metadatas) {
      const nft = await this.mintNFT({
        collection_id: params.collection_id,
        owner: params.owner,
        creator: params.creator,
        metadata: metadata,
        standard: params.standard,
        blockchain: params.blockchain
      });
      results.push(nft);
    }
    return results;
  }

  // NFT Listing & Trading
  async listNFT(params: {
    nft_id: string;
    seller: string;
    price: number;
    currency: string;
  }): Promise<NFTListing> {
    const nft = this.nfts.get(params.nft_id);
    if (!nft) throw new Error('NFT not found');
    if (nft.owner !== params.seller) throw new Error('Not the owner');
    if (nft.is_listed) throw new Error('Already listed');

    const listing: NFTListing = {
      nft_id: params.nft_id,
      seller: params.seller,
      price: params.price,
      currency: params.currency,
      status: SaleStatus.LISTED,
      created_at: new Date()
    };

    nft.is_listed = true;
    nft.listing_price = params.price;
    nft.listing_currency = params.currency;
    nft.updated_at = new Date();
    this.nfts.set(params.nft_id, nft);

    this.listings.set(`${params.nft_id}_${Date.now()}`, listing);
    this.eventEmitter.emit('nft_listed', { nft, listing });
    return listing;
  }

  async listForAuction(params: {
    nft_id: string;
    seller: string;
    start_price: number;
    auction_type: AuctionType;
    duration_hours: number;
  }): Promise<NFTListing> {
    const nft = this.nfts.get(params.nft_id);
    if (!nft || nft.owner !== params.seller) throw new Error('NFT not found or not owner');

    const endTime = new Date(Date.now() + params.duration_hours * 3600000);
    
    const listing: NFTListing = {
      nft_id: params.nft_id,
      seller: params.seller,
      price: params.start_price,
      currency: 'USDT',
      auction_type: params.auction_type,
      start_price: params.start_price,
      end_time: endTime,
      status: SaleStatus.LISTED,
      created_at: new Date()
    };

    nft.is_listed = true;
    nft.listing_price = params.start_price;
    nft.listing_currency = 'USDT';
    nft.auction_type = params.auction_type;
    nft.auction_end = endTime;
    this.nfts.set(params.nft_id, nft);

    this.listings.set(`${params.nft_id}_auction`, listing);
    return listing;
  }

  async placeBid(params: {
    nft_id: string;
    bidder: string;
    amount: number;
    currency: string;
  }): Promise<NFTAuctionBid> {
    const nft = this.nfts.get(params.nft_id);
    if (!nft) throw new Error('NFT not found');
    if (!nft.is_listed || nft.auction_type === undefined) throw new Error('Not listed for auction');

    const currentHighest = nft.bids[nft.bids.length - 1];
    if (currentHighest && params.amount <= currentHighest.amount) {
      throw new Error('Bid must be higher than current highest');
    }

    const bid: NFTAuctionBid = {
      bidder: params.bidder,
      amount: params.amount,
      currency: params.currency,
      timestamp: new Date(),
      tx_hash: this.generateTxHash()
    };

    nft.bids.push(bid);
    nft.updated_at = new Date();
    this.nfts.set(params.nft_id, nft);

    this.eventEmitter.emit('bid_placed', { nft_id: params.nft_id, bid });
    return bid;
  }

  async buyNFT(params: {
    nft_id: string;
    buyer: string;
  }): Promise<{ tx_hash: string; nft: NFT }> {
    const nft = this.nfts.get(params.nft_id);
    if (!nft) throw new Error('NFT not found');
    if (!nft.is_listed || !nft.listing_price || !nft.listing_currency) {
      throw new Error('NFT not listed for sale');
    }

    const price = nft.listing_price;
    const previousOwner = nft.owner;
    nft.owner = params.buyer;
    nft.is_listed = false;
    nft.listing_price = undefined;
    nft.listing_currency = undefined;
    nft.updated_at = new Date();
    nft.provenance.push({
      from: previousOwner,
      to: params.buyer,
      price: price,
      currency: nft.listing_currency || 'USDT',
      timestamp: new Date(),
      tx_hash: this.generateTxHash()
    });

    this.nfts.set(params.nft_id, nft);

    const collection = this.collections.get(nft.collection_id);
    if (collection) {
      collection.volume_traded += price;
      collection.listed_count--;
      this.collections.set(nft.collection_id, collection);
    }

    this.eventEmitter.emit('nft_sold', { nft, price, seller: previousOwner, buyer: params.buyer });
    return { tx_hash: this.generateTxHash(), nft };
  }

  async cancelListing(params: { nft_id: string; seller: string }): Promise<void> {
    const nft = this.nfts.get(params.nft_id);
    if (!nft || nft.owner !== params.seller) throw new Error('Not authorized');
    nft.is_listed = false;
    nft.listing_price = undefined;
    nft.listing_currency = undefined;
    this.nfts.set(params.nft_id, nft);
  }

  // NFT Offers
  async makeOffer(params: {
    nft_id: string;
    buyer: string;
    amount: number;
    currency: string;
    expires_in_hours: number;
  }): Promise<NFTOffer> {
    const nft = this.nfts.get(params.nft_id);
    if (!nft) throw new Error('NFT not found');

    const offer: NFTOffer = {
      id: this.generateId(),
      nft_id: params.nft_id,
      buyer: params.buyer,
      amount: params.amount,
      currency: params.currency,
      status: 'pending',
      expires_at: new Date(Date.now() + params.expires_in_hours * 3600000),
      created_at: new Date()
    };

    this.offers.set(offer.id, offer);
    this.eventEmitter.emit('offer_made', offer);
    return offer;
  }

  async acceptOffer(params: { offer_id: string; seller: string }): Promise<void> {
    const offer = this.offers.get(params.offer_id);
    if (!offer || offer.status !== 'pending') throw new Error('Offer not found or not pending');

    const nft = this.nfts.get(offer.nft_id);
    if (!nft || nft.owner !== params.seller) throw new Error('Not authorized');

    const previousOwner = nft.owner;
    nft.owner = offer.buyer;
    nft.updated_at = new Date();
    nft.provenance.push({
      from: previousOwner,
      to: offer.buyer,
      price: offer.amount,
      currency: offer.currency,
      timestamp: new Date(),
      tx_hash: this.generateTxHash()
    });
    this.nfts.set(offer.nft_id, nft);

    offer.status = 'accepted';
    this.offers.set(params.offer_id, offer);
    this.eventEmitter.emit('offer_accepted', offer);
  }

  // NFT Staking
  async stakeNft(params: {
    nft_id: string;
    staker: string;
    duration_days: number;
  }): Promise<{
    stake_id: string;
    start_time: Date;
    unlock_time: Date;
    rewards_apr: number;
  }> {
    const nft = this.nfts.get(params.nft_id);
    if (!nft || nft.owner !== params.staker) throw new Error('Not authorized');

    const collection = this.collections.get(nft.collection_id);
    const baseApr = 5;
    const rarityBonus = collection?.verified ? 3 : 0;
    const durationBonus = Math.min(params.duration_days / 365 * 5, 10);

    return {
      stake_id: this.generateId(),
      start_time: new Date(),
      unlock_time: new Date(Date.now() + params.duration_days * 86400000),
      rewards_apr: baseApr + rarityBonus + durationBonus
    };
  }

  // NFT Loans
  async takeLoan(params: {
    nft_id: string;
    borrower: string;
    loan_amount: number;
    currency: string;
    loan_to_value: number;
    duration_days: number;
  }): Promise<{
    loan_id: string;
    principal: number;
    interest_rate: number;
    due_date: Date;
  }> {
    const nft = this.nfts.get(params.nft_id);
    if (!nft) throw new Error('NFT not found');

    const collection = this.collections.get(nft.collection_id);
    const estimatedValue = collection?.floor_price || 1000;
    const maxLoan = estimatedValue * (params.loan_to_value / 100);
    if (params.loan_amount > maxLoan) {
      throw new Error(`Maximum loan for this NFT: ${maxLoan}`);
    }

    const baseRate = 15;
    const durationRate = params.duration_days > 30 ? 5 : 0;

    return {
      loan_id: this.generateId(),
      principal: params.loan_amount,
      interest_rate: baseRate + durationRate,
      due_date: new Date(Date.now() + params.duration_days * 86400000)
    };
  }

  // Queries
  async getNFT(nftId: string): Promise<NFT | null> {
    return this.nfts.get(nftId) || null;
  }

  async getNFTsByCollection(collectionId: string, filters?: {
    owner?: string;
    listed_only?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<NFT[]> {
    let nfts = Array.from(this.nfts.values())
      .filter(n => n.collection_id === collectionId);

    if (filters?.owner) {
      nfts = nfts.filter(n => n.owner === filters.owner);
    }
    if (filters?.listed_only) {
      nfts = nfts.filter(n => n.is_listed);
    }
    if (filters?.offset) nfts = nfts.slice(filters.offset);
    if (filters?.limit) nfts = nfts.slice(0, filters.limit);
    return nfts;
  }

  async getListings(filters?: {
    category?: NftCategory;
    blockchain?: string;
    min_price?: number;
    max_price?: number;
    sort_by?: 'price' | 'created' | 'rarity';
  }): Promise<(NFT & { listing: NFTListing })[]> {
    let results: (NFT & { listing: NFTListing })[] = [];
    for (const nft of this.nfts.values()) {
      if (!nft.is_listed || !nft.listing_price) continue;
      const collection = this.collections.get(nft.collection_id);
      if (filters?.category && collection?.category !== filters.category) continue;
      if (filters?.blockchain && nft.blockchain !== filters.blockchain) continue;
      results.push({ ...nft, listing: {} as NFTListing });
    }
    return results;
  }

  async getUserNFTs(userAddress: string): Promise<NFT[]> {
    return Array.from(this.nfts.values()).filter(n => n.owner === userAddress);
  }

  async calculateRarity(nftId: string): Promise<number> {
    const nft = this.nfts.get(nftId);
    if (!nft) return 0;
    const collection = this.collections.get(nft.collection_id);
    if (!collection) return 0;
    const totalSupply = collection.minted_count;
    const rank = parseInt(nft.token_id);
    return Math.round((1 - rank / totalSupply) * 10000) / 100;
  }

  async getMarketplaceStats(): Promise<{
    total_collections: number;
    total_nfts: number;
    total_volume: number;
    floor_price_average: number;
  }> {
    let totalVolume = 0;
    let floorSum = 0;
    let floorCount = 0;
    for (const collection of this.collections.values()) {
      totalVolume += collection.volume_traded;
      if (collection.floor_price > 0) {
        floorSum += collection.floor_price;
        floorCount++;
      }
    }
    return {
      total_collections: this.collections.size,
      total_nfts: this.nfts.size,
      total_volume: totalVolume,
      floor_price_average: floorCount > 0 ? floorSum / floorCount : 0
    };
  }

  async transferNFT(params: { nft_id: string; from: string; to: string }): Promise<void> {
    const nft = this.nfts.get(params.nft_id);
    if (!nft || nft.owner !== params.from) throw new Error('Transfer not authorized');
    nft.owner = params.to;
    nft.updated_at = new Date();
    nft.provenance.push({
      from: params.from,
      to: params.to,
      price: 0,
      currency: '',
      timestamp: new Date(),
      tx_hash: this.generateTxHash()
    });
    this.nfts.set(params.nft_id, nft);
  }

  async burnNFT(params: { nft_id: string; owner: string }): Promise<void> {
    const nft = this.nfts.get(params.nft_id);
    if (!nft || nft.owner !== params.owner) throw new Error('Not authorized');
    nft.status = 'burned';
    nft.updated_at = new Date();
    this.nfts.set(params.nft_id, nft);
  }

  // Helpers
  private generateId(): string {
    return `nft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateTxHash(): string {
    return `0x${Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;
  }
}

// Export all types and classes
export { NFTMarketplace as default };