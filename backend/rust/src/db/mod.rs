pub mod db {
    use std::collections::HashMap;
    
    #[derive(Debug, Clone)]
    pub struct Record {
        pub id: String,
        pub data: HashMap<String, String>,
    }
    
    pub struct Database {
        records: HashMap<String, Record>,
    }
    
    impl Database {
        pub fn new() -> Self {
            Database { records: HashMap::new() }
        }
        
        pub fn insert(&mut self, record: Record) {
            self.records.insert(record.id.clone(), record);
        }
        
        pub fn get(&self, id: &str) -> Option<&Record> {
            self.records.get(id)
        }
        
        pub fn delete(&mut self, id: &str) -> Option<Record> {
            self.records.remove(id)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_db() {
        let mut db = db::Database::new();
        let rec = db::Record {
            id: "1".to_string(),
            data: HashMap::new(),
        };
        db.insert(rec);
        assert!(db.get("1").is_some());
    }
}