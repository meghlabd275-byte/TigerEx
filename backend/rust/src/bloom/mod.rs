// Bloom Filter - Probabilistic Set Membership
// Rust for fast bloom filter implementation

use std::collections::HashSet;

// Bloom filter
pub struct BloomFilter {
    bits: Vec<bool>,
    size: usize,
    hashes: usize,
    items: HashSet<String>,
}

impl BloomFilter {
    pub fn new(size: usize, hashes: usize) -> Self {
        BloomFilter {
            bits: vec![false; size],
            size,
            hashes,
            items: HashSet::new(),
        }
    }

    // Add element
    pub fn add(&mut self, item: &str) {
        self.items.insert(item.to_string());

        for i in 0..self.hashes {
            let idx = self.hash(item, i);
            self.bits[idx] = true;
        }
    }

    // Check membership
    pub fn contains(&self, item: &str) -> bool {
        for i in 0..self.hashes {
            let idx = self.hash(item, i);
            if !self.bits[idx] {
                return false;
            }
        }
        true
    }

    // Probability of false positive
    pub fn false_positive_rate(&self) -> f64 {
        let set_bits = self.bits.iter().filter(|&&b| b).count() as f64;
        let total_bits = self.size as f64;

        let k = self.hashes as f64;
        let m = self.size as f64;
        let n = self.items.len() as f64;

        if n == 0.0 {
            return 0.0;
        }

        (1.0 - (-k * n / m).exp().powf(k)
    }

    // Hash function
    fn hash(&self, item: &str, seed: usize) -> usize {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        let mut hasher = DefaultHasher::new();
        item.hash(&mut hasher);
        seed.hash(&mut hasher);
        
        (hasher.finish() as usize) % self.size
    }

    // Clear
    pub fn clear(&mut self) {
        self.bits = vec![false; self.size];
        self.items.clear();
    }

    // Count
    pub fn len(&self) -> usize {
        self.items.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bloom() {
        let mut bf = BloomFilter::new(1000, 3);

        bf.add("item1");
        bf.add("item2");

        assert!(bf.contains("item1"));
        assert!(!bf.contains("item3"));
    }
}