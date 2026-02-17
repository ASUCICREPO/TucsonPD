"""
Convert Guidelines Module

This module handles the conversion of guideline PDFs to structured JSON rules.
It extracts text from the PDF, sends it to Bedrock for LLM processing, and
generates a structured JSON document that defines redaction rules.

Flow:
1. Download guidelines PDF from S3
2. Extract full text from PDF using pdfplumber
3. Send text to Bedrock with conversion prompt
4. Parse LLM response to get structured JSON
5. Upload JSON to S3
6. Update DynamoDB status to "completed"
"""

import json
import logging
import tempfile
from typing import Dict, Any
import pdfplumber

from utils import (
    download_from_s3,
    upload_to_s3,
    update_guidelines_status
)
from bedrock_config import get_prompt, get_config, get_id
from constants import (
    GUIDELINE_PROCESSING_COMPLETED,
    S3_BUCKET_NAME
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
        
        # Step 2: Extract text from PDF
        logger.info("Extracting text from guidelines PDF")
        guidelines_text = extract_guidelines_text(pdf_bytes)
        logger.info(f"Extracted {len(guidelines_text)} characters from PDF")
        
        # Step 3: Convert to JSON using Bedrock
        logger.info("Converting guidelines text to JSON with Bedrock")
        guidelines_json = convert_text_to_json(guidelines_text)
        
        # Step 4: Validate and structure the JSON
        logger.info("Validating guidelines JSON structure")
        validate_guidelines_json(guidelines_json)
        
        # Step 5: Upload JSON to S3
        logger.info("Uploading guidelines JSON to S3")
        json_str = json.dumps(guidelines_json, indent=2)
        upload_to_s3(
            s3_path=s3_paths["json_path"],
            data=json_str.encode('utf-8')
        )
        
        # Step 6: Update DynamoDB status to completed
        metadata = {
            'total_guidelines': len(guidelines_json.get('guidelines', [])),
            'json_path': s3_paths['json_path']
        }
        
        update_guidelines_status(
            guideline_id=guideline_id,
            status=GUIDELINE_PROCESSING_COMPLETED,
            metadata=metadata
        )
        
        logger.info(f"Successfully converted guidelines for: {guideline_id}")
        
        return {
            'total_guidelines': len(guidelines_json.get('guidelines', [])),
            'json_path': s3_paths['json_path']
        }
        
    except Exception as e:
        logger.error(f"Error converting guidelines for {guideline_id}: {str(e)}", exc_info=True)
        raise


def extract_guidelines_text(pdf_bytes: bytes) -> str:
    """
    Extract all text from guidelines PDF
    
    Args:
        pdf_bytes: Raw PDF file bytes
        
    Returns:
        Complete text as a single string
    """
    
    logger.info("Extracting text from PDF with pdfplumber")
    
    # Write PDF to temporary file for pdfplumber
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_pdf:
        temp_pdf.write(pdf_bytes)
        temp_pdf_path = temp_pdf.name
    
    try:
        all_text = []
        with pdfplumber.open(temp_pdf_path) as pdf:
            total_pages = len(pdf.pages)
            logger.info(f"Processing {total_pages} pages")
            
            for page_num, page in enumerate(pdf.pages, 1):
                page_text = page.extract_text()
                if page_text:
                    all_text.append(f"--- Page {page_num} ---\n{page_text}")
                else:
                    logger.warning(f"No text extracted from page {page_num}")
        
        full_text = "\n\n".join(all_text)
        logger.info(f"Extracted {len(full_text)} characters total")
        return full_text
        
    finally:
        # Clean up temporary file
        import os
        os.unlink(temp_pdf_path)


def convert_text_to_json(guidelines_text: str) -> Dict[str, Any]:
    """
    Convert guidelines text to structured JSON using Bedrock
    
    Args:
        guidelines_text: Full text from guidelines PDF
        
    Returns:
        Structured guidelines JSON
    """
    
    logger.info("Calling Bedrock for guidelines conversion")
    
    # Prepare message with guidelines text
    message = {
        "role": "user",
        "content": [
            {
                "text": "Convert the following guidelines document to structured JSON format."
            }
        ]
    }
    
    # Get formatted prompt with guidelines text
    system_prompts = get_prompt(
        "guidelines_conversion",
        guidelines_text=guidelines_text
    )
    
    # Import here to avoid circular dependency
    from utils import converse_with_bedrock
    
    # Call Bedrock
    response = converse_with_bedrock(
        model_id=get_id("guidelines_conversion"),
        messages=[message],
        system_prompts=system_prompts,
        inference_config=get_config("guidelines_conversion")
    )
    
    # Extract and parse JSON response
    response_text = response["output"]["message"]["content"][0]["text"]
    
    try:
        # Parse JSON from response (may need to strip markdown code fences)
        response_text = response_text.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]  # Remove ```json
        if response_text.startswith("```"):
            response_text = response_text[3:]  # Remove ```
        if response_text.endswith("```"):
            response_text = response_text[:-3]  # Remove trailing ```
        
        guidelines_json = json.loads(response_text.strip())
        
        logger.info("Successfully parsed guidelines JSON from Bedrock response")
        return guidelines_json
        
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON from Bedrock response: {e}")
        logger.error(f"Response text: {response_text}")
        raise ValueError(f"Invalid JSON from Bedrock: {str(e)}")


def validate_guidelines_json(guidelines_json: Dict[str, Any]) -> None:
    """
    Validate that guidelines JSON has required structure
    
    Args:
        guidelines_json: Guidelines JSON to validate
        
    Raises:
        ValueError: If structure is invalid
    """
    
    logger.info("Validating guidelines JSON structure")
    
    # Check required top-level fields
    if 'guidelines' not in guidelines_json:
        raise ValueError("Missing 'guidelines' array in JSON")
    
    if not isinstance(guidelines_json['guidelines'], list):
        raise ValueError("'guidelines' must be an array")
    
    # Validate each guideline has required fields
    for idx, guideline in enumerate(guidelines_json['guidelines']):
        if not isinstance(guideline, dict):
            raise ValueError(f"Guideline at index {idx} must be an object")
        
        required_fields = ['category', 'description', 'priority']
        for field in required_fields:
            if field not in guideline:
                raise ValueError(f"Guideline at index {idx} missing required field: {field}")
        
        # Validate priority is valid
        valid_priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
        if guideline['priority'] not in valid_priorities:
            logger.warning(f"Guideline at index {idx} has non-standard priority: {guideline['priority']}")
    
    logger.info(f"Guidelines JSON valid: {len(guidelines_json['guidelines'])} rules")