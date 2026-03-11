# Approver API Reference

Complete API documentation for the Approver backend.

## Base URL

```
Production: https://api.approver.aiinigeria.com
Development: http://localhost:5000
```

## Authentication

Most endpoints require JWT authentication. Include the token in the request header:

```http
Authorization: Bearer <your-jwt-token>
```

### Auth Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/auth/register` | Register new user | No |
| POST | `/api/auth/verify` | Verify OTP | No |
| POST | `/api/auth/resend-otp` | Resend OTP | No |
| POST | `/api/auth/login` | User login | No |
| POST | `/api/auth/seed-admin` | Seed default admin (dev only) | No |
| PATCH | `/api/auth/me` | Update profile | Yes |

### POST /api/auth/register

Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Response:**
```json
{
  "message": "OTP sent to your email",
  "userId": "507f1f77bcf86cd799439011"
}
```

---

### POST /api/auth/login

Login with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "User",
    "organizationId": "..."
  }
}
```

---

## Organizations

| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| GET | `/api/organizations` | List all organizations | No | - |
| POST | `/api/organizations` | Create organization | Yes | Admin |
| POST | `/api/organizations/create-and-join` | Create and join org | Yes | - |
| GET | `/api/organizations/my` | Get my organizations | Yes | - |
| PATCH | `/api/organizations/current` | Update current org | Yes | Admin |
| POST | `/api/organizations/current/logo` | Upload org logo | Yes | Admin |
| DELETE | `/api/organizations/current/logo` | Remove org logo | Yes | Admin |

### POST /api/organizations

Create a new organization.

**Request Body:**
```json
{
  "name": "Acme Corp",
  "description": "Innovation company"
}
```

---

## Departments

| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| GET | `/api/departments` | List departments | Yes | - |
| POST | `/api/departments` | Create department | Yes | Admin |
| DELETE | `/api/departments/:id` | Delete department | Yes | Admin |

---

## Users (Admin)

| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| GET | `/api/users` | List all users | Yes | Admin |
| PATCH | `/api/users/role` | Update user role | Yes | Admin |

---

## Invites

| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| GET | `/api/invites/pending` | Get pending invites | Yes | - |
| POST | `/api/invites/:id/accept` | Accept invite | Yes | - |
| POST | `/api/invites/:id/decline` | Decline invite | Yes | - |
| POST | `/api/invites` | Send invite | Yes | Admin |
| GET | `/api/invites/sent` | Get sent invites | Yes | Admin |
| DELETE | `/api/invites/:id` | Revoke invite | Yes | Admin |

---

## Governance & Rules

### Roles

| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| GET | `/api/roles` | List roles | Yes | - |
| POST | `/api/roles` | Create role | Yes | Admin |
| PATCH | `/api/roles/:id` | Update role | Yes | Admin |
| DELETE | `/api/roles/:id` | Delete role | Yes | Admin |

### Workflow Policy

| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| GET | `/api/workflow-policy` | Get workflow policy | Yes | Admin |
| PUT | `/api/workflow-policy` | Update workflow policy | Yes | Admin |
| POST | `/api/workflow-policy/reset` | Reset to default | Yes | Admin |

### Scoring Policy

| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| GET | `/api/scoring-policy` | Get scoring policy | Yes | scoring.manage |
| PUT | `/api/scoring-policy` | Update scoring policy | Yes | scoring.manage |

---

## Rules

| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| GET | `/api/rules` | List rules | Yes | - |
| POST | `/api/rules` | Create rule | Yes | rules.manage |
| PATCH | `/api/rules/:id` | Update rule | Yes | rules.manage |
| DELETE | `/api/rules/:id` | Delete rule | Yes | rules.manage |
| POST | `/api/rules/:id/embedding/retry` | Retry embedding | Yes | rules.manage |
| POST | `/api/rules/embedding/retry-all` | Retry all embeddings | Yes | rules.manage |
| PATCH | `/api/rules/system/bulk` | Bulk update system rules | Yes | rules.manage.system |

---

## Projects / Initiatives

| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| GET | `/api/projects` | List projects | Yes | - |
| GET | `/api/projects/:id` | Get project details | Yes | - |
| POST | `/api/projects/analyze` | Analyze project (sync) | Yes | - |
| POST | `/api/projects/analyze-async` | Analyze project (async) | Yes | - |
| GET | `/api/projects/analyze-jobs/:jobId` | Get analysis job status | Yes | - |
| POST | `/api/projects/:id/resubmit` | Resubmit project | Yes | - |
| POST | `/api/projects/:id/resubmit-async` | Resubmit async | Yes | - |
| PATCH | `/api/projects/:id/override` | Override project decision | Yes | projects.override |
| DELETE | `/api/projects/:id` | Delete project | Yes | Admin |

### POST /api/projects/analyze

Submit a project for AI analysis.

**Request Body:**
```json
{
  "title": "New Marketing Campaign",
  "description": "Q2 digital marketing initiative",
  "departmentId": "507f1f77bcf86cd799439011",
  "expectedImpact": "Increase brand awareness by 30%",
  "resourceRequirements": {
    "budget": 50000,
    "personnel": 5,
    "timeline": "3 months"
  }
}
```

**Response:**
```json
{
  "id": "...",
  "status": "Approved",
  "aiScore": 85,
  "analysis": {
    "strengths": ["Clear objectives", "Realistic timeline"],
    "weaknesses": ["Budget may be insufficient"],
    "recommendations": ["Consider increasing budget"]
  },
  "approvedBy": "AI",
  "createdAt": "2026-03-11T10:00:00Z"
}
```

---

## Error Responses

All endpoints may return error responses in the following format:

### 400 Bad Request
```json
{
  "error": "Validation error message"
}
```

### 401 Unauthorized
```json
{
  "error": "Invalid or expired token"
}
```

### 403 Forbidden
```json
{
  "error": "Insufficient permissions"
}
```

### 404 Not Found
```json
{
  "error": "Resource not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```

---

## Organization Context

Several endpoints require an organization context header:

```http
X-Organization-Id: <organization-id>
```

Endpoints requiring org context:
- All department endpoints
- All project endpoints
- All rules endpoints
- All governance endpoints
- User management endpoints

---

## Rate Limiting

API requests are rate-limited to prevent abuse. If you exceed the limit, you'll receive a `429 Too Many Requests` response.

---

*Last Updated: March 2026*
