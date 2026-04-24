from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from copy import deepcopy
from datetime import UTC, datetime
from html import unescape
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
CURATED_DIR = DATA_DIR / "curated"
DISTILLED_DIR = DATA_DIR / "distilled"
RUN_DATE = datetime.now(UTC).date().isoformat()
USER_AGENT = "Mozilla/5.0 (compatible; CodexCurator/1.0)"
DEFAULT_MODEL = "gpt-5.2"

ALLOWED_THEMES = {
    "fertility_baseline",
    "work_life_context",
    "career_tradeoff",
    "employment_stability_context",
    "financial_support_context",
    "childcare_cost_context",
    "housing_timing_context",
    "leave_planning",
    "partner_support_context",
    "support_planning",
}

ALLOWED_USAGE_VALUES = {
    "fertility_baseline",
    "timeline_calibration",
    "work_life_context",
    "career_tradeoff",
    "employment_stability_context",
    "financial_support_context",
    "childcare_cost_context",
    "housing_timing_context",
    "leave_planning",
    "partner_support_context",
    "support_planning",
}

DISTILL_SYSTEM_PROMPT = """
You are an evidence distillation model.

Your job is to convert extracted text from official reports and policy documents
into structured JSON evidence records for a family-planning timeline system.

The downstream system is a supportive planning tool for women balancing
childbearing timing, work, support, childcare, housing, and financial
preparation.

Rules:
- Output valid JSON only.
- Output a JSON array.
- Each array item must be one evidence record.
- Each evidence record must contain exactly one main claim.
- Only extract claims explicitly supported by the provided text.
- Do not invent facts, figures, dates, or policy details.
- Do not include medical, diagnostic, or fertility-probability claims unless
  the source text explicitly provides them and the source is clearly medical.
- Prefer policy, workforce, childcare, housing, leave, affordability, support,
  and work-life context that can affect timeline construction.
- Ignore methodology sections, disclaimers, repeated boilerplate, copyright
  notices, contact details, and unrelated macro commentary.
- Preserve important numbers exactly as written.
- If no timeline-relevant evidence is present, return an empty JSON array.

Allowed themes:
- fertility_baseline
- work_life_context
- career_tradeoff
- employment_stability_context
- financial_support_context
- childcare_cost_context
- housing_timing_context
- leave_planning
- partner_support_context
- support_planning

Allowed usage values:
- fertility_baseline
- timeline_calibration
- work_life_context
- career_tradeoff
- employment_stability_context
- financial_support_context
- childcare_cost_context
- housing_timing_context
- leave_planning
- partner_support_context
- support_planning

For each record:
- claim should be a short factual statement.
- summary should explain why the claim matters for timeline planning.
- relevance should say when this record should be injected into a downstream prompt.
- confidence should reflect extraction confidence, not importance.
- pageRef should use the page number supplied in the input.
""".strip()

EVIDENCE_JSON_SCHEMA: dict[str, Any] = {
    "type": "array",
    "items": {
        "type": "object",
        "required": [
            "id",
            "sourceId",
            "title",
            "publishDate",
            "theme",
            "claim",
            "summary",
            "pageRef",
            "allowedUsage",
            "confidence",
            "relevance",
        ],
        "properties": {
            "id": {"type": "string"},
            "sourceId": {"type": "string"},
            "title": {"type": "string"},
            "publishDate": {"type": "string"},
            "theme": {"type": "string"},
            "claim": {"type": "string"},
            "summary": {"type": "string"},
            "pageRef": {"type": "string"},
            "allowedUsage": {"type": "string"},
            "confidence": {"type": "number"},
            "relevance": {"type": "string"},
        },
        "additionalProperties": False,
    },
}

SOURCE_REGISTRY: list[dict[str, Any]] = [
    {
        "sourceId": "singstat-births-fertility-latest",
        "title": "Births and Fertility - Latest Data",
        "publisher": "Singapore Department of Statistics",
        "url": "https://www.singstat.gov.sg/find-data/search-by-theme/population/births-and-fertility/latest-data",
        "category": "fertility_baseline",
        "allowedUsage": ["fertility_baseline", "timeline_calibration"],
        "refreshCadence": "quarterly",
    },
    {
        "sourceId": "lifesg-baby-bonus-2026",
        "title": "Baby Bonus Scheme",
        "publisher": "LifeSG",
        "url": "https://www.life.gov.sg/family-parenting/when-your-child-is-born/baby-bonus-scheme",
        "category": "benefits",
        "allowedUsage": ["financial_support_context", "family_benefits_timing"],
        "refreshCadence": "quarterly",
    },
    {
        "sourceId": "mom-maternity-leave-2026",
        "title": "Maternity leave",
        "publisher": "Ministry of Manpower",
        "url": "https://www.mom.gov.sg/employment-practices/leave/maternity-leave",
        "category": "benefits",
        "allowedUsage": ["leave_planning", "work_life_context"],
        "refreshCadence": "quarterly",
    },
    {
        "sourceId": "mom-paternity-leave-2026",
        "title": "Paternity leave",
        "publisher": "Ministry of Manpower",
        "url": "https://www.mom.gov.sg/employment-practices/leave/paternity-leave",
        "category": "benefits",
        "allowedUsage": ["leave_planning", "partner_support_context"],
        "refreshCadence": "quarterly",
    },
    {
        "sourceId": "mom-shared-parental-leave-2026",
        "title": "Shared parental leave",
        "publisher": "Ministry of Manpower",
        "url": "https://www.mom.gov.sg/employment-practices/leave/shared-parental-leave",
        "category": "benefits",
        "allowedUsage": ["leave_planning", "partner_support_context"],
        "refreshCadence": "quarterly",
    },
    {
        "sourceId": "ecda-infant-childcare-subsidy-2026",
        "title": "Overview of the infant and childcare subsidy scheme",
        "publisher": "Early Childhood Development Agency",
        "url": "https://www.ecda.gov.sg/parents/preschool-subsidies/infant-and-childcare-subsidy-scheme/overview",
        "category": "childcare",
        "allowedUsage": ["childcare_cost_context", "support_planning"],
        "refreshCadence": "quarterly",
    },
    {
        "sourceId": "ecda-kifas-2026",
        "title": "Overview of the Kindergarten Fee Assistance Scheme (KiFAS)",
        "publisher": "Early Childhood Development Agency",
        "url": "https://www.ecda.gov.sg/parents/preschool-subsidies/kindergarten-fee-assistance-scheme-%28kifas%29/overview",
        "category": "childcare",
        "allowedUsage": ["childcare_cost_context", "support_planning"],
        "refreshCadence": "quarterly",
    },
    {
        "sourceId": "hdb-bto-2025-planned-supply",
        "title": "25,000 New Flats will be Launched in 2025",
        "publisher": "Housing & Development Board",
        "url": "https://www.hdb.gov.sg/about-us/news-and-publications/press-releases/25000-New-Flats-will-be-Launched-in-2025",
        "category": "housing",
        "allowedUsage": ["housing_timing_context"],
        "refreshCadence": "semiannual",
    },
    {
        "sourceId": "hdb-bto-july-2025",
        "title": "HDB Launches 10,209 Flats in the July 2025 BTO and SBF Sales Exercises",
        "publisher": "Housing & Development Board",
        "url": "https://www.hdb.gov.sg/about-us/news-and-publications/press-releases/hdb-launches-10209-flats-in-the-july-2025-bto-and-sbf-sales-exercises",
        "category": "housing",
        "allowedUsage": ["housing_timing_context"],
        "refreshCadence": "semiannual",
    },
]

CURATED_DATA: dict[str, list[dict[str, Any]]] = {
    "fertility_baselines.json": [
        {
            "id": "fertility-2025-total-live-births",
            "sourceId": "singstat-births-fertility-latest",
            "title": "Births and Fertility - Latest Data",
            "publishDate": "2026",
            "theme": "fertility_baseline",
            "claim": "Singapore recorded 30,004 total live-births in 2025, down 11.0% year over year.",
            "summary": "Recent births data indicates a lower-birth environment, which supports using a planning-oriented rather than one-size-fits-all family timeline.",
            "pageRef": "latest-data table, total live-births row",
            "allowedUsage": "fertility_baseline",
            "confidence": 0.96,
            "relevance": "Use as population context for the timeline summary and baseline framing, not for individual prediction.",
        },
        {
            "id": "fertility-2025-resident-live-births",
            "sourceId": "singstat-births-fertility-latest",
            "title": "Births and Fertility - Latest Data",
            "publishDate": "2026",
            "theme": "fertility_baseline",
            "claim": "Resident live-births were 27,529 in 2025, down 10.6% from 2024.",
            "summary": "Resident births remain a useful local baseline for Singapore-specific planning context.",
            "pageRef": "latest-data table, resident live-births row",
            "allowedUsage": "fertility_baseline",
            "confidence": 0.96,
            "relevance": "Use when emphasizing that the planner is grounded in Singapore household context.",
        },
        {
            "id": "fertility-2025-crude-birth-rate",
            "sourceId": "singstat-births-fertility-latest",
            "title": "Births and Fertility - Latest Data",
            "publishDate": "2026",
            "theme": "fertility_baseline",
            "claim": "The resident crude birth rate was 6.5 per 1,000 residents in 2025, versus 7.4 in 2024.",
            "summary": "The latest resident birth-rate figures provide a macro backdrop for family-planning decisions in Singapore.",
            "pageRef": "latest-data table, resident crude birth rate row",
            "allowedUsage": "fertility_baseline",
            "confidence": 0.94,
            "relevance": "Use sparingly as top-level context, not to alter any individual milestone directly.",
        },
        {
            "id": "fertility-2025-tfr",
            "sourceId": "singstat-births-fertility-latest",
            "title": "Births and Fertility - Latest Data",
            "publishDate": "2026",
            "theme": "fertility_baseline",
            "claim": "Singapore's resident total fertility rate was 0.87 in 2025, compared with 0.97 in 2024.",
            "summary": "The latest fertility rate underscores a broad national context in which long-term family planning is increasingly deliberate.",
            "pageRef": "latest-data table, resident total fertility rate row",
            "allowedUsage": "fertility_baseline",
            "confidence": 0.96,
            "relevance": "Use in the overview or evidence summary, not as a personalized scoring input.",
        },
    ],
    "parenting_benefits.json": [
        {
            "id": "benefits-baby-bonus-first-child-2025plus",
            "sourceId": "lifesg-baby-bonus-2026",
            "title": "Baby Bonus Scheme",
            "publishDate": "2026-04-07",
            "theme": "financial_support_context",
            "claim": "For Singapore citizen first children born on or after 18 February 2025, the total Baby Bonus amount is $20,000.",
            "summary": "The current Baby Bonus package for a first child combines Baby Bonus Cash Gift, CDA First Step Grant, and CDA co-matching support.",
            "pageRef": "scheme table, first child",
            "allowedUsage": "financial_support_context",
            "confidence": 0.95,
            "relevance": "Use when adding budgeting, benefits-enrolment, or Child Development Account setup milestones.",
        },
        {
            "id": "benefits-baby-bonus-third-child-large-family",
            "sourceId": "lifesg-baby-bonus-2026",
            "title": "Baby Bonus Scheme",
            "publishDate": "2026-04-07",
            "theme": "financial_support_context",
            "claim": "Third and subsequent Singapore citizen children born from 18 February 2025 receive a higher CDA First Step Grant of $10,000 under the Large Families Scheme.",
            "summary": "The Baby Bonus scheme includes additional support for larger families, which can matter when users are planning beyond a first child even if the first model only renders first-child detail.",
            "pageRef": "scheme note on Large Families Scheme",
            "allowedUsage": "financial_support_context",
            "confidence": 0.9,
            "relevance": "Store as future-ready context; keep first-child timelines focused unless family-size logic is explicitly enabled.",
        },
        {
            "id": "benefits-maternity-leave-hub",
            "sourceId": "mom-maternity-leave-2026",
            "title": "Maternity leave",
            "publishDate": "2026-01-05",
            "theme": "leave_planning",
            "claim": "MOM's maternity leave guidance directs working mothers to eligibility, planning, and calculation flows for Government-Paid Maternity Leave or Employment Act coverage.",
            "summary": "Maternity leave planning is a formal milestone area with defined eligibility and planning requirements, and should appear in the timeline as an administrative preparation step.",
            "pageRef": "main leave guidance page",
            "allowedUsage": "leave_planning",
            "confidence": 0.82,
            "relevance": "Use to justify maternity-leave planning nodes even when a detailed entitlement calculation is deferred.",
        },
        {
            "id": "benefits-paternity-leave-4-weeks-2025plus",
            "sourceId": "mom-paternity-leave-2026",
            "title": "Paternity leave",
            "publishDate": "2026-02-05",
            "theme": "partner_support_context",
            "claim": "If a child's date of birth, estimated delivery date, or formal intent to adopt is on or after 1 April 2025, eligible fathers are entitled to 4 weeks of Government-Paid Paternity Leave.",
            "summary": "Singapore's current paternity-leave rules create a concrete partner-support planning lever that the timeline can reflect before birth and during early caregiving.",
            "pageRef": "entitlement section",
            "allowedUsage": "partner_support_context",
            "confidence": 0.96,
            "relevance": "Use when generating partner-alignment and leave-coordination milestones.",
        },
        {
            "id": "benefits-shared-parental-leave-2025-2026",
            "sourceId": "mom-shared-parental-leave-2026",
            "title": "Shared parental leave",
            "publishDate": "2026",
            "theme": "partner_support_context",
            "claim": "Eligible working parents are entitled to 6 weeks of shared parental leave for children born from 1 April 2025 to 31 March 2026, and 10 weeks from 1 April 2026 onward.",
            "summary": "The phased increase in shared parental leave can affect return-to-work planning, partner coverage, and the timing of early childcare arrangements.",
            "pageRef": "entitlement section",
            "allowedUsage": "partner_support_context",
            "confidence": 0.95,
            "relevance": "Use when the projected target age maps to a likely birth date in or after these policy windows.",
        },
    ],
    "childcare_support.json": [
        {
            "id": "childcare-basic-subsidy-infant-care",
            "sourceId": "ecda-infant-childcare-subsidy-2026",
            "title": "Overview of the infant and childcare subsidy scheme",
            "publishDate": "2026-04-02",
            "theme": "childcare_cost_context",
            "claim": "All Singapore citizen children enrolled in an ECDA-licensed infant or childcare centre are eligible for a Basic Subsidy; for full-day infant care the basic subsidy is $600.",
            "summary": "Infant-care affordability can be anchored with a known baseline subsidy, making early-childcare budgeting a concrete planning milestone.",
            "pageRef": "subsidy amount table, infant care",
            "allowedUsage": "childcare_cost_context",
            "confidence": 0.95,
            "relevance": "Use when building post-birth childcare budgeting or return-to-work nodes.",
        },
        {
            "id": "childcare-basic-subsidy-childcare",
            "sourceId": "ecda-infant-childcare-subsidy-2026",
            "title": "Overview of the infant and childcare subsidy scheme",
            "publishDate": "2026-04-02",
            "theme": "childcare_cost_context",
            "claim": "For full-day childcare, the basic subsidy is $300, with additional subsidy of up to $467 for eligible working main applicants.",
            "summary": "Childcare costs after infancy can be materially offset by subsidies, which supports adding cost-planning milestones rather than assuming full sticker fees.",
            "pageRef": "subsidy amount table, childcare",
            "allowedUsage": "childcare_cost_context",
            "confidence": 0.95,
            "relevance": "Use in childcare budget and support-planning milestones after the infant-care stage.",
        },
        {
            "id": "childcare-additional-subsidy-income-threshold",
            "sourceId": "ecda-infant-childcare-subsidy-2026",
            "title": "Overview of the infant and childcare subsidy scheme",
            "publishDate": "2026-04-02",
            "theme": "support_planning",
            "claim": "Additional subsidy is available when the main applicant is working and household income is $12,000 or below, or per capita income is $3,000 or below for larger households.",
            "summary": "Eligibility for means-tested preschool subsidies depends on both work status and income thresholds, which can alter near-term financial readiness milestones.",
            "pageRef": "additional subsidy eligibility section",
            "allowedUsage": "support_planning",
            "confidence": 0.94,
            "relevance": "Use when timeline recommendations need to surface subsidy checks or affordability review milestones.",
        },
        {
            "id": "childcare-full-childcare-subsidy-nonworking-lower-income",
            "sourceId": "ecda-infant-childcare-subsidy-2026",
            "title": "Overview of the infant and childcare subsidy scheme",
            "publishDate": "2026-04-02",
            "theme": "support_planning",
            "claim": "From 9 December 2024, families with an SC child in childcare and household income of $6,000 and below, or PCI of $1,500 and below, can qualify for full childcare subsidies regardless of the main applicant's working status.",
            "summary": "Lower-income households may still access full childcare subsidies even when the main applicant is not working, which changes support planning for some family setups.",
            "pageRef": "non-working main subsidy applicant section",
            "allowedUsage": "support_planning",
            "confidence": 0.93,
            "relevance": "Use to avoid overly rigid work-status assumptions in affordability planning.",
        },
        {
            "id": "kindergarten-kifas-income-threshold",
            "sourceId": "ecda-kifas-2026",
            "title": "Overview of the Kindergarten Fee Assistance Scheme (KiFAS)",
            "publishDate": "2026-04-02",
            "theme": "childcare_cost_context",
            "claim": "Singapore citizen children enrolled at Anchor Operator or MOE kindergartens are eligible for means-tested KiFAS subsidies if household income is $12,000 or less, or PCI is $3,000 or less for households with 5 or more members.",
            "summary": "Kindergarten affordability support extends beyond infant care and childcare, making later-child planning costs more predictable.",
            "pageRef": "KiFAS overview section",
            "allowedUsage": "childcare_cost_context",
            "confidence": 0.94,
            "relevance": "Use for later family-cost milestones that extend beyond infancy.",
        },
        {
            "id": "kindergarten-kifas-max-example",
            "sourceId": "ecda-kifas-2026",
            "title": "Overview of the Kindergarten Fee Assistance Scheme (KiFAS)",
            "publishDate": "2026-04-02",
            "theme": "childcare_cost_context",
            "claim": "The KiFAS example on the official page shows a maximum subsidy of $163 for an AOP kindergarten child in a household with gross monthly income of $3,000 and below, subject to a $1 minimum co-payment.",
            "summary": "The official KiFAS example provides a concrete affordability reference point that can be turned into a later-childcare planning node.",
            "pageRef": "minimum co-payment example",
            "allowedUsage": "childcare_cost_context",
            "confidence": 0.87,
            "relevance": "Use as a reference example rather than a universal assumption.",
        },
    ],
    "housing_timing.json": [
        {
            "id": "housing-2025-bto-supply",
            "sourceId": "hdb-bto-2025-planned-supply",
            "title": "25,000 New Flats will be Launched in 2025",
            "publishDate": "2025-01-16",
            "theme": "housing_timing_context",
            "claim": "HDB announced more than 25,000 new flats in 2025, including about 19,600 BTO flats and more than 5,500 SBF flats.",
            "summary": "Public housing supply remains a major family-planning factor, and a broad supply pipeline can shape how early a household starts housing milestones.",
            "pageRef": "main announcement",
            "allowedUsage": "housing_timing_context",
            "confidence": 0.9,
            "relevance": "Use when the planner includes housing preparation or HFE/BTO milestones.",
        },
        {
            "id": "housing-2025-swt-commitment",
            "sourceId": "hdb-bto-2025-planned-supply",
            "title": "25,000 New Flats will be Launched in 2025",
            "publishDate": "2025-01-16",
            "theme": "housing_timing_context",
            "claim": "Of the 19,600 BTO flats planned in 2025, about 3,800 are Shorter Waiting Time flats with waiting times of less than 3 years.",
            "summary": "Shorter waiting time supply is relevant when aligning housing readiness with a planned first-child timeline.",
            "pageRef": "shorter waiting time section",
            "allowedUsage": "housing_timing_context",
            "confidence": 0.92,
            "relevance": "Use to justify earlier housing decision nodes when the target childbearing window is narrow.",
        },
        {
            "id": "housing-july-2025-swt-and-3-year-projects",
            "sourceId": "hdb-bto-july-2025",
            "title": "HDB Launches 10,209 Flats in the July 2025 BTO and SBF Sales Exercises",
            "publishDate": "2025-07-23",
            "theme": "housing_timing_context",
            "claim": "In the July 2025 launch, 1,396 flats had waiting times of less than 3 years and another 775 flats had a waiting time of 3 years.",
            "summary": "Official HDB launch data shows that sub-3-year and roughly 3-year waiting-time projects are available, which can be used to model housing lead time in a family timeline.",
            "pageRef": "waiting-time paragraph",
            "allowedUsage": "housing_timing_context",
            "confidence": 0.93,
            "relevance": "Use when turning housing readiness into an age-based prerequisite milestone.",
        },
    ],
}


def extract_title(html: str) -> str | None:
    match = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    title = unescape(match.group(1))
    return re.sub(r"\s+", " ", title).strip()


def fetch_page_metadata(url: str) -> dict[str, Any]:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=20) as response:
        raw = response.read(200_000).decode("utf-8", errors="ignore")
        return {
            "status": response.status,
            "resolvedUrl": response.geturl(),
            "pageTitle": extract_title(raw),
        }


def enrich_source_registry() -> list[dict[str, Any]]:
    enriched: list[dict[str, Any]] = []

    for record in SOURCE_REGISTRY:
        updated = deepcopy(record)
        updated["lastCheckedDate"] = RUN_DATE
        try:
            metadata = fetch_page_metadata(updated["url"])
            updated["fetchStatus"] = "ok"
            updated["httpStatus"] = metadata["status"]
            updated["resolvedUrl"] = metadata["resolvedUrl"]
            if metadata["pageTitle"]:
                updated["pageTitle"] = metadata["pageTitle"]
        except HTTPError as exc:
            updated["fetchStatus"] = "http_error"
            updated["httpStatus"] = exc.code
            updated["fetchError"] = str(exc)
        except URLError as exc:
            updated["fetchStatus"] = "network_error"
            updated["fetchError"] = str(exc.reason)

        enriched.append(updated)

    return enriched


def validate_records(payload: object, path: Path) -> None:
    if not isinstance(payload, list):
        raise ValueError(f"{path.name} must contain a JSON array.")

    for index, record in enumerate(payload):
        if not isinstance(record, dict):
            raise ValueError(f"{path.name}[{index}] must be an object.")
        if path.name != "source_registry.json" and "id" not in record:
            raise ValueError(f"{path.name}[{index}] is missing 'id'.")
        if "sourceId" not in record:
            raise ValueError(f"{path.name}[{index}] is missing 'sourceId'.")


def write_json(path: Path, payload: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    validate_records(payload, path)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=True)
        handle.write("\n")


def slugify(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "record"


def chunk_pages(
    pages: list[tuple[int, str]], pages_per_chunk: int, max_chars: int
) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []

    for start in range(0, len(pages), pages_per_chunk):
        page_slice = pages[start : start + pages_per_chunk]
        if not page_slice:
            continue

        first_page = page_slice[0][0]
        last_page = page_slice[-1][0]
        chunk_text = "\n\n".join(
            f"[Page {page_no}]\n{text[:max_chars]}" for page_no, text in page_slice if text
        ).strip()

        if not chunk_text:
            continue

        chunks.append(
            {
                "pageStart": first_page,
                "pageEnd": last_page,
                "pageRef": f"p.{first_page}" if first_page == last_page else f"pp.{first_page}-{last_page}",
                "text": chunk_text[: max_chars * max(1, pages_per_chunk)],
            }
        )

    return chunks


def extract_pdf_pages(pdf_path: Path, max_pages: int | None) -> list[tuple[int, str]]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise RuntimeError("pypdf is required to distill PDFs.") from exc

    reader = PdfReader(str(pdf_path))
    pages: list[tuple[int, str]] = []

    for index, page in enumerate(reader.pages, start=1):
        if max_pages is not None and index > max_pages:
            break

        text = page.extract_text() or ""
        normalized = re.sub(r"\s+", " ", text).strip()
        if normalized:
            pages.append((index, normalized))

    return pages


def build_distillation_prompt(
    source_id: str, title: str, publish_date: str, page_ref: str, text: str
) -> str:
    return f"""SOURCE METADATA
sourceId: {source_id}
title: {title}
publishDate: {publish_date}

DISTILLATION GOAL
Extract only the information that could help construct or adjust a family-planning timeline.
Focus on turning points, timing constraints, support availability, affordability,
work flexibility, leave, job stability, childcare, housing, or broad fertility baselines.

PAGE RANGE
{page_ref}

EXTRACTED TEXT
{text}

TASK
Convert the text above into a JSON array of evidence records.
Use one record per claim.
Use the provided source metadata.
Set pageRef to the relevant page number(s), for example p.2 or pp.4-5.
If the text contains no relevant evidence, return [].
""".strip()


def parse_response_output(payload: dict[str, Any]) -> str:
    if payload.get("output_text"):
        return payload["output_text"]

    fragments: list[str] = []
    for output_item in payload.get("output", []):
        for content_item in output_item.get("content", []):
            if content_item.get("type") in {"output_text", "text"} and content_item.get("text"):
                fragments.append(content_item["text"])

    if not fragments:
        raise ValueError("Responses API returned no text output.")

    return "".join(fragments)


def call_openai_distiller(
    api_key: str, model: str, source_id: str, title: str, publish_date: str, chunk: dict[str, Any]
) -> list[dict[str, Any]]:
    prompt = build_distillation_prompt(
        source_id=source_id,
        title=title,
        publish_date=publish_date,
        page_ref=chunk["pageRef"],
        text=chunk["text"],
    )
    payload = {
        "model": model,
        "instructions": DISTILL_SYSTEM_PROMPT,
        "input": prompt,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "evidence_records",
                "schema": EVIDENCE_JSON_SCHEMA,
                "strict": True,
            }
        },
    }
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        "https://api.openai.com/v1/responses",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        raw = response.read().decode("utf-8")

    parsed = json.loads(raw)
    text = parse_response_output(parsed)
    result = json.loads(text)
    if not isinstance(result, list):
        raise ValueError("Distillation response must be a JSON array.")
    return result


def normalize_record(record: dict[str, Any], source_id: str, title: str, publish_date: str) -> dict[str, Any]:
    claim = str(record.get("claim", "")).strip()
    theme = str(record.get("theme", "")).strip()
    allowed_usage = str(record.get("allowedUsage", "")).strip()
    if theme not in ALLOWED_THEMES:
        raise ValueError(f"Unsupported theme: {theme}")
    if allowed_usage not in ALLOWED_USAGE_VALUES:
        raise ValueError(f"Unsupported allowedUsage: {allowed_usage}")

    record_id = str(record.get("id", "")).strip()
    if not record_id:
        record_id = f"{source_id}-{theme}-{slugify(claim)[:48]}"

    confidence = float(record.get("confidence", 0))
    confidence = max(0.0, min(1.0, confidence))

    normalized = {
        "id": record_id,
        "sourceId": source_id,
        "title": str(record.get("title", title)).strip() or title,
        "publishDate": str(record.get("publishDate", publish_date)).strip() or publish_date,
        "theme": theme,
        "claim": claim,
        "summary": str(record.get("summary", "")).strip(),
        "pageRef": str(record.get("pageRef", "")).strip(),
        "allowedUsage": allowed_usage,
        "confidence": confidence,
        "relevance": str(record.get("relevance", "")).strip(),
    }

    for key, value in normalized.items():
        if key == "confidence":
            continue
        if not value:
            raise ValueError(f"Distilled record is missing required value for '{key}'.")

    return normalized


def dedupe_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for record in records:
        key = (
            record["sourceId"],
            re.sub(r"\s+", " ", record["claim"]).strip().lower(),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(record)

    return deduped


def infer_source_metadata(pdf_path: Path) -> dict[str, str]:
    name = pdf_path.stem
    slug = slugify(name)
    hash_suffix = hashlib.sha1(str(pdf_path).encode("utf-8")).hexdigest()[:8]
    return {
        "sourceId": f"pdf-{slug[:48]}-{hash_suffix}",
        "title": name.replace("-", " "),
        "publishDate": "unknown",
    }


def run_refresh() -> None:
    registry = enrich_source_registry()
    write_json(DATA_DIR / "source_registry.json", registry)

    for file_name, payload in CURATED_DATA.items():
        write_json(CURATED_DIR / file_name, payload)

    ok_count = sum(1 for item in registry if item.get("fetchStatus") == "ok")
    print(
        f"Wrote curated data files to {DATA_DIR} and refreshed {ok_count}/{len(registry)} source checks."
    )


def run_distill(args: argparse.Namespace) -> None:
    pdf_dir = Path(args.pdf_dir).resolve()
    if not pdf_dir.exists():
        raise FileNotFoundError(f"PDF directory does not exist: {pdf_dir}")

    pdf_paths = sorted(pdf_dir.glob(args.pattern))
    if args.limit is not None:
        pdf_paths = pdf_paths[: args.limit]

    if not pdf_paths:
        raise FileNotFoundError(f"No PDFs matched pattern '{args.pattern}' in {pdf_dir}")

    output_path = Path(args.output).resolve()
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key and not args.dry_run:
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Re-run with --dry-run or set an API key to distill PDFs."
        )

    distilled_records: list[dict[str, Any]] = []
    manifest: list[dict[str, Any]] = []

    for pdf_path in pdf_paths:
        metadata = infer_source_metadata(pdf_path)
        pages = extract_pdf_pages(pdf_path, args.max_pages)
        chunks = chunk_pages(pages, args.pages_per_chunk, args.max_chars)
        manifest.append(
            {
                "pdfPath": str(pdf_path),
                "sourceId": metadata["sourceId"],
                "pagesExtracted": len(pages),
                "chunksPrepared": len(chunks),
            }
        )

        if args.dry_run:
            continue

        for chunk in chunks:
            response_records = call_openai_distiller(
                api_key=api_key,
                model=args.model,
                source_id=metadata["sourceId"],
                title=metadata["title"],
                publish_date=metadata["publishDate"],
                chunk=chunk,
            )
            for record in response_records:
                distilled_records.append(
                    normalize_record(
                        record,
                        source_id=metadata["sourceId"],
                        title=metadata["title"],
                        publish_date=metadata["publishDate"],
                    )
                )

    if args.dry_run:
        dry_run_path = output_path.with_name(f"{output_path.stem}.dry-run.json")
        dry_run_path.parent.mkdir(parents=True, exist_ok=True)
        with dry_run_path.open("w", encoding="utf-8") as handle:
            json.dump(manifest, handle, indent=2, ensure_ascii=True)
            handle.write("\n")
        print(
            f"Prepared {sum(item['chunksPrepared'] for item in manifest)} chunks across {len(manifest)} PDFs. "
            f"Wrote dry-run manifest to {dry_run_path}."
        )
        return

    distilled_records = dedupe_records(distilled_records)
    write_json(output_path, distilled_records)
    print(f"Wrote {len(distilled_records)} distilled records to {output_path}.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Refresh curated source data or distill PDFs into evidence records."
    )
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("refresh-curated", help="Refresh curated source registry and static JSON.")

    distill = subparsers.add_parser("distill-pdfs", help="Extract PDF text and distill evidence records.")
    distill.add_argument(
        "--pdf-dir",
        default=str(ROOT / "mom_pdfs"),
        help="Directory containing source PDFs.",
    )
    distill.add_argument(
        "--pattern",
        default="*.pdf",
        help="Glob pattern for PDF selection.",
    )
    distill.add_argument(
        "--output",
        default=str(DISTILLED_DIR / "mom_pdf_records.json"),
        help="Output JSON path for distilled records.",
    )
    distill.add_argument(
        "--pages-per-chunk",
        type=int,
        default=2,
        help="How many PDF pages to include per model chunk.",
    )
    distill.add_argument(
        "--max-pages",
        type=int,
        default=6,
        help="Maximum pages to extract from each PDF.",
    )
    distill.add_argument(
        "--max-chars",
        type=int,
        default=6000,
        help="Maximum normalized characters per page before chunk assembly.",
    )
    distill.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional cap on number of PDFs to process.",
    )
    distill.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help="OpenAI model used for distillation.",
    )
    distill.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip API calls and only verify PDF extraction/chunk preparation.",
    )

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    command = args.command or "refresh-curated"
    if command == "refresh-curated":
        run_refresh()
        return
    if command == "distill-pdfs":
        run_distill(args)
        return

    parser.error(f"Unsupported command: {command}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover - command-line guardrail
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
