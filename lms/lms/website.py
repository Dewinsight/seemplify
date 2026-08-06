# Copyright (c) 2026, Seemplify
# License: AGPL

import frappe


def get_home_page(user):
	"""
	Dynamic homepage for website root (/).
	Guests see custom login (lms-login); logged-in users see LMS app.
	"""
	if not user or user == "Guest":
		return "lms-login"
	return "lms"
