"""Pin the upstream image builder to the exact framework recorded in the backup."""
from pathlib import Path
import sys

context = Path(sys.argv[1])
source = (context / 'images/custom/Containerfile').read_text()
source = source.replace('ARG FRAPPE_BRANCH=version-16', '''RUN git clone --filter=blob:none --no-checkout https://github.com/frappe/frappe /tmp/frappe-source \\
    && git -C /tmp/frappe-source checkout -b lms-restoration e703fe959883683ee98f073835065e2fee486e08
ARG FRAPPE_BRANCH=lms-restoration''')
(context / 'Containerfile.lms').write_text(source)
