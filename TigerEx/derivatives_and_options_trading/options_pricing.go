// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title OptionsPricingEngine
 * @dev Complete options pricing and Greeks calculation system
 * Based on Black-Scholes model with real-time implied volatility
 */

library OptionsPricingEngine {
    
    // Constants
    uint256 public constant DAY = 86400;
    uint256 public constant YEAR = 365 days;
    int256 public constant SCALED = 1e18;
    
    struct OptionParams {
        uint256 spotPrice;
        uint256 strikePrice;
        uint256 timeToExpiry; // in seconds
        uint256 volatility;  // in basis points (e.g., 2500 = 25%)
        int256 riskFreeRate; // in basis points
        bool isCall;
        uint256 spotPriceTwo;
        uint256 dividendYield;
    }
    
    struct Greeks {
        int256 delta;
        int256 gamma;
        int256 theta;
        int256 vega;
        int256 rho;
        int256 lambda;
    }
    
    /**
     * @notice Calculate option price using Black-Scholes model
     * @param params Option parameters
     * @return optionPrice Calculated option price
     */
    function calculateOptionPrice(OptionParams memory params) 
        public 
        pure 
        returns (uint256) 
    {
        if (params.timeToExpiry == 0) {
            if (params.isCall) {
                return params.spotPrice > params.strikePrice 
                    ? params.spotPrice - params.strikePrice 
                    : 0;
            } else {
                return params.strikePrice > params.spotPrice 
                    ? params.strikePrice - params.spotPrice 
                    : 0;
            }
        }
        
        // Calculate d1 and d2
        (int256 d1, int256 d2) = _calculateD1D2(
            params.spotPrice,
            params.strikePrice,
            params.timeToExpiry,
            params.volatility,
            params.riskFreeRate,
            params.dividendYield
        );
        
        int256 sqrtT = _sqrt(int256(params.timeToExpiry));
        int256 sigma = int256(params.volatility);
        int256 expRT = _exp(-int256(params.riskFreeRate) * int256(props.timeToExpiry) / int256(YEAR));
        
        int256 price;
        if (params.isCall) {
            // Call option: S * N(d1) - K * e^(-rT) * N(d2)
            int256 nD1 = _cumulativeNormal(d1);
            int256 nD2 = _cumulativeNormal(d2);
            
            price = (
                int256(params.spotPrice) * nD1 / SCALED - 
                int256(params.strikePrice) * expRT * nD2 / (SCALED * SCALED)
            ) / SCALED;
        } else {
            // Put option: K * e^(-rT) * N(-d2) - S * N(-d1)
            int256 nNegD1 = _cumulativeNormal(-d1);
            int256 nNegD2 = _cumulativeNormal(-d2);
            
            price = (
                int256(params.strikePrice) * expRT * nNegD2 / (SCALED * SCALED) -
                int256(params.spotPrice) * nNegD1 / SCALED
            ) / SCALED;
        }
        
        return price > 0 ? uint256(price) : 0;
    }
    
    /**
     * @notice Calculate all Greeks for an option
     * @param params Option parameters
     * @return grk Calculated Greeks
     */
    function calculateGreeks(OptionParams memory params) 
        public 
        pure 
        returns (Greeks memory grk) 
    {
        if (params.timeToExpiry == 0) {
            return Greeks({
                delta: params.isCall ? int256(SCALED) : -int256(SCALED),
                gamma: 0,
                theta: 0,
                vega: 0,
                rho: 0,
                lambda: 0
            });
        }
        
        (int256 d1, int256 d2) = _calculateD1D2(
            params.spotPrice,
            params.strikePrice,
            params.timeToExpiry,
            params.volatility,
            params.riskFreeRate,
            params.dividendYield
        );
        
        int256 sqrtT = _sqrt(int256(params.timeToExpiry));
        int256 sigma = int256(params.volatility);
        
        // Standard normal CDF values
        int256 nD1 = _cumulativeNormal(d1);
        int256 nD2 = _cumulativeNormal(d2);
        int256 nd1 = _standardNormalPDF(d1); // PDF
        
        // Delta
        if (params.isCall) {
            // Call delta: N(d1)
            grk.delta = nD1;
        } else {
            // Put delta: N(d1) - 1
            grk.delta = nD1 - int256(SCALED);
        }
        
        // Gamma: phi(d1) / (S * sigma * sqrt(T))
        int256 denominator = int256(params.spotPrice) * sigma * sqrtT / SCALED;
        if (denominator != 0) {
            grk.gamma = nd1 * SCALED * SCALED / denominator / SCALED;
        }
        
        // Theta (per day)
        int256 term1 = -(int256(params.spotPrice) * nd1 * sigma) / (2 * sqrtT);
        int256 term2;
        
        if (params.isCall) {
            int256 expRT = _exp(-int256(params.riskFreeRate) * int256(params.timeToExpiry) / int256(YEAR));
            term2 = -int256(params.riskFreeRate) * int256(params.strikePrice) * expRT * nD2 / (SCALED * SCALED);
        } else {
            int256 expRT = _exp(-int256(params.riskFreeRate) * int256(params.timeToExpiry) / int256(YEAR));
            term2 = int256(params.riskFreeRate) * int256(params.strikePrice) * expRT * _cumulativeNormal(-d2) / (SCALED * SCALED);
        }
        
        grk.theta = (term1 + term2) / int256(DAY) / SCALED;
        
        // Vega (per 1% vol change)
        grk.vega = int256(params.spotPrice) * sqrtT * nd1 / SCALED / 100;
        
        // Rho (per 1% rate change)
        if (params.isCall) {
            int256 expRT = _exp(-int256(params.riskFreeRate) * int256(params.timeToExpiry) / int256(YEAR));
            grk.rho = int256(params.strikePrice) * int256(params.timeToExpiry) * expRT * nD2 / (SCALED * SCALED * YEAR * 100);
        } else {
            int256 expRT = _exp(-int256(params.riskFreeRate) * int256(params.timeToExpiry) / int256(YEAR));
            grk.rho = -int256(params.strikePrice) * int256(params.timeToExpiry) * expRT * _cumulativeNormal(-d2) / (SCALED * SCALED * YEAR * 100);
        }
        
        // Lambda (flexibility)
        if (grk.delta != 0) {
            grk.lambda = int256(params.spotPrice) * SCALED / grk.delta;
        }
    }
    
    /**
     * @notice Calculate implied volatility using Newton-Raphson
     * @param marketPrice Observed market price
     * @param params Other option parameters
     * @return impliedVol Calculated implied volatility
     */
    function calculateImpliedVolatility(
        uint256 marketPrice,
        OptionParams memory params
    ) public pure returns (uint256) {
        // Initial guess: 50% volatility
        uint256 sigma = 5000;
        uint256 epsilon = 100; // convergence threshold
        
        for (uint256 i = 0; i < 100; i++) {
            params.volatility = sigma;
            uint256 theoreticalPrice = calculateOptionPrice(params);
            Greeks memory greeks = calculateGreeks(params);
            
            int256 vega = greeks.vega;
            if (vega == 0) break;
            
            int256 diff = int256(marketPrice) - int256(theoreticalPrice);
            
            if (diff < 0) diff = -diff;
            if (diff < int256(epsilon)) break;
            
            // Newton-Raphson update
            int256 adjustment = diff * SCALED / vega;
            if (int256(marketPrice) < int256(theoreticalPrice)) {
                sigma = uint256(int256(sigma) - adjustment);
            } else {
                sigma = uint256(int256(sigma) + adjustment);
            }
            
            if (sigma < 100 || sigma > 50000) {
                sigma = 5000; // Reset if unstable
            }
        }
        
        return sigma;
    }
    
    // Internal helper functions
    
    function _calculateD1D2(
        uint256 S,
        uint256 K,
        uint256 T,
        uint256 sigma,
        int256 r,
        uint256 q
    ) internal pure returns (int256 d1, int256 d2) {
        int256 sqrtT = _sqrt(int256(T));
        
        int256 numerator = int256(
            _ln(int256(S) * SCALED / int256(K)) + 
            (int256(r) - int256(q) + int256(sigma) * int256(sigma) / SCALED) * int256(T) / int256(YEAR)
        ) * SCALED;
        
        d1 = numerator / (int256(sigma) * sqrtT);
        d2 = d1 - int256(sigma) * sqrtT / SCALED;
    }
    
    function _ln(int256 x) internal pure returns (int256) {
        return _log(x);
    }
    
    function _sqrt(int256 x) internal pure returns (int256) {
        if (x <= 0) return 0;
        
        int256 z = (x + SCALED) / 2;
        int256 y = x;
        
        for (uint256 i = 0; i < 256; i++) {
            if (z == y) break;
            y = z;
            z = (x / z + z) / 2;
        }
        
        return z;
    }
    
    function _exp(int256 x) internal pure returns (int256) {
        // Taylor series expansion for e^x
        int256 result = SCALED;
        int256 term = SCALED;
        
        for (uint256 i = 1; i < 100; i++) {
            term = term * x / int256(i) / SCALED;
            if (term == 0) break;
            result = result + term;
        }
        
        return result;
    }
    
    function _log(int256 x) internal pure returns (int256) {
        // Natural logarithm using Newton's method
        if (x <= 0) return type(int256).min;
        
        int256 result = 0;
        int256 y = x;
        
        while (y > 2 * SCALED) {
            y = y / 2;
            result += int256(693147180559945309); // ln(2)
        }
        
        y = y - SCALED;
        
        // Taylor series for ln(1 + y)
        int256 term = y;
        for (uint256 i = 1; i < 100; i++) {
            result = result + (i % 2 == 1 ? term : -term) / int256(i);
            term = term * y / SCALED;
            if (term == 0) break;
        }
        
        return result;
    }
    
    function _standardNormalPDF(int256 x) internal pure returns (int256) {
        // Standard normal probability density function
        // phi(x) = (1 / sqrt(2*pi)) * e^(-x^2 / 2)
        int256 pi = 314159265358979323;
        int256 sqrt2Pi = _sqrt(2 * pi);
        
        int256 exponent = -x * x / (2 * SCALED);
        int256 coeff = SCALED * SCALED / sqrt2Pi;
        
        return coeff * _exp(exponent) / SCALED;
    }
    
    function _cumulativeNormal(int256 x) internal pure returns (int256) {
        // Approximation of standard normal cumulative distribution
        // Using Abramowitz and Stegun approximation
        if (x < 0) {
            return SCALED - _cumulativeNormal(-x);
        }
        
        int256 pi = 314159265358979323;
        int256 sqrt2 = _sqrt(2 * SCALED);
        
        int256 a1 = 254829592707016;
        int256 a2 = -284296316377123;
        int256 a3 = 160641589752699;
        int256 a4 = -331588665972846;
        int256 a5 = -175384527982465;
        int256 a6 = 67086457347515;
        
        int256 p = 327025886500420;
        int256 q = 1106345424156766;
        
        int256 t = SCALED / (1 + int256(p) * x / int256(q));
        int256 t2 = t * t;
        
        int256 result = SCALED - _exp(-x * x / 2 * SCALED / SCALED) * SCALED / sqrt2 * t * (
            a1 + t * (
                a2 + t * (
                    a3 + t * (
                        a4 + t * (
                            a5 + t * a6
                        )
                    )
                )
            )
        ) / SCALED;
        
        return result;
    }
}