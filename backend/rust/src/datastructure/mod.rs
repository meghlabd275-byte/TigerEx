// Data Structures - Advanced Collections
// Rust for custom data structures

use std::collections::{BinaryHeap, HashMap, HashSet};

// Priority queue item
#[derive(Debug, Clone)]
pub struct PriorityItem<T> {
    pub priority: i32,
    pub value: T,
}

impl<T> PartialOrd for PriorityItem<T> {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        other.priority.partial_cmp(&self.priority)
    }
}

impl<T> Ord for PriorityItem<T> {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        other.priority.cmp(&self.priority)
    }
}

impl<T> PartialEq for PriorityItem<T> {
    fn eq(&self, other: &Self) -> bool {
        self.priority == other.priority
    }
}

impl<T> Eq for PriorityItem<T> {}

// Trie node
#[derive(Debug, Clone)]
pub struct TrieNode {
    pub children: HashMap<char, TrieNode>,
    pub is_word: bool,
}

impl TrieNode {
    pub fn new() -> Self {
        TrieNode {
            children: HashMap::new(),
            is_word: false,
        }
    }
}

// Trie (prefix tree)
pub struct Trie {
    root: TrieNode,
    count: u32,
}

impl Trie {
    pub fn new() -> Self {
        Trie {
            root: TrieNode::new(),
            count: 0,
        }
    }

    // Insert word
    pub fn insert(&mut self, word: &str) {
        let mut node = &mut self.root;

        for ch in word.chars() {
            node = node.children.entry(ch).or_insert_with(TrieNode::new);
        }

        node.is_word = true;
        self.count += 1;
    }

    // Contains word
    pub fn contains(&self, word: &str) -> bool {
        let mut node = &self.root;

        for ch in word.chars() {
            match node.children.get(&ch) {
                Some(n) => node = n,
                None => return false,
            }
        }

        node.is_word
    }

    // Starts with prefix
    pub fn starts_with(&self, prefix: &str) -> bool {
        let mut node = &self.root;

        for ch in prefix.chars() {
            match node.children.get(&ch) {
                Some(n) => node = n,
                None => return false,
            }
        }

        true
    }

    // Word count
    pub fn len(&self) -> u32 {
        self.count
    }
}

// Disjoint set (union-find)
pub struct DisjointSet {
    parent: HashMap<u32, u32>,
    rank: HashMap<u32, u32>,
}

impl DisjointSet {
    pub fn new() -> Self {
        DisjointSet {
            parent: HashMap::new(),
            rank: HashMap::new(),
        }
    }

    // Make set
    pub fn make_set(&mut self, x: u32) {
        self.parent.insert(x, x);
        self.rank.insert(x, 0);
    }

    // Find with path compression
    pub fn find(&mut self, x: u32) -> u32 {
        if !self.parent.contains_key(&x) {
            return x;
        }

        if self.parent[&x] == x {
            return x;
        }

        let root = self.find(self.parent[&x]);
        self.parent.insert(x, root);
        root
    }

    // Union by rank
    pub fn union(&mut self, x: u32, y: u32) {
        let rx = self.find(x);
        let ry = self.find(y);

        if rx == ry {
            return;
        }

        let rank_x = self.rank[&rx];
        let rank_y = self.rank[&ry];

        if rank_x < rank_y {
            self.parent.insert(rx, ry);
        } else if rank_x > rank_y {
            self.parent.insert(ry, rx);
        } else {
            self.parent.insert(rx, ry);
            self.rank.insert(ry, rank_y + 1);
        }
    }

    // Connected
    pub fn connected(&mut self, x: u32, y: u32) -> bool {
        self.find(x) == self.find(y)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trie() {
        let mut trie = Trie::new();

        trie.insert("hello");
        trie.insert("help");

        assert!(trie.contains("hello"));
        assert!(trie.starts_with("hel"));
    }
}