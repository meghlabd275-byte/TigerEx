pub mod observability {
    use std::sync::Mutex;
    use std::collections::HashMap;
    use std::time::{SystemTime, UNIX_EPOCH};
    
    #[derive(Debug, Clone)]
    pub struct Trace {
        pub trace_id: String,
        pub span_id: String,
        pub service: String,
        pub operation: String,
        pub start_time: u64,
        pub end_time: Option<u64>,
        pub tags: HashMap<String, String>,
    }
    
    impl Trace {
        pub fn new(service: &str, operation: &str) -> Self {
            Trace {
                trace_id: Trace::generate_id(),
                span_id: Trace::generate_id(),
                service: service.to_string(),
                operation: operation.to_string(),
                start_time: now_millis(),
                end_time: None,
                tags: HashMap::new(),
            }
        }
        
        fn generate_id() -> String {
            format!("{:x}", rand_u64())
        }
        
        pub fn set_tag(&mut self, key: &str, value: &str) {
            self.tags.insert(key.to_string(), value.to_string());
        }
        
        pub fn finish(&mut self) {
            self.end_time = Some(now_millis());
        }
        
        pub fn duration(&self) -> Option<u64> {
            self.end_time.map(|e| e - self.start_time)
        }
    }
    
    #[derive(Default)]
    pub struct Tracer {
        traces: Mutex<HashMap<String, Trace>>,
    }
    
    impl Tracer {
        pub fn new() -> Self {
            Tracer { traces: Mutex::new(HashMap::new()) }
        }
        
        pub fn start_trace(&self, service: &str, op: &str) -> String {
            let trace = Trace::new(service, op);
            let id = trace.trace_id.clone();
            self.traces.lock().unwrap().insert(id.clone(), trace);
            id
        }
        
        pub fn end_trace(&self, trace_id: &str) {
            if let Some(mut t) = self.traces.lock().unwrap().get_mut(trace_id) {
                t.finish();
            }
        }
        
        pub fn get_metrics(&self) -> HashMap<String, u64> {
            let traces = self.traces.lock().unwrap();
            let mut metrics = HashMap::new();
            
            for (_, t) in traces.iter() {
                if let Some(d) = t.duration() {
                    *metrics.entry(t.operation.clone()).or_insert(0) += d;
                }
            }
            metrics
        }
    }
    
    fn now_millis() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }
    
    fn rand_u64() -> u64 {
        use std::collections::hash_map::RandomState;
        std::hash::BuildHasher::gen_random_key(&RandomState::default(), 42)
    }
}