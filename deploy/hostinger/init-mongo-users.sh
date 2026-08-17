#!/usr/bin/env bash
set -euo pipefail

shared_env=${1:-/opt/seemplify/secrets/shared-infrastructure.env}
apps_env=${2:-/opt/seemplify/secrets/core-apps.env}

set -a
# shellcheck disable=SC1090
. "$shared_env"
# shellcheck disable=SC1090
. "$apps_env"
set +a

create_user() {
  local database=$1
  local username=$2
  local password_variable=$3
  local password=${!password_variable}

  docker exec \
    -e APP_DB="$database" \
    -e APP_USER="$username" \
    -e APP_PASSWORD="$password" \
    -e ROOT_PASSWORD="$MONGO_ROOT_PASSWORD" \
    seemplify-shared-mongodb-1 \
    sh -ec 'mongosh --quiet --username seemplify_root --password "$ROOT_PASSWORD" --authenticationDatabase admin --eval '\''
      const target = db.getSiblingDB(process.env.APP_DB);
      const roles = [{ role: "readWrite", db: process.env.APP_DB }];
      if (target.getUser(process.env.APP_USER)) {
        target.updateUser(process.env.APP_USER, { pwd: process.env.APP_PASSWORD, roles });
      } else {
        target.createUser({ user: process.env.APP_USER, pwd: process.env.APP_PASSWORD, roles });
      }
    '\''' >/dev/null

  printf '%s=%s\n' "$database" ready
}

create_user identity identity_app MONGO_IDENTITY_PASSWORD
create_user smarthr recruiter_app MONGO_RECRUITER_PASSWORD
create_user leave-management leave_app MONGO_LEAVE_PASSWORD
create_user performance_db performance_app MONGO_PERFORMANCE_PASSWORD
create_user payroll-management payroll_app MONGO_PAYROLL_PASSWORD
create_user time-attendance time_app MONGO_TIME_PASSWORD
create_user approver approver_app MONGO_APPROVER_PASSWORD
create_user seemplify-learning learning_app MONGO_LEARNING_PASSWORD
create_user ai-interview ai_interview_app MONGO_AI_INTERVIEW_PASSWORD
create_user workspace workspace_app MONGO_WORKSPACE_PASSWORD
