pub mod network {
    use std::net::TcpListener;
    use std::io::{Read, Write};
    
    pub struct Server {
        addr: String,
    }
    
    impl Server {
        pub fn new(addr: &str) -> Self {
            Server { addr: addr.to_string() }
        }
        
        pub fn listen(&self) -> std::io::Result<()> {
            let listener = TcpListener::bind(&self.addr)?;
            println!("Listening on {}", self.addr);
            
            for stream in listener.incoming() {
                let mut stream = stream?;
                let mut buffer = [0; 1024];
                stream.read(&mut buffer)?;
                
                let response = b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nHello";
                stream.write(response)?;
            }
            Ok(())
        }
    }
    
    pub struct Client {
        addr: String,
    }
    
    impl Client {
        pub fn connect(addr: &str) -> std::io::Result<Self> {
            Ok(Client { addr: addr.to_string() })
        }
    }
}