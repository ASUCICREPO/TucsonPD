"""
Convert Guidelines Module

This module handles the conversion of guideline PDFs to structured JSON rules.
It passes the raw PDF bytes directly to Bedrock as a native document block,
which handles extraction internally. No intermediate text extraction step is needed.

Flow:
1. Download guidelines PDF from S3
2. Pass PDF bytes to Bedrock as a native document content block
3. Parse LLM response to get structured JSON
4. Validate JSON structure
5. Upload JSON to S3
6. Update DynamoDB status to "completed"
"""

import json
import logging
from typing import Dict, Any

from utils import (
    download_from_s3,
    upload_to_s3,
    update_guidelines_status
)
from bedrock_config import get_prompt, get_config, get_id
from constants import (
    GUIDELINE_PROCESSING_COMPLETED
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def convert_guidelines(guideline_id: str, s3_paths: Dict[str, str]) -> Dict[str, Any]:
    """
    Convert guidelines PDF to structured JSON rules
    
    Args:
        guideline_id: Unique guideline identifier
        s3_paths: Dictionary containing S3 paths
            - pdf_path: S3 path to guidelines PDF
            - json_path: S3 path where JSON should be saved
        
    Returns:
        Dictionary with processing results
        
    Raises:
        Exception: If any step fails
    """
    
    logger.info(f"Starting guidelines conversion for guideline: {guideline_id}")
    
    try:
        # Step 1: Download PDF from S3
        logger.info("Downloading guidelines PDF from S3")
        pdf_bytes = download_from_s3(s3_paths["pdf_path"])
        
        # Step 2: Convert PDF to JSON using Bedrock (native PDF support)
        logger.info("Converting guidelines PDF to JSON with Bedrock")
        guidelines_json = convert_pdf_to_json(pdf_bytes)
        
        # Step 3: Validate and structure the JSON
        logger.info("Validating guidelines JSON structure")
        validate_guidelines_json(guidelines_json)
        
        # Step 4: Upload JSON to S3
        logger.info("Uploading guidelines JSON to S3")
        json_str = json.dumps(guidelines_json, indent=2)
        upload_to_s3(
            s3_path=s3_paths["json_path"],
            data=json_str.encode('utf-8')
        )
        
        # Step 5: Update DynamoDB status to completed
        metadata = {
            'total_rules': len(guidelines_json.get('rules', [])),
            'json_path': s3_paths['json_path']
        }
        
        update_guidelines_status(
            guideline_id=guideline_id,
            status=GUIDELINE_PROCESSING_COMPLETED,
            metadata=metadata
        )
        
        logger.info(f"Successfully converted guidelines for: {guideline_id}")
        
        return {
            'total_rules': len(guidelines_json.get('rules', [])),
            'json_path': s3_paths['json_path']
        }
        
    except Exception as e:
        logger.error(f"Error converting guidelines for {guideline_id}: {str(e)}", exc_info=True)
        raise


def convert_pdf_to_json(pdf_bytes: bytes) -> Dict[str, Any]:
    """
    Convert guidelines PDF to structured JSON using Bedrock's native PDF support.
    
    Passes the raw PDF bytes directly as a document content block, bypassing
    any text extraction step. Bedrock handles the PDF natively.
    
    Args:
        pdf_bytes: Raw PDF file bytes
        
    Returns:
        Structured guidelines JSON
    """
    
    logger.info(f"Calling Bedrock for guidelines conversion ({len(pdf_bytes)} bytes)")
    
    # Pass the PDF as a native document block in the user message.
    # The system prompt carries the conversion instructions.
    message = {
        "role": "user",
        "content": [
            {
                "document": {
                    "format": "pdf",
                    "name": "guidelines",
                    "source": {
                        "bytes": pdf_bytes
                    }
                }
            },
            {
                "text": "Convert this guidelines document to structured JSON format."
            }
        ]
    }
    
    # System prompt carries the conversion instructions only — no document
    # content injected here, so get_prompt is called without guidelines_text.
    system_prompts = get_prompt("guidelines_conversion")
    
    # Import here to avoid circular dependency
    from utils import converse_with_bedrock
    
    # Call Bedrock
    response = converse_with_bedrock(
        model_id=get_id("guidelines_conversion"),
        messages=[message],
        system_prompts=system_prompts,
        inference_config=get_config("guidelines_conversion")
    )
    
    # Check stop reason before attempting to parse — a max_tokens truncation
    # would produce invalid JSON with no other indication of failure.
    stop_reason = response.get("stopReason")
    if stop_reason == "max_tokens":
        raise ValueError(
            "Bedrock response was truncated (max_tokens reached). "
            "Increase guidelines_conversion_max_tokens in bedrock_config.py."
        )
    if stop_reason not in ("end_turn", "stop_sequence"):
        logger.warning(f"Unexpected stopReason from Bedrock: {stop_reason}")
    
    # Extract and parse JSON response
    response_text = response["output"]["message"]["content"][0]["text"]
    
    try:
        # Strip markdown code fences if the model wrapped the JSON
        response_text = response_text.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]
        
        guidelines_json = json.loads(response_text.strip())
        
        logger.info("Successfully parsed guidelines JSON from Bedrock response")
        return guidelines_json
        
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON from Bedrock response: {e}")
        logger.error(f"Response text: {response_text}")
        raise ValueError(f"Invalid JSON from Bedrock: {str(e)}")


def validate_guidelines_json(guidelines_json: Dict[str, Any]) -> None:
    """
    Validate that guidelines JSON matches the expected rules-based structure.

    Checks for the top-level 'rules' array and verifies each rule has all
    five required fields with correct types. Does not validate the content of
    applies_to, conditions, or exceptions — that is the guidelines document's
    domain, not ours.
    
    Args:
        guidelines_json: Guidelines JSON to validate
        
    Raises:
        ValueError: If structure is invalid
    """
    
    logger.info("Validating guidelines JSON structure")
    
    # Check top-level structure
    if 'rules' not in guidelines_json:
        raise ValueError("Missing 'rules' array in JSON — model may have used old 'guidelines' key")
    
    if not isinstance(guidelines_json['rules'], list):
        raise ValueError("'rules' must be an array")
    
    if len(guidelines_json['rules']) == 0:
        raise ValueError("'rules' array is empty — guidelines document may not have been processed correctly")
    
    # All five fields must be present on every rule
    required_fields = ['id', 'description', 'applies_to', 'conditions', 'exceptions']
    
    # Array fields that must be lists (can be empty)
    array_fields = ['applies_to', 'conditions', 'exceptions']
    
    ids_seen = set()
    
    for idx, rule in enumerate(guidelines_json['rules']):
        if not isinstance(rule, dict):
            raise ValueError(f"Rule at index {idx} must be an object")
        
        # Check all required fields are present
        for field in required_fields:
            if field not in rule:
                raise ValueError(f"Rule at index {idx} missing required field: '{field}'")
        
        # Validate id is a unique integer
        if not isinstance(rule['id'], int):
            raise ValueError(f"Rule at index {idx} has non-integer id: {rule['id']}")
        if rule['id'] in ids_seen:
            raise ValueError(f"Duplicate rule id: {rule['id']}")
        ids_seen.add(rule['id'])
        
        # Validate description is a non-empty string
        if not isinstance(rule['description'], str) or not rule['description'].strip():
            raise ValueError(f"Rule {rule['id']} has missing or empty description")
        
        # Validate array fields are actually arrays
        for field in array_fields:
            if not isinstance(rule[field], list):
                raise ValueError(f"Rule {rule['id']} field '{field}' must be an array (can be empty)")
        
        # applies_to must have at least one entry — a rule with no target is meaningless
        if len(rule['applies_to']) == 0:
            raise ValueError(f"Rule {rule['id']} has empty 'applies_to' — every rule must target at least one role")
    
    logger.info(f"Guidelines JSON valid: {len(guidelines_json['rules'])} rules")