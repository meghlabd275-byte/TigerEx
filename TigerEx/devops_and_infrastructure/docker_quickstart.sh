#!/bin/bash
# Titan Exchange Docker

docker build -t tigerex/api .
docker run -d -p 3000:3000 tigerex/api
echo "Titan Exchange running on port 3000"