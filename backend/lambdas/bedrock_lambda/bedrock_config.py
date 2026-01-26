"""
Bedrock Configuration Module

This module manages LLM model configurations, temperatures, and prompt retrieval
for the redaction processing system. It provides centralized access to all
Bedrock-related settings and prompt formatting.
"""

import logging
from prompts import (
    document_summary,
    page_analysis,
    guidelines_conversion,
    error
)
import constants  # This configures logging

logger = logging.getLogger(__name__)


# ============================================================================
# MODEL ID DEFINITIONS
# ============================================================================

# Model ID for document summary generation
document_summary_id = "meta.llama3-70b-instruct-v1:0"

# Model ID for page-by-page redaction analysis
page_analysis_id = "meta.llama3-70b-instruct-v1:0"

# Model ID for guidelines PDF to JSON conversion
guidelines_conversion_id = "meta.llama3-70b-instruct-v1:0"

# Model ID for error handling (default case)
error_id = "meta.llama3-70b-instruct-v1:0"


# ============================================================================
# TEMPERATURE DEFINITIONS
# ============================================================================

# Temperature for document summary (lower = more focused)
document_summary_temperature = 0.1

# Temperature for page analysis (lower = more consistent redaction identification)
page_analysis_temperature = 0.1

# Temperature for guidelines conversion (lower = more structured output)
guidelines_conversion_temperature = 0.1

# Default temperature for unknown types
default_temperature = 0.3


# ============================================================================
# MAX TOKENS DEFINITIONS
# ============================================================================

# Max tokens for document summary
document_summary_max_tokens = 2000

# Max tokens for page analysis (needs room for JSON output with multiple redactions)
page_analysis_max_tokens = 4096

# Max tokens for guidelines conversion (needs room for complete guidelines JSON)
guidelines_conversion_max_tokens = 8192

# Default max tokens
default_max_tokens = 4096


# ============================================================================
# RETRIEVAL FUNCTIONS
# ============================================================================

def get_prompt(type, page_text=None, guidelines=None, document_summary=None, page_number=None, guidelines_text=None):
    """
    Returns the appropriate system prompt based on the specified type.
    Formats prompts with provided parameters for Bedrock model consumption.
    
    Args:
        type: Type of prompt to retrieve ("document_summary", "page_analysis", "guidelines_conversion", "error")
        page_text: Full text content of a single page (for page_analysis)
        guidelines: JSON string of redaction guidelines (for page_analysis)
        document_summary: Summary of entire document (for page_analysis context)
        page_number: Current page number being analyzed (for page_analysis)
        guidelines_text: Full text of guidelines PDF (for guidelines_conversion)
    
    Returns:
        List containing formatted prompt in Bedrock system message format
    
    Raises:
        KeyError: If required parameter is missing for prompt type
        AttributeError: If prompt module is not found
    """
    logger.info(f"Getting prompt for type: {type}")
    
    try:
        prompt = ""
        match type:
            case "document_summary":
                # Document summary doesn't need dynamic formatting
                prompt = document_summary.document_summary_prompt
                
            case "page_analysis":
                # Validate required parameters
                if page_text is None:
                    raise KeyError("page_text is required for page_analysis prompt")
                if guidelines is None:
                    raise KeyError("guidelines is required for page_analysis prompt")
                if page_number is None:
                    raise KeyError("page_number is required for page_analysis prompt")
                
                # Format prompt with dynamic content
                prompt = page_analysis.page_analysis_prompt.format(
                    page_text=page_text,
                    guidelines=guidelines,
                    document_summary=document_summary or "No document summary available",
                    page_number=page_number
                )
                
            case "guidelines_conversion":
                # Validate required parameters
                if guidelines_text is None:
                    raise KeyError("guidelines_text is required for guidelines_conversion prompt")
                
                # Format prompt with guidelines text
                prompt = guidelines_conversion.guidelines_conversion_prompt.format(
                    guidelines_text=guidelines_text
                )
                
            case _:
                logger.warning(f"Unknown prompt type: {type}, using error prompt")
                prompt = error.error_prompt
        
        logger.info(f"Prompt retrieved successfully for type: {type}")
        return [
            {
                "text": prompt
            }
        ]
        
    except KeyError as e:
        logger.error(f"Missing parameter for prompt formatting: {e}")
        logger.error(f"Prompt type: {type}")
        raise
    except AttributeError as e:
        logger.error(f"Prompt module not found: {e}")
        logger.error(f"Prompt type: {type}")
        raise
    except Exception as e:
        logger.error(f"Failed to get prompt for type {type}: {e}")
        raise


def get_config(type):
    """
    Returns configuration settings based on the specified type.
    Provides temperature and max_tokens for different Bedrock use cases.
    
    Args:
        type: Type of configuration to retrieve
    
    Returns:
        Dictionary containing model configuration parameters
    """
    logger.info(f"Getting config for type: {type}")
    
    try:
        config = {}
        match type:
            case "document_summary":
                config = {
                    "temperature": document_summary_temperature,
                    "maxTokens": document_summary_max_tokens
                }
            case "page_analysis":
                config = {
                    "temperature": page_analysis_temperature,
                    "maxTokens": page_analysis_max_tokens
                }
            case "guidelines_conversion":
                config = {
                    "temperature": guidelines_conversion_temperature,
                    "maxTokens": guidelines_conversion_max_tokens
                }
            case _:
                logger.warning(f"Unknown config type: {type}, using default")
                config = {
                    "temperature": default_temperature,
                    "maxTokens": default_max_tokens
                }
        
        logger.info(f"Config retrieved for type: {type}")
        return config
        
    except Exception as e:
        logger.error(f"Failed to get config for type {type}: {e}")
        raise


def get_id(type):
    """
    Returns the appropriate Bedrock model ID based on the specified type.
    Maps interaction types to their corresponding Llama models.
    
    Args:
        type: Type of model to retrieve
    
    Returns:
        String containing the Bedrock model ID
    """
    logger.info(f"Getting model ID for type: {type}")
    
    try:
        model_id = ""
        match type:
            case "document_summary":
                model_id = document_summary_id
            case "page_analysis":
                model_id = page_analysis_id
            case "guidelines_conversion":
                model_id = guidelines_conversion_id
            case _:
                logger.warning(f"Unknown model type: {type}, using error model")
                model_id = error_id
        
        logger.info(f"Model ID retrieved for type: {type}")
        return model_id
        
    except Exception as e:
        logger.error(f"Failed to get model ID for type {type}: {e}")
        raise


logger.info("Bedrock config module loaded successfully")