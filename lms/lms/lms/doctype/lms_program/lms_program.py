# Copyright (c) 2024, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class LMSProgram(Document):
	def validate(self):
		self.validate_program_courses()
		self.validate_program_members()
		self.validate_program_schools()
		self.update_count()

	def validate_program_courses(self):
		courses = [row.course for row in self.get("program_courses", [])]
		duplicates = {course for course in courses if courses.count(course) > 1}
		if len(duplicates):
			frappe.throw(
				_("Course {0} has already been added to this program.").format(
					frappe.bold(next(iter(duplicates)))
				)
			)

	def validate_program_members(self):
		members = [row.member for row in self.get("program_members", [])]
		duplicates = {member for member in members if members.count(member) > 1}
		if len(duplicates):
			frappe.throw(
				_("Member {0} has already been added to this program.").format(
					frappe.bold(next(iter(duplicates)))
				)
			)

	def validate_program_schools(self):
		schools = [row.school for row in self.get("program_schools", []) if row.school]
		duplicates = {school for school in schools if schools.count(school) > 1}
		if len(duplicates):
			frappe.throw(
				_("School {0} has already been added to this program.").format(
					frappe.bold(next(iter(duplicates)))
				)
			)

	def update_count(self):
		course_count = len(self.get("program_courses", []))
		member_count = len(self.get("program_members", []))
		school_count = len(self.get("program_schools", []))

		if self.course_count != course_count:
			self.course_count = course_count

		if self.member_count != member_count:
			self.member_count = member_count

		if self.school_count != school_count:
			self.school_count = school_count
