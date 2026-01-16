#!/bin/bash
# Force rebuild recruiter-frontend Docker image

APP_DIR="/etc/dokploy/applications/recruiter-frontend-bshr54/code"
BUILD_PATH="./recruiter/frontend"

echo "=== Force rebuilding recruiter-frontend ==="
echo "App directory: $APP_DIR"
echo "Build path: $BUILD_PATH"
echo ""

cd $APP_DIR

# Get the service name
SERVICE_NAME="recruiter-frontend-bshr54"

# Build the new Docker image
echo "=== Building new Docker image ==="
sudo docker build -t $SERVICE_NAME:latest -f $BUILD_PATH/Dockerfile $BUILD_PATH

if [ $? -ne 0 ]; then
    echo "Build failed!"
    exit 1
fi

echo ""
echo "=== Image built successfully ==="

# Update the swarm service with the new image
echo "=== Updating swarm service ==="
sudo docker service update --image $SERVICE_NAME:latest --force $SERVICE_NAME

echo ""
echo "=== Deployment complete! ==="
echo "Wait a minute and check: curl -I https://app.seemplifyai.com | grep content-security"
