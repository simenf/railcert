#!/usr/bin/env python3
"""Refresh both public ERATV result sets through the site's XML export."""
import asyncio
import json
import os
import re
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from playwright.async_api import async_playwright

BASE = "https://eratv.era.europa.eu/Eratv"
OUT = os.path.join(os.path.dirname(__file__), "data", "eratv.json")


def clean(value):
    return re.sub(r"\s+", " ", value or "").strip()


def attr(row, *names):
    normalized = {re.sub(r"[^a-z0-9]", "", k.lower()): v for k, v in row.items()}
    for name in names:
        key = re.sub(r"[^a-z0-9]", "", name.lower())
        if normalized.get(key):
            return clean(normalized[key])
    if "authorisationdocumentreferenceein" in [re.sub(r"[^a-z0-9]", "", n.lower()) for n in names]:
        for k, v in row.items():
            if "authorisationdocumentreference" in k.lower() and "x0028" in k.lower():
                return clean(v)
    return ""


async def export_regime(page, is_2016):
    await page.goto(BASE + "/Home/List", wait_until="domcontentloaded", timeout=90000)
    checkbox = page.locator("#SearchForm #RegistrationRegimeModeViewModel_Is2016Directive")
    await checkbox.set_checked(is_2016)
    await page.locator("#SearchForm input[type=submit]").first.click()
    await page.locator("#ExportList").wait_for(state="visible", timeout=90000)
    await page.locator("#ExportList").select_option("2")  # ERATV's XML whole-result export
    async with page.expect_download(timeout=240000) as pending:
        await page.locator("#btnExport").click()
    download = await pending.value
    path = await download.path()
    if not path:
        raise RuntimeError("ERATV XML export did not produce a downloadable file")
    root = ET.parse(path).getroot()
    rows = [dict(node.attrib) for node in root.findall(".//Result")]
    if not rows and root.tag.lower() != "searchresults":
        raise RuntimeError(f"Unexpected ERATV XML response: {root.tag}")
    print(f"Exported {len(rows)} ERATV records ({2016 if is_2016 else 2008} regime)", flush=True)
    return rows


def make_record(row, regime):
    type_id = attr(row, "Type ID", "Type Version ID", "Vehicle Type ID")
    status = attr(row, "Authorisation Status", "Status")
    area_match = re.search(r"\(([^()]*)\)\s*$", status)
    name = attr(row, "Type Name", "Vehicle Type Name")
    label_map = {
        "Type_ID": "Type ID",
        "Authorisation_document_reference__x0028_EIN_x0029_": "Authorisation document reference (EIN)",
        "Type_Name": "Type Name",
        "Authorisation_Status": "Authorisation Status",
        "Last_Update": "Last Update",
    }
    source_row = {label_map.get(k, k.replace("_", " ")): clean(v) for k, v in row.items()}
    return {
        "typeId": type_id,
        "name": name,
        "authorisationReference": attr(row, "Authorisation document reference (EIN)", "Authorisation_document_reference__x0028_EIN_x0029_"),
        "status": status,
        "area": area_match.group(1) if area_match else "",
        "lastUpdate": attr(row, "Last Update"),
        "registrationRegime": regime,
        "sourceUrl": f"{BASE}/Home/View/{type_id}" if type_id else BASE + "/",
        "sourceRow": source_row,
        "details": [],
    }


async def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(accept_downloads=True)
        new_rows = await export_regime(page, True)
        old_rows = await export_regime(page, False)
        await browser.close()
    if not new_rows:
        raise RuntimeError("ERATV returned no current-regime records; keeping the existing snapshot")
    records = [make_record(r, "Directive (EU) 2016/797") for r in new_rows]
    records.extend(make_record(r, "Directive 2008/57/EC") for r in old_rows)
    records = [r for r in records if r["typeId"]]
    ids = [r["typeId"] for r in records]
    if len(ids) != len(set(ids)):
        raise RuntimeError("ERATV returned duplicate Type IDs across its two public result sets")
    records.sort(key=lambda r: (r["typeId"], r["name"]))
    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": BASE + "/",
        "records": records,
    }
    fd, temp = tempfile.mkstemp(prefix="eratv-", suffix=".json", dir=os.path.dirname(OUT))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(temp, OUT)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    print(f"Saved {len(records)} public ERATV entries to {OUT}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
