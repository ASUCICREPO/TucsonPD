"""
Page Analysis Prompt

This prompt is used for analyzing individual pages to identify redactions.
It receives page text, redaction guidelines, and document context, then outputs
a JSON structure containing all redactions found on that specific page.

Expected Input Variables (formatted via .format()):
- {page_text}: Full text content of the current page
- {guidelines}: JSON string of redaction guidelines
- {document_summary}: Summary of entire document for context
- {page_number}: Current page number being analyzed

Expected Output: JSON array of redaction objects for this page:
[
    {
        "page": 1,
        "text": "Clark Kent",
        "instance": 1,
        "rules": ["PII_NAME"]
    },
    ...
]
"""

import logging
import constants  # This configures logging

logger = logging.getLogger(__name__)

# TODO: Fill in the actual prompt text
# This prompt must instruct the LLM to:
# 1. Read the page text carefully
# 2. Apply the redaction guidelines
# 3. Find all text that matches guidelines
# 4. Track instance numbers for repeated text
# 5. Output ONLY valid JSON (no preamble/explanation)
page_analysis_prompt = """
[PROMPT TO BE FILLED IN]

Page Number: {page_number}

Document Context:
{document_summary}

Redaction Guidelines:
{guidelines}

Page Text to Analyze:
{page_text}

Output the redactions as a JSON array with no additional text.
"""

logger.info("Page analysis prompt loaded successfully")