"""
Error Prompt

This prompt should never be used in normal operation. It's a fallback for
when an invalid prompt type is requested.
"""

import logging
import constants  # This configures logging

logger = logging.getLogger(__name__)

# Error handling prompt - should never be seen by users
error_prompt = "An error occurred, you should never receive this prompt. If you do, the system has encountered an unexpected error in prompt selection."

logger.info("Error prompt loaded successfully")