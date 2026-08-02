#!/bin/bash
# Temporary script to deploy Identity Provider
curl -s -X POST "http://localhost:3000/api/application.deploy" \
  -H "x-api-key: github-actions-2026yJfCpQwusWxkVlwhfbFDhkyLzLZrJfEBhBSBcRdgaYfDpKktAiCeJVexVmhfcEeh" \
  -H "Content-Type: application/json" \
  -d '{"applicationId": "8e1fIo8p0MwhkMiSBtb8U"}'
