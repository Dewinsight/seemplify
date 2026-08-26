import mongoose from 'mongoose'

export const GENERAL_DEPARTMENT_NAME = 'General'

export const DEFAULT_ORGANIZATION_STRUCTURE = [
  {
    name: GENERAL_DEPARTMENT_NAME,
    description: 'Organization-wide leadership and shared responsibilities',
    isSystem: true,
    teams: [
      { name: 'Leadership', description: 'Organization leadership and strategic coordination' }
    ]
  },
  {
    name: 'Engineering',
    description: 'Software engineering, quality, infrastructure, and technical delivery',
    teams: [
      { name: 'Software Engineering', description: 'Software delivery and platform development' },
      { name: 'Quality Engineering', description: 'Quality assurance, testing, and release confidence' }
    ]
  },
  {
    name: 'Product',
    description: 'Product strategy, research, design, and delivery',
    teams: [
      { name: 'Product Management', description: 'Product strategy, discovery, and delivery' },
      { name: 'Product Design', description: 'Product design and user experience' }
    ]
  },
  {
    name: 'Operations',
    description: 'Business operations, workplace services, and process improvement',
    teams: [
      { name: 'Business Operations', description: 'Day-to-day business operations and process improvement' },
      { name: 'Facilities & Workplace', description: 'Workplace, facilities, and office operations' }
    ]
  },
  {
    name: 'Human Resources',
    description: 'People operations, talent, learning, and employee experience',
    teams: [
      { name: 'People Operations', description: 'Employee experience and people operations' },
      { name: 'Talent Acquisition', description: 'Recruiting and talent acquisition' }
    ]
  },
  {
    name: 'Finance',
    description: 'Accounting, planning, payroll, and financial controls',
    teams: [
      { name: 'Accounting', description: 'Accounting, reporting, and financial controls' },
      { name: 'Payroll', description: 'Payroll operations and employee payments' }
    ]
  },
  {
    name: 'Sales',
    description: 'Business development, revenue growth, and account management',
    teams: [
      { name: 'Business Development', description: 'New business and commercial partnerships' },
      { name: 'Account Management', description: 'Customer accounts and commercial relationships' }
    ]
  },
  {
    name: 'Marketing',
    description: 'Brand, communications, campaigns, and demand generation',
    teams: [
      { name: 'Brand & Communications', description: 'Brand, communications, and public relations' },
      { name: 'Growth Marketing', description: 'Demand generation and growth programmes' }
    ]
  },
  {
    name: 'Customer Support',
    description: 'Customer service, adoption, retention, and support operations',
    teams: [
      { name: 'Customer Success', description: 'Customer adoption and long-term success' },
      { name: 'Support Operations', description: 'Customer support and service operations' }
    ]
  },
  {
    name: 'Legal',
    description: 'Legal advice, contracts, governance, risk, and compliance',
    teams: [
      { name: 'Legal & Compliance', description: 'Legal guidance, contracts, and compliance' }
    ]
  },
  {
    name: 'Administration',
    description: 'Administrative services and organization-wide coordination',
    teams: [
      { name: 'Office Administration', description: 'Administrative support and office coordination' }
    ]
  }
]

export const COMMON_DEPARTMENT_NAMES = DEFAULT_ORGANIZATION_STRUCTURE
  .filter((department) => department.name !== GENERAL_DEPARTMENT_NAME)
  .map((department) => department.name)

export function toIdString(value) {
  return value?._id?.toString?.() || value?.toString?.() || ''
}

export function normalizeDepartmentName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

export function buildSeedDepartments() {
  const generalId = new mongoose.Types.ObjectId()
  const seededAt = new Date()
  return DEFAULT_ORGANIZATION_STRUCTURE.map((department) => ({
    _id: department.name === GENERAL_DEPARTMENT_NAME
      ? generalId
      : new mongoose.Types.ObjectId(),
    name: department.name,
    description: department.description || '',
    parentDepartment: department.name === GENERAL_DEPARTMENT_NAME ? null : generalId,
    isSystem: !!department.isSystem,
    createdAt: seededAt,
    updatedAt: seededAt
  }))
}

export function buildDepartmentLookup(departments = []) {
  return new Map(departments.map((dept) => [toIdString(dept._id || dept.id), dept]))
}

export function getGeneralDepartment(departments = []) {
  return departments.find((dept) => normalizeDepartmentName(dept.name).toLowerCase() === GENERAL_DEPARTMENT_NAME.toLowerCase()) || null
}

export function buildDepartmentPath(departmentId, departments = []) {
  const lookup = buildDepartmentLookup(departments)
  const path = []
  let currentId = toIdString(departmentId)

  while (currentId) {
    const current = lookup.get(currentId)
    if (!current) break
    path.unshift(current.name)
    currentId = toIdString(current.parentDepartment)
  }

  return path
}
