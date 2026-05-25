/**
 * NFT LENDING MODULE  
 * NFT Collateralized Lending Platform
 * 
 * Feature Availability: Only 1 of top 15 exchanges has this
 * Implemented for: Complete feature parity
 * Latest Update: 2024-2026
 */

'use strict';

/**
 * NFT Lending Pool
 * NFT-collateralized lending protocol
 */
class NFTLendingPool {
  constructor(config = {}) {
    this.name = config.name || 'NFT Lending Pool';
    this.collateralConfigs = new Map();
    this.loans = new Map();
    this.liquidations = new Map();
    this.oracle = config.priceOracle || {
      getFloorPrice: async () => BN(0),
    };
    this.liquidationEngine = config.liquidationEngine || {
      liquidate: async () => {},
    };
  }

  /**
   * NFT Collection Configuration
   * @param {Object} params - Collection parameters
   */
  async configureCollection(params) {
    const { collection, floorPriceMultiplier, maxLoanPercent, minLoanAmount, maxLoanAmount, liquidationThreshold, borrowApr, duration } = params;

    this.collateralConfigs.set(collection, {
      collection,
      floorPriceMultiplier: floorPriceMultiplier || 75, // 75% LTV by default
      maxLoanPercent: maxLoanPercent || 75,
      minLoanAmount: minLoanAmount || '100000000', // $100 minimum
      maxLoanAmount: maxLoanAmount || '100000000000', // $100k max
      liquidationThreshold: liquidationThreshold || 85, // 85% collateral ratio triggers liquidation
      borrowApr: borrowApr || 1500, // 15% APR
      duration: duration || 30 days, // Default 30 days
      acceptedNfts: [],
    });

    return { collection, status: 'CONFIGURED' };
  }

  /**
   * Accept NFT as collateral
   * @param {string} borrower - Borrower address
   * @param {string} collection - NFT collection
   * @param {string} tokenId - NFT token ID
   * @returns {Object} Collateral position
   */
  async acceptCollateral(borrower, collection, tokenId) {
    const config = this.collateralConfigs.get(collection);
    if (!config) {
      throw new Error('Collection not supported');
    }

    // Check floor price
    const floorPrice = await this.oracle.getFloorPrice(collection, tokenId);
    const maxLoan = BN(floorPrice).mul(BN(config.maxLoanPercent)).div(BN(10000));
    
    const positionId = this.generatePositionId(borrower, collection, tokenId);
    
    this.collateralConfigs.get(collection).acceptedNfts.push({
      tokenId,
      owner: borrower,
      floorPrice,
      maxLoan,
      positionId,
    });

    return {
      positionId,
      collection,
      tokenId,
      floorPrice,
      maxLoan: maxLoan.toString(),
      ltv: `${config.maxLoanPercent}%`,
      status: 'ACTIVE',
    };
  }

  /**
   * Borrow against NFT collateral
   * @param {Object} params - Borrow parameters
   * @returns {Object} Loan details
   */
  async borrow(params) {
    const { borrower, positionId, loanAmount, loanCurrency, duration } = params;
    
    // Get position
    const position = this.findPosition(positionId);
    if (!position || position.owner !== borrower) {
      throw new Error('Invalid position');
    }

    // Verify loan amount
    const config = this.collateralConfigs.get(position.collection);
    const maxLoan = BN(config.maxLoanAmount);
    const loanRequested = BN(loanAmount);

    if (loanRequested.gt(maxLoan)) {
      throw new Error('Exceeds maximum loan amount');
    }

    if (loanRequested.lt(BN(config.minLoanAmount))) {
      throw new Error('Below minimum loan amount');
    }

    // Calculate interest
    const apr = BN(config.borrowApr);
    const interest = loanRequested.mul(apr).mul(BN(duration || 30)).div(BN(365 * 10000));
    const totalRepayment = loanRequested.add(interest);

    // Create loan
    const loanId = this.generateLoanId(positionId);
    const dueDate = Math.floor(Date.now() / 1000) + (duration || 30) * 24 * 60 * 60;

    this.loans.set(loanId, {
      loanId,
      positionId,
      borrower,
      collection: position.collection,
      tokenId: position.tokenId,
      principal: loanAmount,
      currency: loanCurrency || 'USDC',
      interest: interest.toString(),
      totalRepayment: totalRepayment.toString(),
      apr: config.borrowApr,
      startTime: Math.floor(Date.now() / 1000),
      dueDate,
      status: 'ACTIVE',
      paidAmount: '0',
    });

    // Disburse funds
    await this.disburseFunds(borrower, loanAmount, loanCurrency);

    return {
      loanId,
      principal: loanAmount,
      interest: interest.toString(),
      totalRepayment: totalRepayment.toString(),
      dueDate,
      status: 'ACTIVE',
    };
  }

  /**
   * Repay loan
   * @param {string} loanId - Loan ID
   * @param {string} borrower - Borrower address
   * @returns {Object} Repayment confirmation
   */
  async repay(loanId, borrower) {
    const loan = this.loans.get(loanId);
    if (!loan) {
      throw new Error('Loan not found');
    }

    if (loan.borrower !== borrower) {
      throw new Error('Unauthorized');
    }

    // Process repayment
    await this.processRepayment(borrower, loan.totalRepayment, loan.currency);

    // Release collateral
    await this.releaseCollateral(loan.positionId, borrower, loan.collection, loan.tokenId);

    loan.status = 'REPAID';
    loan.paidAmount = loan.totalRepayment;
    loan.repaidAt = Math.floor(Date.now() / 1000);

    return {
      loanId,
      status: 'REPAID',
      repaidAmount: loan.totalRepayment,
    };
  }

  /**
   * Trigger liquidation
   * @param {string} positionId - Position ID
   * @return {Object} Liquidation result
   */
  async liquidate(positionId) {
    const loan = this.findLoanByPosition(positionId);
    if (!loan) {
      throw new Error('No active loan');
    }

    // Check collateral ratio
    const currentPrice = await this.oracle.getFloorPrice(loan.collection, loan.tokenId);
    const loanOutstanding = BN(loan.totalRepayment);
    const collateralRatio = currentPrice.mul(BN(10000)).div(loanOutstanding);

    const config = this.collateralConfigs.get(loan.collection);
    
    if (collateralRatio.lt(BN(config.liquidationThreshold * 100))) {
      const liquidationId = await this.liquidationEngine.liquidate({
        loan,
        currentPrice,
        collateralRatio: collateralRatio.toString(),
      });

      loan.status = 'LIQUIDATED';
      
      this.liquidations.set(liquidationId, {
        liquidationId,
        loanId: loan.loanId,
        positionId,
        liquidationPrice: currentPrice.toString(),
        collateralRatio: collateralRatio.toString(),
        timestamp: Math.floor(Date.now() / 1000),
      });

      return {
        liquidationId,
        status: 'LIQUIDATED',
        collateralSoldFor: currentPrice.toString(),
      };
    }

    return { status: 'NOT_LIQUIDABLE', collateralRatio: collateralRatio.toString() };
  }

  /**
   * Get loan position details
   * @param {string} positionId - Position ID
   * @returns {Object} Position details
   */
  async getPosition(positionId) {
    return this.findPosition(positionId);
  }

  /**
   * Get loan details
   * @param {string} loanId - Loan ID
   * @returns {Object} Loan details
   */
  async getLoan(loanId) {
    return this.loans.get(loanId);
  }

  /**
   * Get pool statistics
   * @returns {Object} Pool stats
   */
  async getPoolStats() {
    let totalLoans = BN(0);
    let totalCollateral = BN(0);
    let activeLoans = 0;
    let defaultedLoans = 0;

    for (const [id, loan] of this.loans) {
      totalLoans = totalLoans.add(BN(loan.principal));
      activeLoans++;
      
      if (loan.status === 'DEFAULTED') {
        defaultedLoans++;
      }
    }

    for (const [collection, config] of this.collateralConfigs) {
      for (const nft of config.acceptedNfts) {
        totalCollateral = totalCollateral.add(BN(nft.floorPrice));
      }
    }

    return {
      totalLoansIssued: totalLoans.toString(),
      totalCollateralValue: totalCollateral.toString(),
      activeLoanCount: activeLoans,
      defaultedLoanCount: defaultedLoans,
      collectionCount: this.collateralConfigs.size,
    };
  }

  /**
   * Extend loan duration
   * @param {string} loanId - Loan ID
   * @param {number} additionalDays - Additional days
   * @returns {Object} Extended loan
   */
  async extendLoan(loanId, additionalDays) {
    const loan = this.loans.get(loanId);
    if (!loan) {
      throw new Error('Loan not found');
    }

    // Calculate extension fee
    const extFee = BN(loan.principal).mul(BN(200)).mul(BN(additionalDays)).div(BN(365 * 10000));
    loan.extensionFee = extFee.toString();
    loan.dueDate += additionalDays * 24 * 60 * 60;

    return {
      loanId,
      newDueDate: loan.dueDate,
      extensionFee: extFee.toString(),
    };
  }

  /**
   * Helper: find position
   */
  findPosition(positionId) {
    for (const [collection, config] of this.collateralConfigs) {
      for (const nft of config.acceptedNfts) {
        if (nft.positionId === positionId) {
          return { ...nft, collection };
        }
      }
    }
    return null;
  }

  /**
   * Helper: find loan by position
   */
  findLoanByPosition(positionId) {
    for (const [id, loan] of this.loans) {
      if (loan.positionId === positionId && loan.status === 'ACTIVE') {
        return loan;
      }
    }
    return null;
  }

  /**
   * Helper: generate IDs
   */
  generatePositionId(borrower, collection, tokenId) {
    return `pos_${borrower.slice(2, 8)}_${collection.slice(2, 8)}_${tokenId}`;
  }

  generateLoanId(positionId) {
    return `loan_${positionId}_${Date.now()}`;
  }

  /**
   * Mock fund disbursement
   */
  async disburseFunds(recipient, amount, currency) {
    return { status: 'DISBURSED', recipient, amount, currency };
  }

  /**
   * Mock repayment processing
   */
  async processRepayment(sender, amount, currency) {
    return { status: 'PROCESSED', sender, amount, currency };
  }

  /**
   * Mock collateral release
   */
  async releaseCollateral(positionId, owner, collection, tokenId) {
    return { status: 'RELEASED', owner, collection, tokenId };
  }
}

/**
 * Flash Loan Protection
 */
class FlashLoanProtection {
  constructor(pool) {
    this.pool = pool;
    this.flashLoans = new Set();
  }

  /**
   * Block flash loan attacks
   */
  validateNoFlashLoan(sender) {
    if (this.flashLoans.has(sender)) {
      return false;
    }
    return true;
  }

  /**
   * Enable flash loan
   */
  enableFlashLoan(sender) {
    this.flashLoans.add(sender);
    setTimeout(() => this.flashLoans.delete(sender), 1);
  }
}

/**
 * NFT Lending Events
 */
const NFT_LENDING_EVENTS = {
  COLLATERAL_ACCEPTED: 'CollateralAccepted',
  LOAN_CREATED: 'LoanCreated',
  LOAN_REPAID: 'LoanRepaid',
  LOAN_LIQUIDATED: 'LoanLiquidated',
  LOAN_EXTENDED: 'LoanExtended',
  LIQUIDATION_TRIGGERED: 'LiquidationTriggered',
};

/**
 * Configuration Templates
 */
const PRESET_CONFIGS = {
  PFP_COLLECTION: {
    floorPriceMultiplier: 75,
    maxLoanPercent: 75,
    minLoanAmount: '500000000',
    maxLoanAmount: '50000000000',
    liquidationThreshold: 85,
    borrowApr: 1200,
    duration: 30 days,
  },
  ART_COLLECTION: {
    floorPriceMultiplier: 60,
    maxLoanPercent: 60,
    minLoanAmount: '1000000000',
    maxLoanAmount: '100000000000',
    liquidationThreshold: 75,
    borrowApr: 1800,
    duration: 60 days,
  },
  LAND_COLLECTION: {
    floorPriceMultiplier: 50,
    maxLoanPercent: 50,
    minLoanAmount: '5000000000',
    maxLoanAmount: '1000000000000',
    liquidationThreshold: 70,
    borrowApr: 2000,
    duration: 90 days,
  },
};

// Export module
module.exports = {
  NFTLendingPool,
  FlashLoanProtection,
  NFT_LENDING_EVENTS,
  PRESET_CONFIGS,
};