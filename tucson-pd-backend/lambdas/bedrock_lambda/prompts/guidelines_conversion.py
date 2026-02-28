"""
Guidelines Conversion Prompt

This prompt is used to convert guideline PDFs into structured JSON rules.
It receives the full text of the guidelines document and must output a JSON
structure that defines redaction categories, descriptions, priorities, and examples.

Expected Input Variable (formatted via .format()):
- {guidelines_text}: Full text content extracted from the guidelines PDF

Expected Output: JSON object with the following structure:
{{
    "version": "1.0",
    "guidelines": [
        {{
            "category": "PII_NAME",
            "description": "Redact all personal names of civilians",
            "priority": "HIGH",
            "examples": ["John Doe", "Jane Smith"],
            "pattern": "optional regex pattern"
        }},
        ...
    ]
}}

Categories should follow naming convention: PII_*, VEHICLE_*, SENSITIVE_*
Priority levels: LOW, MEDIUM, HIGH, CRITICAL
"""

import logging
import constants  # This configures logging

logger = logging.getLogger(__name__)

guidelines_conversion_prompt = """
You are an expert in law enforcement document redaction policy. Your task is to read a guidelines document and convert it into a structured JSON format that defines redaction rules.

## Your Task
Carefully read the guidelines document provided below. Extract every distinct redaction rule, requirement, or category mentioned. For each rule, produce a JSON object following the exact schema described below.

## Output Schema
You must output a single JSON object with exactly this structure:
{{
    "version": "1.0",
    "guidelines": [
        {{
            "category": "CATEGORY_NAME",
            "description": "Clear description of what must be redacted and why",
            "priority": "PRIORITY_LEVEL",
            "examples": ["example 1", "example 2"],
            "pattern": "optional regex pattern if applicable"
        }}
    ]
}}

## Field Rules

**category** (required, string)
- Use the naming convention PREFIX_TYPE, where prefix is one of:
  - PII_ for personally identifiable information (names, addresses, SSNs, DOBs, phone numbers, emails, etc.)
  - VEHICLE_ for vehicle-related information (plate numbers, VINs, descriptions)
  - SENSITIVE_ for sensitive case details (informant info, juvenile records, medical info, etc.)
  - LEGAL_ for legally protected information (attorney details, sealed records, etc.)
  - FINANCIAL_ for financial information (account numbers, credit cards, etc.)
- Use ALL_CAPS with underscores
- Be specific: prefer PII_SSN over PII_NUMBER, PII_HOME_ADDRESS over PII_ADDRESS
- Each category must be unique across the entire guidelines array

**description** (required, string)
- Write a clear, actionable sentence describing exactly what text must be redacted
- Include the reason if the guidelines document provides one
- Example: "Redact all Social Security Numbers to protect civilian privacy in accordance with ARS 41-4172"

**priority** (required, string)
- Must be exactly one of: "LOW", "MEDIUM", "HIGH", "CRITICAL"
- Use the following criteria:
  - CRITICAL: Legally mandated redactions, federal/state law requirements, juvenile information
  - HIGH: Strong privacy interests, sensitive personal data (SSN, DOB, home address)
  - MEDIUM: General PII that could enable identification or contact (phone, email, employer)
  - LOW: Contextual details that are preferable but not legally required to redact
- If the guidelines document assigns explicit priority levels, map those to the above scale

**examples** (required, array of strings)
- Provide 2-5 realistic example values that would be redacted under this rule
- Use realistic but clearly fictitious values (e.g. "John Doe", "123-45-6789", "AZ ABC1234")
- If no examples are apparent from the guidelines, generate representative ones based on the category
- Never leave this as an empty array — always include at least one example

**pattern** (optional, string or null)
- Provide a regex pattern if the redaction target has a consistent, machine-matchable format
- Examples: SSNs "\\d{{3}}-\\d{{2}}-\\d{{4}}", phone numbers "\\(?\\d{{3}}\\)?[-.\\s]?\\d{{3}}[-.\\s]?\\d{{4}}"
- Set to null if the target is free-form text without a reliable pattern (e.g. names, narratives)

## Critical Output Requirements
- Output ONLY the raw JSON object. No preamble, no explanation, no markdown, no code fences.
- The "guidelines" value MUST be a JSON array (list), even if there is only one rule.
- Every item in the guidelines array must be a JSON object with all required fields.
- Do not include any text before the opening {{ or after the closing }}.
- Ensure the JSON is valid and parseable — check that all strings are quoted, arrays are bracketed, and objects are braced.
- If a guideline in the document covers multiple distinct types of information, split it into multiple separate entries in the array.
- Do not collapse multiple redaction types into a single category entry.

## Guidelines Document Text
{guidelines_text}
"""

logger.info("Guidelines conversion prompt loaded successfully")