#!/bin/bash
docker exec dokploy-postgres.1.khhkgir9v9mt1s3e9zjqn7cs2 psql -U dokploy -d dokploy -c "UPDATE application SET \"sourceType\"='git' WHERE \"applicationId\"='yMSZcZfu0x4ufvoMHucs5';"
