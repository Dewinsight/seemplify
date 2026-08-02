#!/bin/bash
# Create apps.txt in LMS frappe-bench
docker run --rm -v lms_frappe-data:/data -u root alpine sh -c 'printf "frappe\nlms\n" > /data/frappe-bench/sites/apps.txt && chown 1000:1000 /data/frappe-bench/sites/apps.txt && cat /data/frappe-bench/sites/apps.txt'
