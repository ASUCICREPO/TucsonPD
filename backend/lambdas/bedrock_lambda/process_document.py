"""
Process Document Module

This module handles the generation of redaction proposals using LLM analysis.
It extracts text from the PDF, sends it to Bedrock for analysis, and creates
a JSON file containing all proposed redactions.

Flow:
1. Download unredacted PDF from S3
2. Extract full document text for summary
3. Send to Bedrock to generate document summary
4. Download redaction guidelines from S3
5. Process each page:
   - Extract page text with pdfplumber
   - Send to Bedrock with guidelines and context
   - Parse JSON response for redactions
6. Compile all redactions into single JSON document
7. Upload redaction-proposals.json to S3
8. Update DynamoDB status to "REVIEW_READY"
"""

import json
import logging
import tempfile
from typing import Dict, Any, List
import pdfplumber

from utils import (
    download_from_s3,
    upload_to_s3,
    update_dynamodb_status,
    converse_with_bedrock
)
from bedrock_config import get_prompt, get_config, get_id
from constants import (
    STATUS_PROCESSING,
    STATUS_REVIEW_READY,
    GUIDELINES_S3_KEY,
    S3_BUCKET_NAME
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def process_document(case_id: str, s3_paths: Dict[str, str]) -> Dict[str, Any]:
    """
    Generate redaction proposals for a document using LLM analysis
    
    Args:
        case_id: Unique case identifier
        s3_paths: Dictionary containing S3 paths for all relevant files
        
    Returns:
        Dictionary with processing results
        
    Raises:
        Exception: If any step fails
    """
    
    logger.info(f"Starting document processing for case: {case_id}")
    
    # Update status to PROCESSING
    update_dynamodb_status(
        case_id=case_id,
        status=STATUS_PROCESSING,
        metadata={"stage": "starting_document_analysis"}
    )
    
    try:
        # Step 1: Download unredacted PDF
        logger.info("Downloading unredacted PDF from S3")
        unredacted_pdf_bytes = download_from_s3(s3_paths["unredacted_doc"])
        
        # Step 2: Extract full document text for summary
        logger.info("Extracting full document text")
        full_document_text = extract_full_document_text(unredacted_pdf_bytes)
        
        # Step 3: Generate document summary
        logger.info("Generating document summary with Bedrock")
        document_summary = generate_document_summary(full_document_text)
        logger.info(f"Document summary: {document_summary[:200]}...")
        
        # Step 4: Download redaction guidelines
        logger.info("Downloading redaction guidelines from S3")
        guidelines_s3_path = f"s3://{S3_BUCKET_NAME}/{GUIDELINES_S3_KEY}"
        guidelines_bytes = download_from_s3(guidelines_s3_path)
        guidelines = json.loads(guidelines_bytes.decode('utf-8'))
        guidelines_json = json.dumps(guidelines, indent=2)
        logger.info(f"Loaded {len(guidelines.get('guidelines', []))} guideline categories")
        
        # Step 5: Process each page
        logger.info("Processing pages for redaction identification")
        all_redactions = process_pages_for_redactions(
            pdf_bytes=unredacted_pdf_bytes,
            guidelines_json=guidelines_json,
            document_summary=document_summary
        )
        
        logger.info(f"Found {len(all_redactions)} total redactions across all pages")
        
        # Step 6: Compile redaction proposals JSON
        redaction_proposals = {
            "case_id": case_id,
            "total_pages": get_page_count(unredacted_pdf_bytes),
            "redactions": all_redactions
        }
        
        # Step 7: Upload redaction proposals to S3
        logger.info("Uploading redaction proposals to S3")
        redaction_proposals_json = json.dumps(redaction_proposals, indent=2)
        upload_to_s3(
            s3_path=s3_paths["redaction_proposals"],
            data=redaction_proposals_json.encode('utf-8')
        )
        
        # Step 8: Update DynamoDB status to REVIEW_READY
        metadata = {
            "total_redactions_proposed": len(all_redactions),
            "redaction_proposals_path": s3_paths["redaction_proposals"],
            "document_summary": document_summary[:500]  # Store truncated summary
        }
        
        update_dynamodb_status(
            case_id=case_id,
            status=STATUS_REVIEW_READY,
            metadata=metadata
        )
        
        logger.info(f"Successfully processed document for case: {case_id}")
        
        return {
            "total_redactions": len(all_redactions),
            "redaction_proposals_path": s3_paths["redaction_proposals"]
        }
        
    except Exception as e:
        logger.error(f"Error processing document for case {case_id}: {str(e)}", exc_info=True)
        raise


def extract_full_document_text(pdf_bytes: bytes) -> str:
    """
    Extract all text from PDF for document summary generation
    
    Args:
        pdf_bytes: Raw PDF file bytes
        
    Returns:
        Complete document text as a single string
    """
    
    logger.info("Extracting full document text with pdfplumber")
    
    # Write PDF to temporary file for pdfplumber
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_pdf:
        temp_pdf.write(pdf_bytes)
        temp_pdf_path = temp_pdf.name
    
    try:
        all_text = []
        with pdfplumber.open(temp_pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                page_text = page.extract_text()
                if page_text:
                    all_text.append(f"--- Page {page_num} ---\n{page_text}")
                else:
                    logger.warning(f"No text extracted from page {page_num}")
        
        full_text = "\n\n".join(all_text)
        logger.info(f"Extracted {len(full_text)} characters from document")
        return full_text
        
    finally:
        # Clean up temporary file
        import os
        os.unlink(temp_pdf_path)


def generate_document_summary(document_text: str) -> str:
    """
    Generate a summary of the document using Bedrock
    
    Args:
        document_text: Full text of the document
        
    Returns:
        Document summary as a string
    """
    
    logger.info("Calling Bedrock for document summary")
    
    # Prepare message with document text
    message = {
        "role": "user",
        "content": [
            {
                "text": document_text
            }
        ]
    }
    
    # Call Bedrock
    response = converse_with_bedrock(
        model_id=get_id("document_summary"),
        messages=[message],
        system_prompts=get_prompt("document_summary"),
        inference_config=get_config("document_summary")
    )
    
    # Extract summary from response
    summary = response["output"]["message"]["content"][0]["text"]
    
    logger.info("Document summary generated successfully")
    return summary


def process_pages_for_redactions(
    pdf_bytes: bytes,
    guidelines_json: str,
    document_summary: str
) -> List[Dict[str, Any]]:
    """
    Process each page to identify redactions using Bedrock
    
    Args:
        pdf_bytes: Raw PDF file bytes
        guidelines_json: JSON string of redaction guidelines
        document_summary: Summary of the entire document
        
    Returns:
        List of all redaction objects from all pages
    """
    
    all_redactions = []
    
    # Write PDF to temporary file for pdfplumber
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_pdf:
        temp_pdf.write(pdf_bytes)
        temp_pdf_path = temp_pdf.name
    
    try:
        with pdfplumber.open(temp_pdf_path) as pdf:
            total_pages = len(pdf.pages)
            logger.info(f"Processing {total_pages} pages")
            
            for page_num, page in enumerate(pdf.pages, 1):
                logger.info(f"Analyzing page {page_num}/{total_pages}")
                
                # Extract page text
                page_text = page.extract_text()
                
                if not page_text or not page_text.strip():
                    logger.warning(f"Page {page_num} has no text, skipping")
                    continue
                
                # Analyze page with Bedrock
                page_redactions = analyze_page_with_bedrock(
                    page_number=page_num,
                    page_text=page_text,
                    guidelines_json=guidelines_json,
                    document_summary=document_summary
                )
                
                logger.info(f"Found {len(page_redactions)} redactions on page {page_num}")
                all_redactions.extend(page_redactions)
        
        return all_redactions
        
    finally:
        # Clean up temporary file
        import os
        os.unlink(temp_pdf_path)


def analyze_page_with_bedrock(
    page_number: int,
    page_text: str,
    guidelines_json: str,
    document_summary: str
) -> List[Dict[str, Any]]:
    """
    Analyze a single page with Bedrock to identify redactions
    
    Args:
        page_number: Current page number
        page_text: Text content of the page
        guidelines_json: JSON string of redaction guidelines
        document_summary: Summary of entire document
        
    Returns:
        List of redaction objects for this page
    """
    
    # Prepare message with page text
    message = {
        "role": "user",
        "content": [
            {
                "text": f"Analyze page {page_number} for redactions."
            }
        ]
    }
    
    # Get formatted prompt with all dynamic content
    system_prompts = get_prompt(
        "page_analysis",
        page_text=page_text,
        guidelines=guidelines_json,
        document_summary=document_summary,
        page_number=page_number
    )
    
    # Call Bedrock
    response = converse_with_bedrock(
        model_id=get_id("page_analysis"),
        messages=[message],
        system_prompts=system_prompts,
        inference_config=get_config("page_analysis")
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
        
        redactions = json.loads(response_text.strip())
        
        # Validate it's a list
        if not isinstance(redactions, list):
            logger.error(f"Expected list of redactions, got {type(redactions)}")
            return []
        
        return redactions
        
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON from Bedrock response on page {page_number}: {e}")
        logger.error(f"Response text: {response_text}")
        return []


def get_page_count(pdf_bytes: bytes) -> int:
    """
    Get the total number of pages in a PDF
    
    Args:
        pdf_bytes: Raw PDF file bytes
        
    Returns:
        Number of pages
    """
    
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_pdf:
        temp_pdf.write(pdf_bytes)
        temp_pdf_path = temp_pdf.name
    
    try:
        with pdfplumber.open(temp_pdf_path) as pdf:
            return len(pdf.pages)
    finally:
        import os
        os.unlink(temp_pdf_path)