pub mod storage {
    use std::fs::{File, OpenOptions};
    use std::io::{BufReader, BufWriter, Read, Write};
    use std::path::Path;
    
    #[derive(Debug, Clone)]
    pub struct BlobStore {
        path: String,
    }
    
    impl BlobStore {
        pub fn new(path: &str) -> Self {
            BlobStore { path: path.to_string() }
        }
        
        pub fn write(&self, key: &str, data: &[u8]) -> std::io::Result<()> {
            let path = format!("{}/{}", self.path, key);
            let file = OpenOptions::new()
                .create(true)
                .write(true)
                .open(path)?;
            let mut writer = BufWriter::new(file);
            writer.write_all(data)?;
            Ok(())
        }
        
        pub fn read(&self, key: &str) -> std::io::Result<Vec<u8>> {
            let path = format!("{}/{}", self.path, key);
            let file = File::open(path)?;
            let mut reader = BufReader::new(file);
            let mut data = Vec::new();
            reader.read_to_end(&mut data)?;
            Ok(data)
        }
        
        pub fn delete(&self, key: &str) -> std::io::Result<()> {
            let path = format!("{}/{}", self.path, key);
            std::fs::remove_file(path)?;
            Ok(())
        }
    }
}