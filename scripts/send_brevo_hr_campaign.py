#!/usr/bin/env python3
"""Create and optionally send a personalized Brevo HR marketing campaign."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, parse, request

DEFAULT_CSV_PATH = Path(r"C:\Users\Michael\Downloads\seemplifyai_hr_campaign_final.csv")
DEFAULT_FREE_TRIAL_URL = "https://auth.seemplifyai.com"
DEFAULT_FOLDER_NAME = "Seemplify Campaigns"
DEFAULT_SUBJECT = "{{contact.FIRSTNAME}}, simplify HR operations at {{contact.COMPANYNAME}} with Seemplify"
DEFAULT_PREVIEW_TEXT = (
    "One platform for recruiting, onboarding, payroll, approvals, performance, and compliance visibility."
)
REQUIRED_COLUMNS = [
    "First Name",
    "Last Name",
    "Email",
    "jobTitle",
    "jobLevel",
    "department",
    "companyName",
    "industry",
    "companyHeadCount",
    "location",
    "companyDescription",
    "Tailored_Message",
]
STANDARD_ATTRIBUTES = {"FIRSTNAME", "LASTNAME"}
CUSTOM_ATTRIBUTE_TYPES = {
    "JOBTITLE": "text",
    "JOBLEVEL": "text",
    "DEPARTMENT": "text",
    "COMPANYNAME": "text",
    "INDUSTRY": "text",
    "HEADCOUNT": "text",
    "LOCATION": "text",
    "COMPANYDESCRIPTION": "text",
    "CUSTOM_OPENING": "text",
    "CUSTOM_BENEFITS": "text",
    "FREE_TRIAL_URL": "text",
}
SKIP_PARAGRAPH_PATTERNS = [
    re.compile(r"^best\b", re.IGNORECASE),
    re.compile(r"^best regards\b", re.IGNORECASE),
    re.compile(r"^regards\b", re.IGNORECASE),
    re.compile(r"^warm regards\b", re.IGNORECASE),
    re.compile(r"^sincerely\b", re.IGNORECASE),
    re.compile(r"^seemplifyai\b", re.IGNORECASE),
    re.compile(r"^www\.", re.IGNORECASE),
    re.compile(r"^https?://", re.IGNORECASE),
    re.compile(r"^would you be open", re.IGNORECASE),
    re.compile(r"^would it make sense", re.IGNORECASE),
    re.compile(r"^would you be interested", re.IGNORECASE),
    re.compile(r"^open to a short call", re.IGNORECASE),
]
GENERIC_PRODUCT_PATTERNS = [
    re.compile(r"seemplify\s*ai", re.IGNORECASE),
    re.compile(r"\bunifies\b", re.IGNORECASE),
    re.compile(r"\bconnects\b", re.IGNORECASE),
]


class BrevoAPIError(RuntimeError):
    """Raised when the Brevo API returns an error."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv-path", default=str(DEFAULT_CSV_PATH), help="Path to the campaign CSV file.")
    parser.add_argument("--env-file", help="Optional .env file to load before reading environment variables.")
    parser.add_argument("--list-name", help="Optional Brevo list name. Defaults to a dated Seemplify list.")
    parser.add_argument(
        "--campaign-name",
        help="Optional Brevo campaign name. Defaults to a dated Seemplify campaign name.",
    )
    parser.add_argument("--subject", default=DEFAULT_SUBJECT, help="Campaign subject line.")
    parser.add_argument(
        "--send-now",
        action="store_true",
        help="After preflight succeeds, create contacts, create the campaign, and trigger the send.",
    )
    return parser.parse_args()


def load_env_file(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not env_path.exists():
        raise FileNotFoundError(f"Env file not found: {env_path}")

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_email(email: str) -> str:
    return normalize_whitespace(email).lower()


def valid_email(email: str) -> bool:
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email))


def split_paragraphs(message: str) -> list[str]:
    normalized = message.replace("\r\n", "\n").replace("\r", "\n").strip()
    parts = [part.strip() for part in re.split(r"\n\s*\n+", normalized) if part.strip()]
    return parts


def is_greeting(paragraph: str, first_name: str) -> bool:
    normalized = paragraph.strip().rstrip(",")
    if not normalized:
        return False
    if normalized.lower() in {f"hi {first_name.lower()}", f"hello {first_name.lower()}"}:
        return True
    return bool(re.match(r"^(hi|hello)\b", normalized, re.IGNORECASE) and len(normalized.split()) <= 3)


def should_skip_paragraph(paragraph: str) -> bool:
    return any(pattern.search(paragraph) for pattern in SKIP_PARAGRAPH_PATTERNS)


def choose_custom_opening(row: dict[str, str]) -> str:
    first_name = normalize_whitespace(row.get("First Name", ""))
    paragraphs = split_paragraphs(row.get("Tailored_Message", ""))
    body = [part for part in paragraphs if not is_greeting(part, first_name) and not should_skip_paragraph(part)]

    if not body:
        company = row.get("companyName", "your company").strip() or "your company"
        role = row.get("jobTitle", "your role").strip() or "your role"
        return f"I noticed your work in {role} at {company} and thought this might be relevant."

    for paragraph in body:
        if not any(pattern.search(paragraph) for pattern in GENERIC_PRODUCT_PATTERNS):
            return normalize_whitespace(paragraph)

    return normalize_whitespace(body[0])


def role_bucket(row: dict[str, str]) -> str:
    title = normalize_whitespace(row.get("jobTitle", "")).lower()
    level = normalize_whitespace(row.get("jobLevel", "")).lower()
    department = normalize_whitespace(row.get("department", "")).lower()
    combined = " ".join([title, level, department])

    if any(term in combined for term in ["recruit", "talent acquisition", "talent", "sourcing"]):
        return "recruiting"
    if "human resources" in combined or re.search(r"\bhr\b", combined) or "people" in combined:
        if any(term in combined for term in ["head", "director", "vp", "chief", "lead", "manager"]):
            return "hr_leadership"
    return "people_ops"


def size_context(row: dict[str, str]) -> str:
    headcount = normalize_whitespace(row.get("companyHeadCount", ""))
    if any(token in headcount for token in ["1K", "10K", "250", "500"]):
        return (
            "That becomes especially valuable when multiple teams, approvals, and systems start slowing down execution."
        )
    if any(token in headcount for token in ["0 - 25", "26 - 100", "101 - 250"]):
        return "It helps growing teams put repeatable processes in place early without adding more admin overhead."
    return "It gives HR teams a cleaner operating rhythm with less manual coordination and better visibility."


def build_custom_benefits(row: dict[str, str]) -> str:
    bucket = role_bucket(row)
    if bucket == "recruiting":
        lead = (
            "Seemplify connects recruiting directly to onboarding and employee setup, helping hiring teams reduce handoff gaps, move faster after offers are signed, and cut repetitive admin."
        )
    elif bucket == "hr_leadership":
        lead = (
            "Seemplify gives HR leaders one platform for recruiting, onboarding, payroll, approvals, performance, and compliance visibility, so teams spend less time stitching tools together and more time executing."
        )
    else:
        lead = (
            "Seemplify centralizes employee records, workflow automation, approvals, onboarding, and performance management with clearer ownership, auditability, and real-time visibility."
        )

    return f"{lead} {size_context(row)} Start a free trial to see how it fits your team."


def render_preview(row: dict[str, str], opening: str, benefits: str, free_trial_url: str) -> str:
    first_name = normalize_whitespace(row.get("First Name", "")) or "there"
    return (
        f"Hi {first_name},\n\n"
        f"{opening}\n\n"
        f"{benefits}\n\n"
        f"Start your free trial here: {free_trial_url}\n\n"
        "Best,\nSeemplify"
    )


def sanitize_attribute(value: str) -> str:
    text = value.replace("\r", " ").replace("\n", " ").replace("<", "").replace(">", "")
    return normalize_whitespace(text)


def build_contact_attributes(row: dict[str, str], opening: str, benefits: str, free_trial_url: str) -> dict[str, str]:
    return {
        "FIRSTNAME": sanitize_attribute(row.get("First Name", "")),
        "LASTNAME": sanitize_attribute(row.get("Last Name", "")),
        "JOBTITLE": sanitize_attribute(row.get("jobTitle", "")),
        "JOBLEVEL": sanitize_attribute(row.get("jobLevel", "")),
        "DEPARTMENT": sanitize_attribute(row.get("department", "")),
        "COMPANYNAME": sanitize_attribute(row.get("companyName", "")),
        "INDUSTRY": sanitize_attribute(row.get("industry", "")),
        "HEADCOUNT": sanitize_attribute(row.get("companyHeadCount", "")),
        "LOCATION": sanitize_attribute(row.get("location", "")),
        "COMPANYDESCRIPTION": sanitize_attribute(row.get("companyDescription", "")),
        "CUSTOM_OPENING": sanitize_attribute(opening),
        "CUSTOM_BENEFITS": sanitize_attribute(benefits),
        "FREE_TRIAL_URL": sanitize_attribute(free_trial_url),
    }


def build_campaign_html() -> str:
    return """<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#10212b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;">
          <tr>
            <td style="padding:32px 40px;background:#0b2f29;color:#ffffff;">
              <div style="font-size:28px;font-weight:700;letter-spacing:0.4px;">Seemplify</div>
              <div style="margin-top:8px;font-size:15px;color:#d7f7f1;">One platform for modern people operations</div>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 18px;font-size:18px;line-height:1.6;">Hi {{contact.FIRSTNAME}},</p>
              <p style="margin:0 0 18px;font-size:16px;line-height:1.7;">{{contact.CUSTOM_OPENING}}</p>
              <p style="margin:0 0 18px;font-size:16px;line-height:1.7;">{{contact.CUSTOM_BENEFITS}}</p>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.7;">Seemplify helps teams consolidate recruiting, onboarding, payroll, approvals, performance, and compliance visibility in one operating system.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="border-radius:999px;background:#0b2f29;">
                    <a href="{{contact.FREE_TRIAL_URL}}" style="display:inline-block;padding:16px 28px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;">Start a free trial</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:14px;line-height:1.7;color:#51636f;">If you'd rather not hear from us, you can <a href="{{ unsubscribe }}" style="color:#0b2f29;">unsubscribe here</a>.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def build_campaign_text() -> str:
    return (
        "Hi {{contact.FIRSTNAME}},\n\n"
        "{{contact.CUSTOM_OPENING}}\n\n"
        "{{contact.CUSTOM_BENEFITS}}\n\n"
        "Seemplify helps teams consolidate recruiting, onboarding, payroll, approvals, performance, and compliance visibility in one operating system.\n\n"
        "Start a free trial: {{contact.FREE_TRIAL_URL}}\n\n"
        "If you'd rather not hear from us, unsubscribe here: {{unsubscribe}}\n"
    )


class BrevoClient:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.base_url = "https://api.brevo.com/v3"

    def _request(self, method: str, path: str, payload: Any | None = None, query: dict[str, Any] | None = None) -> Any:
        url = f"{self.base_url}{path}"
        if query:
            qs = parse.urlencode(query)
            url = f"{url}?{qs}"

        data = None
        headers = {"api-key": self.api_key}
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload).encode("utf-8")

        for attempt in range(1, 4):
            req = request.Request(url, method=method, data=data, headers=headers)
            try:
                with request.urlopen(req, timeout=30) as response:
                    raw = response.read().decode("utf-8").strip()
                    if not raw:
                        return {}
                    return json.loads(raw)
            except error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace")
                if attempt < 3 and exc.code in {425, 429, 500, 502, 503, 504}:
                    time.sleep(2 ** attempt)
                    continue
                raise BrevoAPIError(f"{method} {path} failed with {exc.code}: {body}") from exc
            except error.URLError as exc:
                if attempt < 3:
                    time.sleep(2 ** attempt)
                    continue
                raise BrevoAPIError(f"{method} {path} failed: {exc}") from exc

        raise BrevoAPIError(f"{method} {path} failed after retries")

    def get_senders(self) -> list[dict[str, Any]]:
        return self._request("GET", "/senders").get("senders", [])

    def get_attributes(self) -> list[dict[str, Any]]:
        return self._request("GET", "/contacts/attributes").get("attributes", [])

    def create_attribute(self, attribute_name: str, attribute_type: str) -> None:
        self._request(
            "POST",
            f"/contacts/attributes/normal/{attribute_name}",
            {"type": attribute_type},
        )

    def get_folders(self) -> list[dict[str, Any]]:
        folders: list[dict[str, Any]] = []
        offset = 0
        while True:
            payload = self._request("GET", "/contacts/folders", None, {"limit": 50, "offset": offset})
            current = payload.get("folders", [])
            folders.extend(current)
            if len(current) < 50:
                return folders
            offset += 50

    def create_folder(self, name: str) -> int:
        return int(self._request("POST", "/contacts/folders", {"name": name})["id"])

    def get_lists(self) -> list[dict[str, Any]]:
        lists: list[dict[str, Any]] = []
        offset = 0
        while True:
            payload = self._request("GET", "/contacts/lists", None, {"limit": 50, "offset": offset})
            current = payload.get("lists", [])
            lists.extend(current)
            if len(current) < 50:
                return lists
            offset += 50

    def create_list(self, folder_id: int, name: str) -> int:
        return int(self._request("POST", "/contacts/lists", {"folderId": folder_id, "name": name})["id"])

    def upsert_contact(self, email: str, attributes: dict[str, str], list_id: int) -> dict[str, Any]:
        payload = {
            "email": email,
            "attributes": attributes,
            "listIds": [list_id],
            "emailBlacklisted": False,
            "smsBlacklisted": True,
            "updateEnabled": True,
        }
        return self._request("POST", "/contacts", payload)

    def create_campaign(self, payload: dict[str, Any]) -> int:
        return int(self._request("POST", "/emailCampaigns", payload)["id"])

    def send_campaign_now(self, campaign_id: int) -> None:
        self._request("POST", f"/emailCampaigns/{campaign_id}/sendNow")


def ensure_sender_available(client: BrevoClient, sender_email: str) -> dict[str, Any]:
    for sender in client.get_senders():
        if sender.get("email", "").lower() == sender_email.lower():
            if not sender.get("active", False):
                raise BrevoAPIError(f"Brevo sender exists but is not active: {sender_email}")
            return sender
    raise BrevoAPIError(f"Brevo sender not found or not verified: {sender_email}")


def ensure_attributes(client: BrevoClient) -> list[str]:
    existing = {attribute.get("name") for attribute in client.get_attributes()}
    created: list[str] = []
    for name, attr_type in CUSTOM_ATTRIBUTE_TYPES.items():
        if name in STANDARD_ATTRIBUTES or name in existing:
            continue
        client.create_attribute(name, attr_type)
        created.append(name)
    return created


def ensure_folder_and_list(client: BrevoClient, folder_name: str, list_name: str) -> tuple[int, int]:
    folder_id = None
    for folder in client.get_folders():
        if folder.get("name") == folder_name:
            folder_id = int(folder["id"])
            break
    if folder_id is None:
        folder_id = client.create_folder(folder_name)

    for item in client.get_lists():
        if item.get("name") == list_name:
            return folder_id, int(item["id"])

    return folder_id, client.create_list(folder_id, list_name)


def sanitize_name_for_utm(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9 ]+", "", name).strip() or "SeemplifyCampaign"


def build_campaign_payload(
    campaign_name: str,
    subject: str,
    sender_name: str,
    sender_email: str,
    list_id: int,
) -> dict[str, Any]:
    return {
        "name": campaign_name,
        "subject": subject,
        "previewText": DEFAULT_PREVIEW_TEXT,
        "type": "classic",
        "sender": {"name": sender_name, "email": sender_email},
        "replyTo": sender_email,
        "toField": "{{contact.FIRSTNAME}} {{contact.LASTNAME}}",
        "recipients": {"listIds": [list_id]},
        "htmlContent": build_campaign_html(),
        "textContent": build_campaign_text(),
        "mirrorActive": True,
        "inlineImageActivation": False,
        "tag": "seemplify-hr-campaign",
        "utmCampaign": sanitize_name_for_utm(campaign_name),
    }


def load_campaign_rows(csv_path: Path, free_trial_url: str) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = [column for column in REQUIRED_COLUMNS if column not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"CSV is missing required columns: {', '.join(missing)}")

        seen: set[str] = set()
        prepared_rows: list[dict[str, Any]] = []
        skipped: list[dict[str, str]] = []

        for row in reader:
            email = normalize_email(row.get("Email", ""))
            if not email:
                skipped.append({"email": "", "reason": "missing email"})
                continue
            if not valid_email(email):
                skipped.append({"email": email, "reason": "invalid email"})
                continue
            if email in seen:
                skipped.append({"email": email, "reason": "duplicate email"})
                continue
            seen.add(email)

            opening = choose_custom_opening(row)
            benefits = build_custom_benefits(row)
            attributes = build_contact_attributes(row, opening, benefits, free_trial_url)
            prepared_rows.append(
                {
                    "email": email,
                    "row": row,
                    "opening": opening,
                    "benefits": benefits,
                    "attributes": attributes,
                    "preview": render_preview(row, opening, benefits, free_trial_url),
                }
            )

    return prepared_rows, skipped


def write_report(report: dict[str, Any]) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    report_dir = Path(tempfile.gettempdir()) / "seemplify_brevo_reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / f"brevo_hr_campaign_{timestamp}.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report_path


def resolve_runtime_values(args: argparse.Namespace) -> dict[str, str]:
    env = dict(os.environ)
    if args.env_file:
        env.update(load_env_file(Path(args.env_file)))

    api_key = env.get("BREVO_API_KEY", "").strip()
    sender_email = (env.get("BREVO_FROM_EMAIL") or env.get("SENDER_EMAIL") or "").strip()
    sender_name = (env.get("BREVO_FROM_NAME") or env.get("SENDER_NAME") or "Seemplify").strip()
    free_trial_url = (env.get("SEEMPLIFY_FREE_TRIAL_URL") or DEFAULT_FREE_TRIAL_URL).strip()

    if not api_key:
        raise ValueError("BREVO_API_KEY is required.")
    if not sender_email:
        raise ValueError("BREVO_FROM_EMAIL (or legacy SENDER_EMAIL) is required.")
    if not sender_name:
        raise ValueError("BREVO_FROM_NAME (or legacy SENDER_NAME) is required.")

    return {
        "api_key": api_key,
        "sender_email": sender_email,
        "sender_name": sender_name,
        "free_trial_url": free_trial_url,
    }


def print_preview(rows: list[dict[str, Any]], skipped: list[dict[str, str]], sender_email: str, sender_name: str) -> None:
    print("=== Preflight Summary ===")
    print(f"Valid recipients: {len(rows)}")
    print(f"Skipped recipients: {len(skipped)}")
    print(f"Sender: {sender_name} <{sender_email}>")
    if skipped:
        print("Skipped examples:")
        for item in skipped[:5]:
            print(f"  - {item['email'] or '<missing>'}: {item['reason']}")
    print("\n=== Rendered Examples ===")
    for index, row in enumerate(rows[:3], start=1):
        print(f"\n--- Example {index}: {row['email']} ---")
        print(row["preview"])


def main() -> int:
    args = parse_args()
    csv_path = Path(args.csv_path)
    now = datetime.now(timezone.utc)
    list_name = args.list_name or f"Seemplify HR Campaign {now:%Y-%m-%d}"
    campaign_name = args.campaign_name or f"Seemplify HR Campaign {now:%Y-%m-%d %H:%M UTC}"

    try:
        runtime = resolve_runtime_values(args)
        rows, skipped = load_campaign_rows(csv_path, runtime["free_trial_url"])
        if not rows:
            raise ValueError("No valid recipients found in CSV.")

        print_preview(rows, skipped, runtime["sender_email"], runtime["sender_name"])

        client = BrevoClient(runtime["api_key"])
        sender = ensure_sender_available(client, runtime["sender_email"])
        existing_attributes = {attribute.get("name") for attribute in client.get_attributes()}
        existing_folders = client.get_folders()
        existing_lists = client.get_lists()
        missing_attributes = sorted(name for name in CUSTOM_ATTRIBUTE_TYPES if name not in existing_attributes)
        existing_folder = next((folder for folder in existing_folders if folder.get("name") == DEFAULT_FOLDER_NAME), None)
        existing_list = next((item for item in existing_lists if item.get("name") == list_name), None)
        campaign_payload = build_campaign_payload(
            campaign_name=campaign_name,
            subject=args.subject,
            sender_name=runtime["sender_name"],
            sender_email=runtime["sender_email"],
            list_id=999999,
        )

        print("\n=== Brevo Preflight ===")
        print(f"Verified sender id: {sender.get('id')}")
        print(f"Missing contact attributes to create: {', '.join(missing_attributes) if missing_attributes else 'none'}")
        print(f"Folder name: {DEFAULT_FOLDER_NAME}")
        print(f"List name: {list_name}")
        print(f"Existing campaign folder: {existing_folder.get('id') if existing_folder else 'will create'}")
        print(f"Existing target list: {existing_list.get('id') if existing_list else 'will create'}")
        print(f"Campaign name: {campaign_name}")
        print(f"Subject: {args.subject}")
        print("Campaign payload keys:", ", ".join(sorted(campaign_payload.keys())))

        report: dict[str, Any] = {
            "csv_path": str(csv_path),
            "valid_recipients": len(rows),
            "skipped_recipients": skipped,
            "sender": {
                "email": runtime["sender_email"],
                "name": runtime["sender_name"],
                "id": sender.get("id"),
            },
            "list_name": list_name,
            "campaign_name": campaign_name,
            "subject": args.subject,
            "missing_attributes": missing_attributes,
            "existing_folder_id": existing_folder.get("id") if existing_folder else None,
            "existing_list_id": existing_list.get("id") if existing_list else None,
            "sample_previews": [row["preview"] for row in rows[:3]],
            "status": "preflight_only",
        }

        if not args.send_now:
            report_path = write_report(report)
            print(f"\nDry run complete. Report written to: {report_path}")
            return 0

        created_attributes = ensure_attributes(client)
        folder_id, list_id = ensure_folder_and_list(client, DEFAULT_FOLDER_NAME, list_name)
        print(f"\nUsing Brevo folder {folder_id} and list {list_id}")

        imported = 0
        contact_failures: list[dict[str, str]] = []
        for item in rows:
            try:
                client.upsert_contact(item["email"], item["attributes"], list_id)
                imported += 1
            except BrevoAPIError as exc:
                contact_failures.append({"email": item["email"], "error": str(exc)})

        if imported == 0:
            raise BrevoAPIError("No contacts were imported successfully. Aborting campaign creation.")

        final_campaign_payload = build_campaign_payload(
            campaign_name=campaign_name,
            subject=args.subject,
            sender_name=runtime["sender_name"],
            sender_email=runtime["sender_email"],
            list_id=list_id,
        )
        campaign_id = client.create_campaign(final_campaign_payload)
        client.send_campaign_now(campaign_id)

        report.update(
            {
                "status": "sent",
                "created_attributes": created_attributes,
                "folder_id": folder_id,
                "list_id": list_id,
                "campaign_id": campaign_id,
                "imported_contacts": imported,
                "contact_failures": contact_failures,
            }
        )
        report_path = write_report(report)
        print(f"\nCampaign sent. Campaign ID: {campaign_id}")
        print(f"Imported contacts: {imported}")
        if contact_failures:
            print(f"Contact import failures: {len(contact_failures)}")
        print(f"Report written to: {report_path}")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"\nERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
