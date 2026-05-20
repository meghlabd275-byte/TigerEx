# AI, Quant, and Research

> **Domain**: Machine learning, quantitative research, and fraud detection.

## Languages

### Python (Primary)
The AI ecosystem is unmatched:
- PyTorch
- TensorFlow
- Pandas
- NumPy
- scikit-learn
- Jupyter

### Rust
For performance-critical inference

### CUDA
GPU training and acceleration

## Use Cases

### fraud_detection_models/
Supervised learning for:
- Account takeover detection
- Wash trading identification
- Money laundering patterns
- Suspicious behavior scoring

### quantitative_research/
- Statistical arbitrage
- Volatility modeling
- Market microstructure analysis
- Backtesting frameworks

### ai_execution_algorithms/
- Smart order routing
- Liquidty optimization
- Execution timing

### anomaly_detection/
Unsupervised detection of:
- Market manipulation
- Unusual trading patterns
- Api abuse

### llm_infrastructure/
- Customer support chatbots
- Document analysis
- Regulatory RAG systems

## Model Training

### gpu_training_clusters/
- NVIDIA A100/H100 clusters
- Distributed training
- Mixed precision support

### inference_acceleration/
- TensorRT optimization
- ONNX export
- Low-latency serving

## MLOps

- Model versioning (MLflow)
- Feature store (Feast)
- Experiment tracking
- A/B testing infrastructure

## Production Paths

```
Research (Python)
    ↓
Validation
    ↓
Production (Rust/Python compiled)
    ↓
Serving (sub-millisecond inference)
```