#!/bin/bash
docker exec dokploy-postgres.1.khhkgir9v9mt1s3e9zjqn7cs2 psql -U dokploy -d dokploy -c "SELECT \"buildId\", status, logs FROM build WHERE \"applicationId\"='yMSZcZfu0x4ufvoMHucs5' ORDER BY \"createdAt\" DESC LIMIT 1;"
