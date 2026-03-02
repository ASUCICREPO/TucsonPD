"""
Guidelines Conversion Prompt

This prompt converts law enforcement redaction guideline PDFs into structured
JSON rules optimized for LLM consumption during document analysis.

The PDF is passed directly to Bedrock as a native document block — no text
extraction or .format() substitution is needed. The prompt is static instructions only.

Design Philosophy:
    The output JSON is NOT intended for programmatic pattern matching. It is a
    structured briefing document that a downstream LLM will reason against when
    analyzing case reports page by page.

    Priority is on capturing high-impact redaction rules accurately over achieving
    exhaustive completeness. A rule that applies broadly (all cases, all roles) or
    protects a clearly sensitive category (juvenile identity, SSN, medical info)
    is more valuable than edge-case requestor rules or minor procedural notes.

    Rules about WHO receives the report (requestor-based release rules) are out
    of scope — the page analysis model has no visibility into who requested the
    report, so those rules cannot inform per-page redaction decisions.

Output Structure:
{
    "version": "1.0",
    "rules": [
        {
            "id": 1,
            "description": "...",
            "applies_to": ["victim_adult", "witness_adult"],
            "conditions": ["all cases"],
            "exceptions": ["Victim provides signed notarized request form"]
        }
    ]
}

Field notes:
    - exceptions: first-class field, not buried in description
    - applies_to: role-based targeting using the defined vocabulary
    - conditions: case-type or situational constraints
    - No examples field — the source document rarely provides them and the
      field adds token overhead without improving downstream reasoning
"""

import logging
import constants  # This configures logging

logger = logging.getLogger(__name__)

guidelines_conversion_prompt = """
You are an expert in law enforcement records and document redaction policy. Your task is to read a redaction guidelines document and convert it into a structured JSON format that will be used by another AI model to make redaction decisions on real case reports.

## Purpose and Priority

This JSON is a structured briefing document, not a pattern-matching ruleset. The model that reads it will reason against these rules page by page — identifying who is mentioned, what type of case it is, and what must be redacted given that combination.

The goal is not exhaustive completeness. It is accurate coverage of the rules that matter most. Prioritize accordingly:

- Rules that apply broadly (all roles, all cases) are highest priority — get these exactly right
- Rules that protect clearly sensitive categories (juvenile identity, SSN, DOB, DL, medical info, sexual assault victims) are highest priority
- Rules where the redacted content differs meaningfully by role or case type should be split into separate entries
- Minor procedural notes, administrative guidance, and supervisor consultation instructions are lowest priority and can be omitted if token budget is a concern
- Rules about who RECEIVES the report (requestor-based release rules such as "release to COT Risk Management without redactions") are OUT OF SCOPE — do not include them. The page analysis model cannot see who requested the report and cannot act on these rules.

## Output Schema

Output a single JSON object with exactly this structure:

{
    "version": "1.0",
    "rules": [
        {
            "id": 1,
            "description": "Clear, precise description of what must be redacted, written closely to the source document's own language",
            "applies_to": ["list of roles or subjects this rule targets"],
            "conditions": ["situational constraints under which this rule applies"],
            "exceptions": ["legally significant exceptions — when this rule does NOT apply or is modified"]
        }
    ]
}

## Field-by-Field Instructions

**id** (required, integer)
- Sequential integer starting at 1
- Used by the downstream model to cite which rule justified a redaction decision

**description** (required, string)
- The most important field — write it to be unambiguous and actionable
- Stay close to the source document's wording; do not paraphrase into generic language
- When the source enumerates specific fields, reproduce that list exactly: if it says "SSN, DL numbers, DOB, and FBI & SID numbers" write those exact items — do not collapse them into "government identifiers"
- Include the legal citation if the source document provides one (e.g. ARS 13-4434)
- For role-differentiated rules, state the role in the description: "Redact juvenile witness name, DOB, SSN..." not just "Redact name, DOB, SSN..."

**applies_to** (required, array of strings)
- Who this rule targets. Use these values:
  - "all" — applies regardless of role
  - "victim_adult"
  - "victim_juvenile"
  - "victim_sexual_assault"
  - "witness_adult"
  - "witness_juvenile"
  - "suspect_adult"
  - "suspect_juvenile"
  - "arrestee_adult"
  - "arrestee_juvenile"
  - "other_involved_adult"
  - "other_involved_juvenile"
  - "no_nibrs_adult"
  - "no_nibrs_juvenile"
  - "government_employee"
  - "refused_party"
  - "confidential_informant"
  - "undercover_officer"
- Use multiple values only when the roles share identical redaction requirements
- Use ["all"] only when the rule genuinely applies to every role without variation

**conditions** (required, array of strings)
- Situational constraints that determine when this rule is active
- Examples: "open case", "closed case", "civil case", "criminal case", "collision report", "felony charge", "misdemeanor charge"
- Use ["all cases"] only when the rule applies regardless of case type
- Be specific — "open felony case" is more useful than just "felony"

**exceptions** (required, array of strings)
- When this rule does NOT apply, or applies differently
- These are legally significant — capture them completely and in the source document's own language
- If there are no exceptions, use an empty array []
- If a rule has a sub-exception to an exception, include it as a parenthetical within the same string

## When to Split vs. Combine Rules

Split a rule into separate entries when the redacted content differs between situations:
- Adult victim vs. juvenile victim: name is redacted for juvenile but not adult → two rules
- Open case suspect vs. closed case suspect: different fields are redacted → two rules
- Physical identifiers for victims/witnesses (all cases) vs. suspects (open cases only) → two rules

Combine into one rule when the redacted content is identical across roles or situations:
- If adult and juvenile witnesses both require the exact same fields redacted, one rule with both in applies_to is correct
- Do not split solely because section headers in the source document treat them separately

## Critical Output Requirements

- Output ONLY the raw JSON object. No preamble, no explanation, no markdown, no code fences.
- The "rules" value MUST be a JSON array, even if there is only one rule.
- Every rule must have all five fields present; exceptions can be an empty array but must be present.
- Do not include any text before the opening { or after the closing }.
- Ensure the JSON is valid and parseable.
"""

logger.info("Guidelines conversion prompt loaded successfully")