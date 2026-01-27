"""
Process Document Module

This module handles the generation of redaction proposals using LLM analysis.
It extracts text from the PDF using AWS Textract, sends it to Bedrock for analysis,
and creates a JSON file containing all proposed redactions.

Flow:
1. Download unredacted PDF from S3
2. Extract full document text for summary using AWS Textract
3. Send to Bedrock to generate document summary
4. Get active guideline from DynamoDB and download its JSON from S3
5. Process each page:
   - Extract page text with AWS Textract
   - Send to Bedrock with guidelines and context
   - Parse JSON response for redactions
6. Compile all redactions into single JSON document
7. Upload redaction-proposals.json to S3
8. Update DynamoDB status to "REVIEW_READY"
"""

import os
import json
import logging
import tempfile
import time
from typing import Dict, Any, List
import pdfplumber
import boto3
from botocore.exceptions import ClientError

from utils import (
    download_from_s3,
    upload_to_s3,
    update_dynamodb_status,
    converse_with_bedrock,
    get_active_guideline_from_db
)
from bedrock_config import get_prompt, get_config, get_id
from constants import (
    STATUS_PROCESSING,
    STATUS_REVIEW_READY,
    STATUS_FAILED,
    S3_BUCKET_NAME,
    S3_PATH_GUIDELINE_JSON
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize Textract client
textract_client = boto3.client('textract')


def extract_text_with_textract(s3_bucket: str, s3_key: str) -> str:
    """
    Extract text from PDF using AWS Textract asynchronous API
    
    Args:
        s3_bucket: S3 bucket name where PDF is stored
        s3_key: S3 key (path) to the PDF
        
    Returns:
        Extracted text as string
        
    Raises:
        RuntimeError: If Textract job fails or times out
        ClientError: If AWS API call fails
    """
    try:
        logger.info(f"Starting Textract job for s3://{s3_bucket}/{s3_key}")
        
        # Start async text detection job
        response = textract_client.start_document_text_detection(
            DocumentLocation={
                'S3Object': {
                    'Bucket': s3_bucket,
                    'Name': s3_key
                }
            }
        )
        
        job_id = response['JobId']
        logger.info(f"Textract job started: {job_id}")
        
        # Poll for job completion
        max_attempts = 60  # 5 minutes max
        attempt = 0
        
        while attempt < max_attempts:
            response = textract_client.get_document_text_detection(JobId=job_id)
            status = response['JobStatus']
            
            if status == 'SUCCEEDED':
                logger.info("Textract job completed successfully")
                break
            elif status == 'FAILED':
                raise RuntimeError(f"Textract job failed: {response.get('StatusMessage')}")
            
            # Wait before next poll
            time.sleep(5)
            attempt += 1
            
            if attempt % 6 == 0:  # Log every 30 seconds
                logger.info(f"Waiting for Textract job... ({attempt * 5} seconds elapsed)")
        
        if status != 'SUCCEEDED':
            raise RuntimeError(f"Textract job timeout after {max_attempts * 5} seconds")
        
        # Extract text from all pages
        text_by_page = {}
        next_token = None
        
        while True:
            if next_token:
                response = textract_client.get_document_text_detection(
                    JobId=job_id,
                    NextToken=next_token
                )
            
            for block in response.get('Blocks', []):
                if block['BlockType'] == 'LINE':
                    page_num = block.get('Page', 1)
                    if page_num not in text_by_page:
                        text_by_page[page_num] = []
                    text_by_page[page_num].append(block['Text'])
            
            next_token = response.get('NextToken')
            if not next_token:
                break
        
        # Combine text by page
        all_text = []
        for page_num in sorted(text_by_page.keys()):
            page_text = '\n'.join(text_by_page[page_num])
            all_text.append(f"--- Page {page_num} ---\n{page_text}")
        
        full_text = '\n\n'.join(all_text)
        logger.info(f"Textract extracted {len(full_text)} characters from {len(text_by_page)} pages")
        
        return full_text
        
    except ClientError as e:
        logger.error(f"Textract API error: {e}")
        raise


def extract_page_text_with_textract(pdf_bytes: bytes, page_num: int) -> str:
    """
    Extract text from a single page using AWS Textract synchronous API
    
    Args:
        pdf_bytes: Raw PDF file bytes
        page_num: Page number (for logging)
        
    Returns:
        Extracted text as string
    """
    try:
        response = textract_client.detect_document_text(
            Document={'Bytes': pdf_bytes}
        )
        
        text_lines = []
        for block in response.get('Blocks', []):
            if block['BlockType'] == 'LINE':
                text_lines.append(block['Text'])
        
        extracted_text = '\n'.join(text_lines)
        logger.info(f"Textract extracted {len(extracted_text)} characters from page {page_num}")
        
        return extracted_text
        
    except ClientError as e:
        logger.error(f"Textract error on page {page_num}: {e}")
        return ""


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
        
        # Step 2: Extract full document text for summary using Textract
        logger.info("Extracting full document text with AWS Textract")
        
        # Parse S3 path to get bucket and key
        s3_path = s3_paths["unredacted_doc"]
        if s3_path.startswith('s3://'):
            path_parts = s3_path[5:].split('/', 1)
            bucket = path_parts[0]
            key = path_parts[1] if len(path_parts) > 1 else ''
        else:
            raise ValueError(f"Invalid S3 path format: {s3_path}")
        
        full_document_text = extract_text_with_textract(bucket, key)
        
        # Step 3: Generate document summary
        logger.info("Generating document summary with Bedrock")
        document_summary = generate_document_summary(full_document_text)
        logger.info(f"Document summary: {document_summary[:200]}...")
        
        # Step 4: Get active guideline and download JSON
        logger.info("Retrieving active guideline from DynamoDB")
        active_guideline = get_active_guideline_from_db()
        
        if not active_guideline:
            error_msg = "No active guideline found. Please activate a guideline before processing documents."
            logger.error(error_msg)
            update_dynamodb_status(
                case_id=case_id,
                status=STATUS_FAILED,
                metadata={"error": error_msg}
            )
            raise ValueError(error_msg)
        
        guideline_id = active_guideline['guideline_id']
        logger.info(f"Using active guideline: {guideline_id} (version: {active_guideline.get('version', 'N/A')})")
        
        # Build S3 path using the template from constants
        guidelines_s3_key = S3_PATH_GUIDELINE_JSON.format(guideline_id=guideline_id)
        guidelines_s3_path = f"s3://{S3_BUCKET_NAME}/{guidelines_s3_key}"
        
        logger.info(f"Downloading guidelines from: {guidelines_s3_path}")
        guidelines_bytes = download_from_s3(guidelines_s3_path)
        guidelines = json.loads(guidelines_bytes.decode('utf-8'))
        guidelines_json = json.dumps(guidelines, indent=2)
        logger.info(f"Loaded {len(guidelines.get('guidelines', []))} guideline categories")
        
        # Step 5: Process each page
        logger.info("Processing pages for redaction identification")
        all_redactions = process_pages_for_redactions(
            pdf_bytes=unredacted_pdf_bytes,
            guidelines_json=guidelines_json,
            document_summary=document_summary,
            s3_bucket=bucket,
            s3_key=key
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
            "document_summary": document_summary[:500],  # Store truncated summary
            "guideline_id": guideline_id,
            "guideline_version": active_guideline.get('version', 'N/A')
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
    document_summary: str,
    s3_bucket: str,
    s3_key: str
) -> List[Dict[str, Any]]:
    """
    Process each page to identify redactions using Bedrock and AWS Textract
    
    Args:
        pdf_bytes: Raw PDF file bytes
        guidelines_json: JSON string of redaction guidelines
        document_summary: Summary of the entire document
        s3_bucket: S3 bucket name (for page extraction if needed)
        s3_key: S3 key to the PDF
        
    Returns:
        List of all redaction objects from all pages
    """
    
    all_redactions = []
    
    # Get page count
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as temp_pdf:
        temp_pdf.write(pdf_bytes)
        temp_pdf_path = temp_pdf.name
    
    try:
        with pdfplumber.open(temp_pdf_path) as pdf:
            total_pages = len(pdf.pages)
        
        logger.info(f"Processing {total_pages} pages with AWS Textract")
        
        # Extract text for all pages at once using async Textract
        full_text = extract_text_with_textract(s3_bucket, s3_key)
        
        # Split by page markers
        page_texts = full_text.split('--- Page ')
        
        for page_num in range(1, total_pages + 1):
            logger.info(f"Analyzing page {page_num}/{total_pages}")
            
            # Find the text for this page
            page_text = ""
            for text_segment in page_texts:
                if text_segment.startswith(f"{page_num} ---"):
                    page_text = text_segment.split('---\n', 1)[1] if '---\n' in text_segment else text_segment
                    break
            
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
        doc_summary=document_summary,
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
        os.unlink(temp_pdf_path)