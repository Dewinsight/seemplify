# Copyright (c) 2026, Frappe and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class LMSSchool(Document):
	def validate(self):
		self.validate_school_members()
		self.update_count()

	def validate_school_members(self):
		members = [row.member for row in self.get("school_members", []) if row.member]
		duplicates = {member for member in members if members.count(member) > 1}
		if duplicates:
			frappe.throw(
				_("Member {0} has already been added to this school.").format(
					frappe.bold(next(iter(duplicates)))
				)
			)

	def update_count(self):
		member_count = len(self.get("school_members", []))
		if self.member_count != member_count:
			self.member_count = member_count
