"""
Document Summary Prompt

This prompt is used to generate an initial summary of the entire PDF document
before processing individual pages. The summary provides context for the
page-by-page redaction analysis.

Expected Output: A brief summary (2-3 paragraphs) describing:
- Document type (police report, incident report, etc.)
- Main subjects/people involved
- General content overview
- Any notable patterns that might affect redaction
"""

import logging
import constants  # This configures logging

logger = logging.getLogger(__name__)

# TODO: Fill in the actual prompt text
# This prompt will receive the full document text and should generate a summary
document_summary_prompt = """
[PROMPT TO BE FILLED IN]

Generate a concise summary of this document to help with redaction processing.
"""

logger.info("Document summary prompt loaded successfully")