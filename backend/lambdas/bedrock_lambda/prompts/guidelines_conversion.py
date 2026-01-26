"""
Guidelines Conversion Prompt

This prompt is used to convert guideline PDFs into structured JSON rules.
It receives the full text of the guidelines document and must output a JSON
structure that defines redaction categories, descriptions, priorities, and examples.

Expected Input Variable (formatted via .format()):
- {guidelines_text}: Full text content extracted from the guidelines PDF

Expected Output: JSON object with the following structure:
{
    "version": "1.0",
    "guidelines": [
        {
            "category": "PII_NAME",
            "description": "Redact all personal names of civilians",
            "priority": "HIGH",
            "examples": ["John Doe", "Jane Smith"],
            "pattern": "optional regex pattern"
        },
        ...
    ]
}

Categories should follow naming convention: PII_*, VEHICLE_*, SENSITIVE_*
Priority levels: LOW, MEDIUM, HIGH, CRITICAL
"""

import logging
import constants  # This configures logging

logger = logging.getLogger(__name__)

# TODO: Fill in the actual prompt text
# This prompt must instruct the LLM to:
# 1. Read and understand the guidelines document text
# 2. Extract redaction rules and categorize them
# 3. Assign appropriate priority levels
# 4. Provide examples where available
# 5. Output ONLY valid JSON (no preamble/explanation)
# 6. Follow the exact schema structure above

guidelines_conversion_prompt = """
[PROMPT TO BE FILLED IN]

Guidelines Document Text:
{guidelines_text}

Convert the above guidelines into structured JSON format following the schema described.
Output only the JSON, no additional text.
"""

logger.info("Guidelines conversion prompt loaded successfully")