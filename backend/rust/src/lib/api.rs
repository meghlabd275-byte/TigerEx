pub fn route(request: &str) -> &'static str {
    if request.starts_with("/api/") {
        "API Handler"
    } else if request.starts_with("/ws") {
        "WebSocket Handler"
    } else {
        "Static Handler"
    }
}

pub struct Request {
    pub method: String,
    pub path: String,
    pub body: Vec<u8>,
}

pub struct Response {
    pub status: u16,
    pub body: Vec<u8>,
}

impl Response {
    pub fn new(status: u16) -> Self {
        Response { status, body: vec![] }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_route() {
        assert_eq!(route("/api/orders"), "API Handler");
    }
}