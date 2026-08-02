import mongoose from 'mongoose'

export const GENERAL_DEPARTMENT_NAME = 'General'

export const COMMON_DEPARTMENT_NAMES = [
  'Engineering',
  'Product',
  'Operations',
  'Human Resources',
  'Finance',
  'Sales',
  'Marketing',
  'Customer Support',
  'Legal',
  'Administration'
]

export function toIdString(value) {
  return value?._id?.toString?.() || value?.toString?.() || ''
}

export function normalizeDepartmentName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

export function buildSeedDepartments() {
  const generalId = new mongoose.Types.ObjectId()
  return [
    {
      _id: generalId,
      name: GENERAL_DEPARTMENT_NAME,
      description: 'Default root department for the organization',
      parentDepartment: null,
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    ...COMMON_DEPARTMENT_NAMES.map(name => ({
      _id: new mongoose.Types.ObjectId(),
      name,
      description: '',
      parentDepartment: generalId,
      isSystem: false,
      createdAt: new Date(),
      updatedAt: new Date()
    }))
  ]
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
