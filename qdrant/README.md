# Qdrant Local (Docker)

Vector database for semantic search and embeddings.

## Quick Start

```powershell
cd qdrant
docker compose up -d
```

## Connection Details

| Property | Value |
|----------|-------|
| **URL** | `http://localhost:6333` |
| **Web UI** | http://localhost:6333/dashboard |
| **gRPC** | `localhost:6334` |
| **API Key** | See `.env` file |

## API Key

The API key is set in `.env`. Include it in requests:

```bash
curl -X GET http://localhost:6333/collections \
  -H "api-key: YOUR_API_KEY"
```

Python client:
```python
from qdrant_client import QdrantClient

client = QdrantClient(
    url="http://localhost:6333",
    api_key="YOUR_API_KEY"
)
```

## Stop

```powershell
docker compose down
```
